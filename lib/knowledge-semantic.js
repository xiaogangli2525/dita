'use strict';
const { createIndex, validate, PROFILE, LEGACY_PROFILE } = require('../public/knowledge/knowledge-semantic');
const { aborted } = require('./knowledge-vector-cache');
const { createEncoder } = require('./semantic-encoder');
const encoder = createEncoder();
const { rank } = require('../public/knowledge/knowledge-ranking');
const { queryConstraints, normalizeTechnicalTerms } = require('../public/knowledge/knowledge-retrieval').createSdkSearch();
const { technicalAliases } = require('../public/knowledge/knowledge-search-profile');

async function build(records, onProgress = () => {}, { legacy = false, signal } = {}) {
  aborted(signal);
  const chunks = await encoder.chunksFor(records, { legacy, signal });
  return buildChunks(chunks, onProgress, { legacy, signal });
}
// Only accepts chunks prepared inside the server, never a client-supplied plan.
async function buildChunks(chunks, onProgress = () => {}, { legacy = false, signal } = {}) {
  const vectors = [];
  for (let start = 0; start < chunks.length; start += 16) {
    aborted(signal);
    vectors.push(...await encoder.encode(chunks.slice(start, start + 16).map(chunk => chunk.text), false, { signal }));
    onProgress(Math.min(start + 16, chunks.length), chunks.length);
  }
  aborted(signal);
  return createIndex(chunks, vectors, legacy ? LEGACY_PROFILE : PROFILE);
}

function createSearch(records, index) {
  const vectors = validate(records, index);
  return (query, lexical, options) => score(records, index, query, lexical, options, () => vectors);
}

function search(records, index, query, lexical, options) {
  return score(records, index, query, lexical, options, () => validate(records, index));
}

async function score(records, index, query, lexical, { manualId = '', module = '', mode = '', limit = 10, semanticOnly = false } = {}, loadVectors) {
  if (requiresLexical(query)) return lexical.filter(hit => {
    const record = records[hit.position];
    return record && (!manualId || record.manualId === manualId) && (!module || (record.module || '').toLowerCase() === module.toLowerCase()) &&
      (!mode || (record.mode || '').toLowerCase() === mode.toLowerCase());
  }).slice(0, limit);
  const vectors = loadVectors();
  const [question] = await encoder.encode([normalizeTechnicalTerms(query, technicalAliases)], true);
  return rank(records, index.chunks, offset => {
    let similarity = 0;
    for (let dimension = 0; dimension < PROFILE.dimensions; dimension++) {
      similarity += question[dimension] * vectors[offset * PROFILE.dimensions + dimension];
    }
    return similarity;
  }, query, lexical, { manualId, module, mode, limit, semanticOnly });
}

const requiresLexical = query => queryConstraints(query).requiresLexical;
module.exports = { build, buildChunks, search, createSearch, encoder, requiresLexical };

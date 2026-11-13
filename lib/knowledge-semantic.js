'use strict';
const { createIndex, validate, PROFILE } = require('../public/knowledge-semantic');
const { createEncoder } = require('./semantic-encoder');
const encoder = createEncoder();
const { aliasesFor } = require('../public/knowledge-search').createSearchEngine();

async function build(records, onProgress = () => {}) {
  const chunks = await encoder.chunksFor(records), vectors = [];
  for (let start = 0; start < chunks.length; start += 16) {
    vectors.push(...await encoder.encode(chunks.slice(start, start + 16).map(chunk => chunk.text)));
    onProgress(Math.min(start + 16, chunks.length), chunks.length);
  }
  return createIndex(chunks, vectors);
}

async function search(records, index, query, lexical, { manualId = '', module = '', mode = '', limit = 10, semanticOnly = false } = {}) {
  const vectors = validate(records, index);
  const [question] = await encoder.encode([query], true), byChapter = new Map();
  const entities = query.toLowerCase().match(/at\+[a-z0-9_]+|cm_[a-z0-9_]+|\b(?:https?|ftp|mqtt|webui|gpio|pdp|apn|ssl|tls|tcp|udp|dns|ntp)\b/g) || [];
  const webuiScope = !entities.length && query.includes('网页') && records.some(record => /webui/i.test(record.manualTitle));
  const inScope = record => (!manualId || record.manualId === manualId) && (!module || record.module.toLowerCase() === module.toLowerCase()) &&
    (!mode || record.mode.toLowerCase() === mode.toLowerCase()) && (!webuiScope || /webui/i.test(record.manualTitle)) &&
    entities.every(term => [record.title, record.text, record.manualTitle, record.module, ...aliasesFor(record)].join(' ').toLowerCase().includes(term));
  for (const [i, chunk] of index.chunks.entries()) {
    const record = records[chunk.position];
    if (!inScope(record)) continue;
    let similarity = 0;
    for (let j = 0; j < PROFILE.dimensions; j++) similarity += question[j] * vectors[i * PROFILE.dimensions + j];
    const old = byChapter.get(chunk.position);
    if (!old || similarity > old.similarity) byChapter.set(chunk.position, { position: chunk.position, similarity, excerpt: chunk.text });
  }
  const semanticHits = [...byChapter.values()].sort((a, b) => b.similarity - a.similarity);
  const eligibleLexical = lexical.filter(hit => inScope(records[hit.position]));
  const lexicalRank = new Map(eligibleLexical.map((hit, rank) => [hit.position, rank]));
  const combined = semanticHits.filter(hit => hit.similarity >= 0.55).map((hit, rank) => ({
    ...hit, score: semanticOnly ? hit.similarity : 1 / (60 + rank + 1) + (lexicalRank.has(hit.position) ? 1 / (60 + lexicalRank.get(hit.position) + 1) : 0),
    reason: lexicalRank.has(hit.position) ? '关键词与语义匹配' : '语义相关片段', matchedTerms: [],
    semanticScore: Math.round(hit.similarity * 1000) / 1000
  }));
  if (!semanticOnly) {
    const positions = new Set(combined.map(hit => hit.position));
    for (const [rank, hit] of eligibleLexical.entries()) {
      if (!positions.has(hit.position)) combined.push({ ...hit, score: 1 / (60 + rank + 1) });
    }
    // Strong exact titles and explicit aliases retain lexical precedence.
    const first = eligibleLexical[0], next = eligibleLexical[1];
    const clearLexical = first && first.reason === '章节关键词匹配' && first.matchedTerms.length >= 3 &&
      (!next || first.score >= next.score * 2);
    if (first?.score >= 1500 || clearLexical) return eligibleLexical.slice(0, limit);
  }
  return combined.sort((a, b) => b.score - a.score).slice(0, limit);
}
module.exports = { build, search, encoder };

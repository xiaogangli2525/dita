'use strict';
const { DitaKnowledgeRetrieval, DitaKnowledgeSearch, DitaKnowledgeSemantic, DitaKnowledgeStructure,
  DitaKnowledgeSearchProfile, DitaKnowledgeRanking, DitaKnowledgeReader } = globalThis;
const sdk = DitaKnowledgeRetrieval.createSdkSearch();
const engine = DitaKnowledgeSearch.createSearchEngine();
const semantic = DitaKnowledgeSemantic;

globalThis.configure = rows => {
  globalThis.records = JSON.parse(rows);
  globalThis.lexicalIndex = null;
};
const operations = {
  version: () => sdk.version,
  page: book => DitaKnowledgeReader.renderPage(book, { localSemantic: true }),
  constraints: query => sdk.queryConstraints(query),
  normalizeQuery: query => sdk.normalizeTechnicalTerms(query, DitaKnowledgeSearchProfile.technicalAliases),
  compatible: index => semantic.compatible(index),
  validateChunks: (rows, index) => { semantic.validateChunks(rows, index); },
  validateBlock: record => DitaKnowledgeStructure.validate(record),
  lexical: (query, options) => {
    globalThis.lexicalIndex ||= engine.build(globalThis.records);
    const records = globalThis.records;
    return engine.search(records, globalThis.lexicalIndex, query, options.manualId, 50, options).map(hit => ({
      ...hit, excerpt: engine.excerpt(records[hit.position].text, query)
    }));
  },
  rank: (chunks, scores, query, lexical, options) =>
    DitaKnowledgeRanking.rank(globalThis.records, chunks, offset => scores[offset], query, lexical, options)
};
globalThis.invoke = (name, encoded) => JSON.stringify(operations[name](...JSON.parse(encoded)) ?? null);

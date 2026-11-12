// @ts-check
'use strict';
(function (root) {
  const retrieval = typeof module !== 'undefined' ? require('./knowledge-retrieval') : root.DitaKnowledgeRetrieval;
  /** @param {ReturnType<typeof retrieval.createSdkSearch>} [sdk] */
  function createSearchEngine(sdk = retrieval.createSdkSearch()) {
    const options = {};
    /** @type {WeakMap<object, {records: readonly import('./knowledge-contracts').SearchRecord[], api: import('./knowledge-retrieval').SdkEngine}>} */
    const cached = new WeakMap();
    /** @param {string} text @param {boolean} [_question] */
    function tokens(text, _question = false) {
      return [...new Set(sdk.normalize(text).match(/at\+[a-z0-9_]+|[a-z0-9_]+|[\u3400-\u9fff]{1,2}/g) || [])];
    }
    /** @param {import('./knowledge-contracts').SearchRecord} record */
    function metadata(record) {
      const symbols = [...new Set([...(record.symbols || []), ...(record.title + ' ' + record.text).match(/AT\+[A-Z0-9_]+|\b[A-Za-z_][A-Za-z0-9_]*_[A-Za-z0-9_]*/gi) || []])];
      const definedSymbols = record.definedSymbols || symbols.filter(symbol => {
        const title = sdk.normalize(record.title), name = sdk.normalize(symbol);
        return (title === name || title.startsWith(name + ' ')) && !/示例|调用|example/i.test(title);
      });
      return { symbols, definedSymbols };
    }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records */
    function rows(records) {
      return records.map((record, index) => {
        const aliases = [...(record.aliases || [])], content = record.title + ' ' + record.text;
        if (/\btimeout\b/i.test(content)) aliases.push('超时'); if (content.includes('超时')) aliases.push('timeout');
        if (/\bcertificate\b/i.test(content)) aliases.push('证书'); if (content.includes('证书')) aliases.push('certificate');
        return { id: String(index), manualId: record.manualId, url: record.manualId + '#' + (record.anchor || index), title: record.title, text: record.text,
        docTitle: record.manualTitle || '', module: record.module || record.manualTitle || '', mode: record.mode || 'other',
        aliases, kind: record.kind || 'guide', ...metadata(record) }; });
    }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records @returns {import('./knowledge-contracts').SearchIndex} */
    function build(records) { return { schema: 2, compiled: sdk.compile(rows(records), options) }; }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records @param {import('./knowledge-contracts').SearchIndex} index */
    function engine(records, index) {
      let value = cached.get(index);
      if (!value || value.records !== records) { value = { records, api: sdk.create(rows(records), { ...options, compiled: index.compiled }) }; cached.set(index, value); }
      return value.api;
    }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records @param {import('./knowledge-contracts').SearchIndex} index
     * @param {string} query @param {string} [manualId] @param {number} [limit] @param {{mode?:string,module?:string}} [filters] */
    function search(records, index, query, manualId = '', limit = 40, filters = {}) {
      const hits = engine(records, index).search(query, { ...filters, manualId, limit });
      return hits.map(hit => ({ position: Number(hit.record.id), score: hit.score, complete: true, reason: hit.reason, matchedTerms: hit.matchedTerms }))
        .filter(hit => !manualId || records[hit.position]?.manualId === manualId).slice(0, Math.max(0, limit));
    }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records @param {import('./knowledge-contracts').SearchIndex} index @param {string} query @param {{manualId?:string,mode?:string,module?:string}} [filters] */
    function suggest(records, index, query, filters = {}) { return engine(records, index).suggest(query, 6, filters); }
    /** @param {string} text @param {string} query @param {number} [length] */
    function excerpt(text, query, length = 190) {
      const value = String(text || '').replace(/\s+/g, ' ').trim(), normalized = sdk.normalize(value);
      const positions = tokens(query).map(word => normalized.indexOf(word)).filter(position => position >= 0);
      const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 45);
      return (start ? '…' : '') + value.slice(start, start + length) + (value.length > start + length ? '…' : '');
    }
    return { tokens, metadata, build, search, suggest, excerpt };
  }
  function runtimeSource() { return '(' + createSearchEngine.toString() + ')((' + retrieval.createSdkSearch.toString() + ')())'; }
  const api = { createSearchEngine, runtimeSource };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeSearch = api;
})(typeof window === 'undefined' ? globalThis : window);

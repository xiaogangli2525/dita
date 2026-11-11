// @ts-check
'use strict';
(function (root) {
  // Self-contained so the exact same search engine can run in an offline file.
  function createSearchEngine() {
    /** @param {string} text */
    const normalize = text => String(text || '').normalize('NFKC').toLowerCase();
    /** @param {string} text @param {boolean} [question] */
    function tokens(text, question = false) {
      const value = question ? normalize(text).replace(/如何|怎么|请问|是否/g, '') : normalize(text);
      const result = [];
      for (const match of value.matchAll(/at\+[a-z0-9_]+|[a-z0-9_]+|[\u3400-\u9fff]+/g)) {
        const word = match[0];
        if (/^[\u3400-\u9fff]/.test(word) && word.length > 1) {
          for (let i = 0; i < word.length - 1; i++) result.push(word.slice(i, i + 2));
        } else result.push(word);
      }
      return [...new Set(result)];
    }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records @returns {import('./knowledge-contracts').SearchIndex} */
    function build(records) {
      /** @type {Record<string, number[]>} */
      const postings = Object.create(null);
      records.forEach((record, index) => {
        for (const token of tokens(record.title + ' ' + (record.manualTitle || '') + ' ' + record.text)) (postings[token] ||= []).push(index);
      });
      return { schema: 1, postings };
    }
    /** @param {readonly import('./knowledge-contracts').SearchRecord[]} records @param {import('./knowledge-contracts').SearchIndex} index
     * @param {string} query @param {string} [manualId] @param {number} [limit] */
    function search(records, index, query, manualId = '', limit = 40) {
      const words = tokens(query, true).slice(0, 24);
      if (!words.length) return [];
      /** @type {Record<string, string[]>} */
      const aliases = { '超时': ['timeout'], timeout: ['超时'], '证书': ['certificate'], certificate: ['证书'] };
      const sets = words.map(word => new Set([word, ...(aliases[word] || [])].flatMap(token => index.postings[token] || [])));
      const exact = words.filter(word => /^at\+|^[a-z0-9]+_[a-z0-9_]+$|^\d+$/.test(word));
      const candidates = new Set(sets.flatMap(set => [...set]));
      const phrase = normalize(query).trim(), results = [];
      for (const position of candidates) {
        const record = records[position];
        if (!record || manualId && record.manualId !== manualId) continue;
        if (exact.some(word => !(index.postings[word] || []).includes(position))) continue;
        const matched = sets.filter(set => set.has(position)).length;
        if (matched < Math.max(1, Math.ceil(words.length * 0.6))) continue;
        const title = normalize(record.title), text = normalize(record.text);
        const titleTokens = new Set(tokens(record.title));
        const score = matched * 20 + (matched === words.length ? 200 : 0) + (title === phrase ? 300 : title.includes(phrase) ? 120 : 0) +
          (text.includes(phrase) ? 35 : 0) + words.filter(word => titleTokens.has(word)).length * 50 +
          exact.filter(word => /^at\+/.test(word) && titleTokens.has(word)).length * 1000;
        results.push({ position, score, complete: matched === words.length });
      }
      return results.sort((a, b) => b.score - a.score || a.position - b.position).slice(0, limit);
    }
    /** @param {string} text @param {string} query @param {number} [length] */
    function excerpt(text, query, length = 190) {
      const value = String(text || '').replace(/\s+/g, ' ').trim(), normalized = normalize(value);
      const positions = tokens(query, true).map(word => normalized.indexOf(word)).filter(position => position >= 0);
      const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 45);
      return (start ? '…' : '') + value.slice(start, start + length) + (value.length > start + length ? '…' : '');
    }
    return { tokens, build, search, excerpt };
  }
  const api = { createSearchEngine };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeSearch = api;
})(typeof window === 'undefined' ? globalThis : window);

// @ts-check
'use strict';
(function (root) {
  /** @typedef {import('./data-contracts').XmlSourceElement} XmlSourceElement */
  /** @typedef {import('./data-contracts').XmlSourceToken} XmlSourceToken */
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const domain = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  /** @param {string} source @param {unknown} query */
  function findMatches(source, query, limit = 30) {
    const keyword = String(query).trim().replace(/\s+/g, ' ').toLowerCase();
    if (!keyword || keyword.length > 200) return [];
    const tree = xml.inspectSource(source);
    /** @type {string[]} */
    const chars = [];
    /** @type {number[]} */
    const starts = [];
    /** @type {number[]} */
    const ends = [];
    /** @param {string} value @param {number} start @param {number} end */
    function append(value, start, end) {
      for (const ch of value) {
        const normalized = /\s/.test(ch) ? ' ' : ch;
        if (normalized === ' ' && chars.at(-1) === ' ') continue;
        // Case folding can expand a character; keep each resulting code unit's source range.
        for (const unit of normalized.toLowerCase().split('')) { chars.push(unit); starts.push(start); ends.push(end); }
      }
    }
    /** @param {XmlSourceElement | XmlSourceToken} node */
    function walk(node) {
      if (node.kind === 'text' || node.kind === 'cdata') {
        const begin = node.start + (node.kind === 'cdata' ? 9 : 0), end = node.end - (node.kind === 'cdata' ? 3 : 0);
        const raw = source.slice(begin, end), re = node.kind === 'cdata' ? /[\s\S]/gu : /&(?:#[\d]+|#x[\da-fA-F]+|[\w]+);|[\s\S]/gu;
        for (const match of raw.matchAll(re)) {
          const offset = begin + /** @type {number} */ (match.index);
          append(match[0].startsWith('&') && node.kind !== 'cdata' ? domain.decode(match[0]) : match[0], offset, offset + match[0].length);
        }
      } else if (node.kind === 'element') {
        const block = !['ph', 'b', 'i', 'u', 'xref', 'codeph', 'keyword', 'term', 'sup', 'sub'].includes(node.name);
        if (block) append(' ', node.start, node.start);
        node.children.forEach(walk);
        if (block) append(' ', node.close?.end ?? node.end, node.close?.end ?? node.end);
      }
    }
    walk(tree);
    const text = chars.join(''), result = [];
    for (let offset = text.indexOf(keyword); offset >= 0 && result.length < limit; offset = text.indexOf(keyword, offset + keyword.length)) {
      const start = starts[offset], end = ends[offset + keyword.length - 1];
      result.push({ start, end, line: source.slice(0, start).split('\n').length, excerpt: text.slice(Math.max(0, offset - 35), offset + keyword.length + 65).trim(), matchedSource: source.slice(start, end) });
    }
    return result;
  }
  const api = { findMatches };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaSearchCore = api;
})(typeof window === 'undefined' ? globalThis : window);

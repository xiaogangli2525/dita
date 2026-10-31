'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const domain = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  function findMatches(source, query, limit = 30) {
    query = String(query).trim().replace(/\s+/g, ' ').toLowerCase();
    if (!query || query.length > 200) return [];
    const tree = xml.inspectSource(source), chars = [], starts = [], ends = [];
    function append(value, start, end) {
      for (const ch of value) {
        const normalized = /\s/.test(ch) ? ' ' : ch;
        if (normalized === ' ' && chars.at(-1) === ' ') continue;
        // Case folding can expand a character; keep each resulting code unit's source range.
        for (const unit of normalized.toLowerCase().split('')) { chars.push(unit); starts.push(start); ends.push(end); }
      }
    }
    function walk(node) {
      if (node.kind === 'text' || node.kind === 'cdata') {
        const begin = node.start + (node.kind === 'cdata' ? 9 : 0), end = node.end - (node.kind === 'cdata' ? 3 : 0);
        const raw = source.slice(begin, end), re = node.kind === 'cdata' ? /[\s\S]/gu : /&(?:#[\d]+|#x[\da-fA-F]+|[\w]+);|[\s\S]/gu;
        for (const match of raw.matchAll(re)) append(match[0].startsWith('&') && node.kind !== 'cdata' ? domain.decode(match[0]) : match[0], begin + match.index, begin + match.index + match[0].length);
      } else if (node.kind === 'element') {
        const block = !['ph', 'b', 'i', 'u', 'xref', 'codeph', 'keyword', 'term', 'sup', 'sub'].includes(node.name);
        if (block) append(' ', node.start, node.start);
        node.children.forEach(walk);
        if (block) append(' ', node.close?.end ?? node.end, node.close?.end ?? node.end);
      }
    }
    walk(tree);
    const text = chars.join(''), result = [];
    for (let offset = text.indexOf(query); offset >= 0 && result.length < limit; offset = text.indexOf(query, offset + Math.max(1, query.length))) {
      const start = starts[offset], end = ends[offset + query.length - 1];
      result.push({ start, end, line: source.slice(0, start).split('\n').length, excerpt: text.slice(Math.max(0, offset - 35), offset + query.length + 65).trim(), matchedSource: source.slice(start, end) });
    }
    return result;
  }
  const api = { findMatches };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaSearchCore = api;
})(typeof window === 'undefined' ? globalThis : window);

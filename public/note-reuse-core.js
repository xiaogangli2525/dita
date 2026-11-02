'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const notes = typeof module !== 'undefined' ? require('./footnotes-core') : root.DitaFootnotesCore;
  const manual = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const topics = new Set(['topic', 'concept', 'task', 'reference']);
  function list(files) {
    const result = [];
    for (const [path, file] of files) {
      const tree = xml.inspectSource(file.current), byStart = new Map(notes.listFootnotes(file.current, path).map(note => [note.start, note])), identities = new Set();
      function visit(node, ancestors) {
        const id = manual.decode(node.attrs.id || ''), topic = [...ancestors, node].reverse().find(parent => topics.has(parent.name));
        const topicId = manual.decode(topic?.attrs.id || ''), fragment = topicId + '/' + id;
        if (id) { const key = topics.has(node.name) ? id : fragment; if (identities.has(key)) throw new Error(path + '：重复的元素 ID：' + key); identities.add(key); }
        if (node.name === 'fn' && id && topicId && !node.attrs.conref && !node.attrs.conkeyref && !ancestors.some(parent => ['fn', 'foreign'].includes(parent.name) || parent.attrs.conref || parent.attrs.conkeyref) && ![...ancestors, node].some(parent => parent.attrs['xml:base']) && !/[\s/#?]/.test(id + topicId)) result.push({ ...byStart.get(node.start), fragment, key: path + '#' + fragment });
        for (const child of node.children.filter(child => child.kind === 'element')) visit(child, [...ancestors, node]);
      }
      visit(tree, []);
    }
    return result;
  }
  function href(from, definition) { return from === definition.path ? '#' + definition.fragment.split('/').map(encodeURIComponent).join('/') : manual.relativeHref(from, definition.path, definition.fragment); }
  const api = { list, href };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaNoteReuseCore = api;
})(typeof window === 'undefined' ? globalThis : window);

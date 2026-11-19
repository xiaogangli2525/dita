'use strict';
const { parseFragment } = require('parse5');
const blocks = require('../public/knowledge/knowledge-structure');

// Legacy HTML packages already contain resolved, model-filtered publication DOM.
// Recover only its structure, and bind it to the exact chapter text before use.
function enrichManual(manual) {
  if (!manual.body || manual.entries.every(entry => entry.structure)) return manual;
  const root = blocks.tree(parseFragment(manual.body)), notes = blocks.definitions(root);
  const rawText = node => node.name === '#text' ? node.value || '' : (node.children || []).map(rawText).join('');
  const rawNotes = new Map();
  function scan(node) {
    const content = (node.children || []).find(child => (child.attrs?.class || '').split(/\s+/).includes('footnote-content'));
    if (node.attrs?.id && content) rawNotes.set(node.attrs.id, rawText(content));
    (node.children || []).forEach(scan);
  }
  scan(root);
  const children = root.children || [], starts = children.map((node, index) => node.name === 'h2' ? index : -1).filter(index => index >= 0);
  const entries = manual.entries.map(entry => {
    if (entry.structure) { blocks.validate(entry); return entry; }
    const index = starts.find(position => children[position].attrs.id === entry.anchor);
    if (index == null) throw Error('旧版 HTML 章节与正文不一致，请重新发布：' + entry.title);
    const next = starts.find(position => position > index) ?? children.length;
    const fragment = { name: '#root', children: children.slice(index, next).filter(node => !(node.attrs?.class || '').split(/\s+/).includes('export-footnotes')) };
    const extracted = blocks.extract(fragment, notes, entry.anchor);
    const ids = [];
    function references(node) {
      if (node.name === 'a' && (node.attrs?.href || '').startsWith('#') && node.inFootnoteRef) ids.push(node.attrs.href.slice(1));
      for (const child of node.children || []) references({ ...child, inFootnoteRef: node.inFootnoteRef || (node.attrs?.class || '').split(/\s+/).includes('fn-ref') });
    }
    references(fragment);
    if (blocks.prose([rawText(fragment), ...[...new Set(ids)].map(id => rawNotes.get(id) || '')].join(' ')) !== blocks.prose(entry.text)) throw Error('旧版 HTML 章节正文已变化，请重新发布：' + entry.title);
    return { ...entry, structure: blocks.seal(entry.title, entry.text, extracted.units, extracted.warnings) };
  });
  return { ...manual, entries };
}
function enrichBook(book) { return { ...book, manuals: book.manuals.map(enrichManual) }; }
module.exports = { enrichBook };

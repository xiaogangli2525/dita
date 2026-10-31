'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const sax = typeof module !== 'undefined' ? require('./vendor/sax') : root.sax;
  function textOf(fragment) {
    let text = '';
    const parser = sax.parser(true);
    parser.ontext = parser.oncdata = value => { text += value; };
    parser.write('<wrapper>' + fragment + '</wrapper>').close();
    return text;
  }
  const escapeText = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeAttr = value => escapeText(value).replace(/"/g, '&quot;');
  function listFootnotes(source, path = '') {
    const tree = xml.inspectSource(source);
    const notes = [];
    function walk(node, indexes, ancestors) {
      const end = node.close?.end ?? node.end;
      if (node.name === 'fn') {
        const inner = node.close ? source.slice(node.end, node.close.start) : '';
        const products = textOf(node.attrs.product || '').trim().split(/\s+/).filter(Boolean);
        const parent = [...ancestors].reverse().find(n => ['p', 'row', 'li', 'step', 'section'].includes(n.name)) || ancestors.at(-1);
        const context = parent ? textOf(source.slice(parent.end, parent.close?.start ?? parent.end).replace(source.slice(node.start, end), '')).replace(/\s+/g, ' ').trim() : '';
        notes.push({ path, index: notes.length, xmlPath: indexes.join('/'), start: node.start, end,
          openEnd: node.end, closeStart: node.close?.start ?? node.end,
          before: source.slice(node.start, end), inner, text: textOf(inner), products,
          rich: node.children.some(child => child.kind !== 'text'),
          referenced: Boolean(node.attrs.conref || node.attrs.conkeyref),
          context, source });
      }
      const elements = node.children.filter(child => child.kind === 'element');
      elements.forEach((child, index) => walk(child, [...indexes, index], [...ancestors, node]));
    }
    walk(tree, [], []);
    return notes;
  }
  function updateFootnote(source, note, { content, products = '', rich = note.rich }) {
    if (source !== note.source || source.slice(note.start, note.end) !== note.before) throw new Error('文档已变化，请重新打开这条注脚后再修改');
    if (note.referenced) throw new Error('此注脚引用其他内容，请在引用源中修改');
    const modelNames = [...new Set(products.trim().split(/\s+/).filter(Boolean))].join(' ');
    if (modelNames === note.products.join(' ') && content === (note.rich ? note.inner : note.text)) return source;
    let opening = source.slice(note.start, note.openEnd);
    const attr = /\s+product\s*=\s*(?:"[^"]*"|'[^']*')/;
    const attribute = modelNames ? ' product="' + escapeAttr(modelNames) + '"' : '';
    if (attr.test(opening)) opening = opening.replace(attr, attribute);
    else opening = opening.replace(/\/?\s*>$/, end => attribute + end);
    const unchanged = content === (note.rich ? note.inner : note.text);
    let inner = unchanged ? note.inner : rich ? content : escapeText(content);
    if (!unchanged && source.includes('\r\n')) inner = inner.replace(/\r?\n/g, '\r\n');
    opening = opening.replace(/\/\s*>$/, '>');
    const next = source.slice(0, note.start) + opening + inner + '</fn>' + source.slice(note.end);
    xml.validateXml(next);
    return next;
  }
  function filterNotes(notes, model = '', query = '') {
    const term = query.trim().toLowerCase();
    return notes.filter(note => (!model || !note.products.length || note.products.includes(model)) &&
      (!term || [note.text, note.context, note.path, ...note.products].join(' ').toLowerCase().includes(term)));
  }
  const api = { listFootnotes, updateFootnote, filterNotes };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaFootnotesCore = api;
})(typeof window === 'undefined' ? globalThis : window);

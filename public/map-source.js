'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const { decode } = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const local = node => node.name?.split(':').at(-1);
  const child = (node, name) => node?.children.find(item => item.kind === 'element' && local(item) === name);
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const endOf = node => node.close?.end ?? node.end;

  function locate(source) {
    const map = xml.inspectSource(source);
    if (!['map', 'bookmap'].includes(local(map))) throw new Error('当前文件不是 Map 或 Bookmap');
    const book = local(map) === 'bookmap';
    const container = book ? child(map, 'booktitle') : map;
    const title = child(container, book ? 'mainbooktitle' : 'title') || (book && !container ? child(map, 'title') : undefined);
    let attribute;
    if (!title && (!book || !container) && Object.hasOwn(map.attrs, 'title')) {
      const opening = source.slice(map.start, map.end);
      for (const match of opening.matchAll(/\s+([^\s=/>]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
        if (match[1] !== 'title') continue;
        const start = map.start + match.index + match[0].length - match[3].length - 1;
        attribute = { start, end: start + match[3].length, quote: match[2], text: decode(match[3]) };
      }
    }
    return { map, book, container, title, attribute };
  }

  function titleInfo(source, location) {
    const { map, container, title, attribute } = location;
    const text = title ? title.children.map(node => {
      if (node.kind === 'text') return decode(source.slice(node.start, node.end));
      if (node.kind === 'cdata') return source.slice(node.start + 9, node.end - 3);
      // Display protected markup as plain text without evaluating it in HTML.
      return node.kind === 'element' ? titleInfo(source, { title: node }).text : '';
    }).join('') : attribute?.text || '';
    const referenced = [map, container, title].some(node => node && ['conref', 'conkeyref', 'keyref'].some(name => node.attrs[name]));
    const complex = title?.children.some(node => !['text', 'cdata'].includes(node.kind)) ||
      title?.children.some(node => node.kind === 'cdata') && title.children.some(node => node.kind === 'text');
    const reason = referenced ? '标题使用了内容引用，请在源码模式修改引用或其来源。' :
      complex ? '标题包含行内标记、注释或修订，请在源码模式修改，以保留原有结构。' : '';
    return { text, present: Boolean(title || attribute), editable: !reason, reason };
  }

  function readTitle(source) { return titleInfo(source, locate(source)); }

  // Only the title's source range changes. Encoding declarations, DOCTYPEs,
  // processing instructions, attributes and all unrelated whitespace survive.
  function replaceTitle(source, text) {
    const location = locate(source), info = titleInfo(source, location);
    if (text === info.text) return source;
    if (!info.editable) throw new Error(info.reason);
    const { map, book, container, title, attribute } = location;
    const patch = (start, end, value) => source.slice(0, start) + value + source.slice(end);
    const expand = (node, content) => patch(node.end - 2, node.end, '>' + content + '</' + node.name + '>');
    const qualified = (node, name) => node.name.includes(':') ? node.name.split(':')[0] + ':' + name : name;
    const element = (parent, name, content) => {
      const tag = qualified(parent, name);
      return '<' + tag + '>' + content + '</' + tag + '>';
    };
    let next;
    if (attribute) {
      const escaped = escape(text).replace(attribute.quote === '"' ? /"/g : /'/g, attribute.quote === '"' ? '&quot;' : '&apos;');
      next = patch(attribute.start, attribute.end, escaped);
    } else if (title) {
      const only = title.children[0];
      const content = only?.kind === 'cdata' ? '<![CDATA[' + text.replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>' : escape(text);
      next = title.close ? patch(title.end, title.close.start, content) : expand(title, content);
    } else {
      const parent = container || map;
      let content = element(parent, book ? 'mainbooktitle' : 'title', escape(text));
      if (book && !container) content = element(map, 'booktitle', content);
      // booklibrary precedes mainbooktitle; alternate titles must follow it.
      const library = book && container && child(container, 'booklibrary');
      const position = library ? endOf(library) : parent.end;
      next = parent.close ? patch(position, position, content) : expand(parent, content);
    }
    xml.validateXml(next);
    return next;
  }

  const api = { readTitle, replaceTitle };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaMapSource = api;
})(typeof window === 'undefined' ? globalThis : window);

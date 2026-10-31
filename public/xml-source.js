'use strict';
(function (root) {
  const sax = typeof module !== 'undefined' ? require('./vendor/sax') : root.sax;
  // SAX validates syntax; source ranges add duplicate-attribute/root checks and
  // let formatting preserve every byte outside structural whitespace.
  function scan(source) {
    const tokens = [];
    let i = 0;
    while (i < source.length) {
      const start = i;
      if (source[i] !== '<') {
        const end = source.indexOf('<', i);
        i = end < 0 ? source.length : end;
        tokens.push({ kind: 'text', start, end: i });
        continue;
      }
      let terminator;
      let kind = 'tag';
      if (source.startsWith('<!--', i)) { terminator = '-->'; kind = 'comment'; }
      else if (source.startsWith('<![CDATA[', i)) { terminator = ']]>'; kind = 'cdata'; }
      else if (source.startsWith('<?', i)) { terminator = '?>'; kind = 'pi'; }
      if (terminator) {
        const end = source.indexOf(terminator, i + 2);
        if (end < 0) throw new Error('Unterminated XML ' + kind);
        i = end + terminator.length;
      } else {
        let quote = '', brackets = 0;
        for (i++; i < source.length; i++) {
          const ch = source[i];
          if (quote) { if (ch === quote) quote = ''; }
          else if (ch === '"' || ch === "'") quote = ch;
          else if (ch === '[') brackets++;
          else if (ch === ']') brackets--;
          else if (ch === '>' && brackets === 0) { i++; break; }
        }
        if (source[i - 1] !== '>') throw new Error('Unterminated XML tag');
        if (source.startsWith('<!DOCTYPE', start)) kind = 'doctype';
      }
      tokens.push({ kind, start, end: i });
    }
    return tokens;
  }

  function analyze(source) {
    if (typeof source !== 'string') throw new Error('XML must be text');
    const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
    for (const ch of source) {
      const n = ch.codePointAt(0);
      if (!(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0xd7ff || n >= 0xe000 && n <= 0xfffd || n >= 0x10000 && n <= 0x10ffff)) fail('Invalid XML character');
    }
    const tokens = scan(source);
    const stack = [], roots = [];
    let doctype = false;
    for (const token of tokens) {
      const text = source.slice(token.start, token.end);
      if (token.kind === 'comment' && /--|-$/.test(text.slice(4, -3))) fail('Invalid XML comment');
      if (token.kind === 'doctype') {
        if (doctype || roots.length || stack.length) fail('DOCTYPE must precede the root element');
        doctype = true;
      }
      if (token.kind === 'pi' && /^<\?xml\b/i.test(text)) {
        if (token.start !== (source.charCodeAt(0) === 0xfeff ? 1 : 0) || !/^<\?xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])[A-Za-z][\w.-]*\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*\?>$/.test(text)) fail('Invalid XML declaration');
      }
      if (token.kind === 'text') {
        if (!stack.length && text.replace(/^\uFEFF/, '').trim()) fail('Text outside root element');
        if (text.includes(']]>')) fail('CDATA terminator in text');
      }
      if (token.kind === 'cdata' && !stack.length) fail('CDATA outside root element');
      if (token.kind !== 'tag') {
        if (stack.length) stack.at(-1).children.push(token);
        continue;
      }
      if (text.startsWith('</')) {
        const node = stack.pop();
        if (!node || text.slice(2, -1).trim() !== node.name) fail('Mismatched end tag');
        node.close = token;
        continue;
      }
      const match = /^<([^\s/>]+)/.exec(text);
      if (!match) fail('Invalid start tag');
      const node = { ...token, kind: 'element', name: match[1], children: [], attrs: {} };
      const attrs = text.slice(match[0].length, text.length - (text.endsWith('/>') ? 2 : 1));
      let rest = attrs;
      const names = new Set();
      while (rest.trim()) {
        const attr = /^\s+([^\s=/>]+)\s*=\s*(["'])([\s\S]*?)\2/.exec(rest);
        if (!attr || attr[3].includes('<')) fail('Invalid XML attribute');
        if (names.has(attr[1])) fail('Duplicate XML attribute: ' + attr[1]);
        names.add(attr[1]); node.attrs[attr[1]] = attr[3];
        rest = rest.slice(attr[0].length);
      }
      if (stack.length) stack.at(-1).children.push(node); else roots.push(node);
      if (roots.length > 1) fail('Multiple root elements');
      if (!text.endsWith('/>')) stack.push(node);
    }
    if (stack.length) fail('Unclosed element');
    if (!roots.length) fail('No root element');
    try {
      const parser = sax.parser(true, { xmlns: true });
      parser.onopentag = tag => {
        const expandedNames = new Set();
        for (const attr of Object.values(tag.attributes)) {
          const key = attr.uri + '\0' + attr.local;
          if (expandedNames.has(key)) fail('Duplicate XML attribute namespace: ' + attr.name);
          expandedNames.add(key);
        }
      };
      parser.write(source).close();
    } catch (error) { fail(error.message); }
    return roots[0];
  }

  function validateXml(source) { analyze(source); return true; }
  const BLOCK_CONTAINERS = new Set(('topic concept task reference body conbody taskbody refbody section example ul ol steps steps-unordered step substeps substep table tgroup thead tbody row simpletable strow map bookmap topichead topicgroup topicref chapter part frontmatter backmatter topicmeta').split(' '));
  function formatXml(source) {
    const rootNode = analyze(source);
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    function render(node, depth, preserve = false) {
      preserve = node.attrs['xml:space'] != null && node.attrs['xml:space'] !== 'default' || preserve && node.attrs['xml:space'] !== 'default';
      const end = node.close ? node.close.end : node.end;
      if (preserve || !node.close || !BLOCK_CONTAINERS.has(node.name)) return source.slice(node.start, end);
      const children = node.children.filter(child => child.kind !== 'text' || source.slice(child.start, child.end).trim());
      // Mixed text and CDATA are never rewritten or indented.
      if (!children.length || children.some(child => child.kind === 'text' || child.kind === 'cdata')) return source.slice(node.start, end);
      const content = children.map(child => '  '.repeat(depth + 1) + (child.kind === 'element' ? render(child, depth + 1, preserve) : source.slice(child.start, child.end))).join(eol);
      return source.slice(node.start, node.end) + eol + content + eol + '  '.repeat(depth) + source.slice(node.close.start, node.close.end);
    }
    const end = rootNode.close ? rootNode.close.end : rootNode.end;
    return source.slice(0, rootNode.start) + render(rootNode, 0) + source.slice(end);
  }
  const api = { validateXml, formatXml, inspectSource: analyze };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DitaXmlSource = api;
})(typeof window === 'undefined' ? globalThis : window);

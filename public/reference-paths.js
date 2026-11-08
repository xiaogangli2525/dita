'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const domain = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const references = new Set(['href', 'conref', 'conrefend', 'copy-to', 'longdescref', 'data', 'xlink:href']);
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  function normalize(value) {
    // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted input.
    if (typeof value !== 'string' || !value || /^[/\\]|^[a-z][a-z\d+.-]*:/i.test(value) || /[\x00-\x1f]/.test(value)) fail('请输入仓库内的相对文件路径');
    const parts = [];
    for (const part of value.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) fail('引用路径超出当前仓库'); parts.pop(); } else parts.push(part);
    }
    if (!parts.length) fail('文件路径不能为空'); return parts.join('/');
  }
  function resolve(from, href) {
    if (!href || /^[/\\]|^[a-z][a-z\d+.-]*:/i.test(href)) return null;
    const match = /^([^?#]*)([\s\S]*)$/.exec(href); let pathname;
    try { pathname = decodeURIComponent(match[1]); } catch { fail('引用包含无效的 URI 编码：' + href); }
    const directory = normalize(from).split('/').slice(0, -1).join('/');
    return { path: pathname ? normalize((directory ? directory + '/' : '') + pathname) : normalize(from), suffix: match[2], self: !pathname, directory: /[/]$/.test(pathname) };
  }
  // Patch only reference attribute values; keep declaration/encoding, source
  // whitespace, comments, processing instructions, IDs and text untouched.
  function rebase(source, from, to) {
    from = normalize(from); to = normalize(to); if (from === to) return source;
    const tree = xml.inspectSource(source), patches = [], moved = from.split('/').slice(0, -1).join('/') !== to.split('/').slice(0, -1).join('/');
    function visit(node) {
      if (node.kind !== 'element') return;
      if (domain.decode(node.attrs['xml:base'] || '').trim()) {
        if (moved) fail('文档使用 xml:base，跨目录另存前请先调整基准路径');
        return; // Its unchanged directory/base already retains these references.
      }
      const opening = source.slice(node.start, node.end);
      const next = opening.replace(/(\s+)([^\s=/>]+)(\s*=\s*)(['"])([\s\S]*?)\4/g, (all, space, name, equals, quote, raw) => {
        if (!references.has(name)) return all;
        const value = domain.decode(raw), target = resolve(from, value);
        if (!target || target.self || !moved && target.path !== from) return all;
        const path = target.path === from ? to : target.path;
        const href = domain.relativeHref(to, path) + (target.directory ? '/' : '') + target.suffix;
        if (href === value) return all;
        const escaped = href.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&apos;');
        return space + name + equals + quote + escaped + quote;
      });
      if (next !== opening) patches.push({ start: node.start, end: node.end, text: next });
      node.children.forEach(visit);
    }
    visit(tree);
    for (const patch of patches.sort((a, b) => b.start - a.start)) source = source.slice(0, patch.start) + patch.text + source.slice(patch.end);
    xml.validateXml(source); return source;
  }
  const api = { normalize, resolve, rebase };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaReferencePaths = api;
})(typeof window === 'undefined' ? globalThis : window);

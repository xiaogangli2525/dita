'use strict';
(function (root) {
  const references = new Set('topicref topichead topicgroup chapter appendix notices preface part frontmatter backmatter booklists'.split(' '));
  const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
  // SAX supplies decoded attributes; source-range callers supply their decoder.
  // Keep reading, structural editing and publication on the same inheritance rules.
  function inherit(attrs, parent = {}, decode = value => value) {
    if (attrs['xml:base'] != null) fail('Map 暂不支持 xml:base，请先将引用改为相对 Map 文件的路径并移除 xml:base');
    const scope = decode(attrs.scope || '').trim() || parent.scope || 'local';
    const processingRole = decode(attrs['processing-role'] || '').trim() || parent.processingRole || 'normal';
    if (!['local', 'external'].includes(scope)) fail('Map 暂不支持 scope="' + scope + '"，仅支持 local 或 external');
    if (!['normal', 'resource-only'].includes(processingRole)) fail('Map processing-role 无效：' + processingRole);
    return { scope, processingRole };
  }
  const api = { inherit, isReference: name => references.has(name) };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaMapContext = api;
})(typeof window === 'undefined' ? globalThis : window);

'use strict';
(function (root) {
  function downloadText(content, name, type = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function sha256(content) {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : typeof content?.arrayBuffer === 'function' ? await content.arrayBuffer() : content;
    const hash = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function downloadXML(content, name) {
    const utf8 = content.replace(/^(\uFEFF?<\?xml[^?]*?encoding\s*=\s*)(["'])([^"']*)\2/, (_, prefix, quote) => prefix + quote + 'UTF-8' + quote);
    downloadText(utf8, name, 'application/xml;charset=utf-8');
  }
  const api = { downloadText, downloadXML, sha256 };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaBrowserFiles = api;
})(typeof window === 'undefined' ? globalThis : window);

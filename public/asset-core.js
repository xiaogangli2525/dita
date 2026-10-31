'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const domain = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  function validateImage(name, bytes) {
    const invalid = message => { throw Object.assign(new Error(message), { code: 'INVALID_IMAGE' }); };
    if (typeof name !== 'string' || !name || name.length > 150 || /[\/\\:*?"<>|\x00-\x1f]/.test(name) || name.startsWith('.')) invalid('图片文件名无效');
    if (!/\.(png|jpe?g|gif|bmp|svg|webp)$/i.test(name) || !bytes.length || bytes.length > 2 * 1024 * 1024) invalid('图片须为 PNG/JPEG/GIF/BMP/SVG/WebP，且不超过 2 MiB');
    const ascii = (a, b) => String.fromCharCode(...bytes.subarray(a, b));
    const ext = name.toLowerCase().split('.').pop();
    let valid;
    if (ext === 'png') valid = [137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte);
    else if (/jpe?g/.test(ext)) valid = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    else if (ext === 'gif') valid = /^GIF8[79]a/.test(ascii(0, 6));
    else if (ext === 'bmp') valid = ascii(0, 2) === 'BM';
    else if (ext === 'webp') valid = ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    else {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const tree = xml.inspectSource(text);
        valid = tree.name === 'svg' && !/<!DOCTYPE/i.test(text);
        function inspect(node) {
          if (['script', 'foreignobject'].includes(node.name.split(':').pop().toLowerCase())) valid = false;
          for (const [name, value] of Object.entries(node.attrs)) {
            const local = name.split(':').pop().toLowerCase();
            if (local.startsWith('on') || ['href', 'src'].includes(local) && /^\s*(javascript:|data:)/i.test(domain.decode(value))) valid = false;
          }
          node.children.filter(child => child.kind === 'element').forEach(inspect);
        }
        inspect(tree);
      } catch { valid = false; }
    }
    if (!valid) invalid('图片格式或内容无效');
  }
  const api = { validateImage };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaAssetCore = api;
})(typeof window === 'undefined' ? globalThis : window);

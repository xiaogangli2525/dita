// @ts-check
'use strict';
(function (root) {
  const limits = typeof module !== 'undefined' ? require('./knowledge-limits') : root.DitaKnowledgeLimits;
  const { deflateSync } = /** @type {Pick<typeof import('fflate'), 'deflateSync'>} */ (
    typeof module !== 'undefined' ? require('../vendor/fflate') : root.fflate
  );
  /** @param {string} text */
  function textBytes(text) {
    let size = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 128) size++;
      else if (code < 2048) size += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
      else size += 3;
    }
    return size;
  }
  /** Archive size before compression, including UTF-8 names and directory headers.
   * @param {readonly import('./knowledge-contracts').ArchiveFile[]} files */
  function measureFiles(files) { return files.reduce((bytes, file) => bytes + (typeof file.content === 'string' ? textBytes(file.content) : file.content.byteLength) + 76 + 2 * textBytes(file.name), 22); }
  // Keep STORE for entries where DEFLATE would increase their size.
  /** @param {readonly import('./knowledge-contracts').ArchiveFile[]} files
   * @param {(done:number,total:number)=>void} [onProgress] */
  function createZip(files, onProgress = () => {}) {
    const encoder = new TextEncoder(), local = [], central = [], names = new Set();
    let offset = 0, centralSize = 0, savedBytes = 0;
    const table = Uint32Array.from({ length: 256 }, (_, value) => {
      for (let i = 0; i < 8; i++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
      return value >>> 0;
    });
    /** @param {Uint8Array<ArrayBuffer>} bytes */
    function crc32(bytes) {
      let crc = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) crc = crc >>> 8 ^ table[(crc ^ bytes[i]) & 255];
      return (crc ^ 0xffffffff) >>> 0;
    }
    /** @param {number} size @param {number} signature */
    function header(size, signature) { const data = new Uint8Array(size); new DataView(data.buffer).setUint32(0, signature, true); return data; }
    if (!files.length || files.length > 65535) throw new Error('知识库打包文件数量无效');
    const measured = measureFiles(files);
    limits.assertReadable(measured, '知识库 ZIP');
    // Validate names before encoding content, then retain only immutable Blob
    // parts instead of keeping all UTF-8 buffers alongside the final archive.
    for (const file of files) {
      if (!/^[a-zA-Z0-9_./-]+$/.test(file.name) || file.name.startsWith('/') || file.name.split('/').some(part => !part || part === '.' || part === '..') || names.has(file.name)) throw new Error('知识库打包路径无效或重复');
      names.add(file.name);
      if (file.name.length > 65535) throw new Error('知识库超过 ZIP 大小限制');
    }
    let done = 0;
    for (const file of files) {
      const name = encoder.encode(file.name), data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
      const compressed = deflateSync(data, { level: 3 });
      const method = compressed.byteLength < data.byteLength ? 8 : 0;
      const payload = method === 8 ? compressed : data;
      savedBytes += data.byteLength - payload.byteLength;
      const crc = crc32(data), entry = header(30 + name.length, 0x04034b50), e = new DataView(entry.buffer);
      e.setUint16(4, 20, true); e.setUint16(6, 0x800, true); e.setUint16(8, method, true); e.setUint16(12, 33, true);
      e.setUint32(14, crc, true); e.setUint32(18, payload.length, true); e.setUint32(22, data.length, true); e.setUint16(26, name.length, true); entry.set(name, 30);
      local.push(new Blob([entry, payload]));
      const directory = header(46 + name.length, 0x02014b50), d = new DataView(directory.buffer);
      d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(10, method, true); d.setUint16(14, 33, true);
      d.setUint32(16, crc, true); d.setUint32(20, payload.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
      central.push(directory); centralSize += directory.length; offset += entry.length + payload.length;
      onProgress(++done, files.length);
    }
    const end = header(22, 0x06054b50), view = new DataView(end.buffer);
    view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
    const archive = new Blob([...local, ...central, end], { type: 'application/zip' });
    if (archive.size + savedBytes !== measured) throw new Error('知识库打包内容在生成时发生变化，请重试');
    return archive;
  }
  const api = { createZip, textBytes, measureFiles };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeZip = api;
})(typeof window === 'undefined' ? globalThis : window);

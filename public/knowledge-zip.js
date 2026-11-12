// @ts-check
'use strict';
(function (root) {
  // Portable ZIP STORE writer: UTF-8 filenames, CRC32, no install/runtime needed.
  /** @param {readonly import('./knowledge-contracts').ArchiveFile[]} files */
  function createZip(files) {
    const encoder = new TextEncoder(), local = [], central = [], names = new Set();
    let offset = 0, centralSize = 0;
    const table = Uint32Array.from({ length: 256 }, (_, value) => {
      for (let i = 0; i < 8; i++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
      return value >>> 0;
    });
    /** @param {Uint8Array<ArrayBuffer>} bytes */
    function crc32(bytes) {
      let crc = 0xffffffff;
      for (const byte of bytes) crc = crc >>> 8 ^ table[(crc ^ byte) & 255];
      return (crc ^ 0xffffffff) >>> 0;
    }
    /** @param {number} size @param {number} signature */
    function header(size, signature) { const data = new Uint8Array(size); new DataView(data.buffer).setUint32(0, signature, true); return data; }
    if (!files.length || files.length > 65535) throw new Error('知识库打包文件数量无效');
    for (const file of files) {
      if (!/^[a-zA-Z0-9_./-]+$/.test(file.name) || file.name.startsWith('/') || file.name.split('/').some(part => !part || part === '.' || part === '..') || names.has(file.name)) throw new Error('知识库打包路径无效或重复');
      names.add(file.name);
      const name = encoder.encode(file.name), data = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
      if (offset + data.length > 0xffffffff || name.length > 65535) throw new Error('知识库超过 ZIP 大小限制');
      const crc = crc32(data), entry = header(30 + name.length, 0x04034b50), e = new DataView(entry.buffer);
      e.setUint16(4, 20, true); e.setUint16(6, 0x800, true); e.setUint16(12, 33, true);
      e.setUint32(14, crc, true); e.setUint32(18, data.length, true); e.setUint32(22, data.length, true); e.setUint16(26, name.length, true); entry.set(name, 30);
      local.push(entry, data);
      const directory = header(46 + name.length, 0x02014b50), d = new DataView(directory.buffer);
      d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 33, true);
      d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
      central.push(directory); centralSize += directory.length; offset += entry.length + data.length;
    }
    const end = header(22, 0x06054b50), view = new DataView(end.buffer);
    view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
    return new Blob([...local, ...central, end], { type: 'application/zip' });
  }
  const api = { createZip };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeZip = api;
})(typeof window === 'undefined' ? globalThis : window);

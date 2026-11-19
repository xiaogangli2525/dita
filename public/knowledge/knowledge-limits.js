// @ts-check
'use strict';
(function (root) {
  // Shared by publication and every CLI input/output path. Sizes are UTF-8 bytes.
  const SOURCE_BYTES = 40 * 1024 * 1024;
  const ARCHIVE_BYTES = 64 * 1024 * 1024;
  const UNPACKED_BYTES = 128 * 1024 * 1024;
  /** @param {number} bytes @param {string} [label] */
  function assertReadable(bytes, label = '知识库文件') {
    if (bytes > ARCHIVE_BYTES) throw Error(label + '超过 64 MiB 安全读取上限（' + (bytes / 1024 / 1024).toFixed(2) + ' MiB），请拆分手册集合后重新导出');
  }
  const api = { SOURCE_BYTES, ARCHIVE_BYTES, UNPACKED_BYTES, assertReadable };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeLimits = api;
})(typeof window === 'undefined' ? globalThis : window);

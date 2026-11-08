'use strict';
(function (root) {
  function createReleaseStore(storage) {
    const key = repository => 'dita.releases.v1:' + JSON.stringify(repository);
    function list(repository) {
      let value;
      try { value = JSON.parse(storage.getItem(key(repository)) || '[]'); }
      catch (cause) { throw new Error('交付记录读取失败，请保留浏览器数据后重试', { cause }); }
      if (!Array.isArray(value) || value.some(item => !item || item.schema !== 1 || typeof item.manualPath !== 'string')) throw new Error('交付记录格式损坏，请保留浏览器数据后检查');
      return value;
    }
    function append(repository, record) { storage.setItem(key(repository), JSON.stringify([record, ...list(repository)].slice(0, 50))); }
    return { list, append };
  }
  const api = { createReleaseStore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaReleaseStore = api;
})(typeof window === 'undefined' ? globalThis : window);

// @ts-check
'use strict';
(function (root) {
  /** @param {unknown} value @returns {value is {schema: 1, manualPath: string} & Record<string, unknown>} */
  function isStoredRecord(value) {
    return value !== null && typeof value === 'object' &&
      'schema' in value && value.schema === 1 && 'manualPath' in value && typeof value.manualPath === 'string';
  }
  /** @param {Pick<Storage, 'getItem' | 'setItem'>} storage */
  function createReleaseStore(storage) {
    /** @param {string} repository */
    const key = repository => 'dita.releases.v1:' + JSON.stringify(repository);
    /** @param {string} repository */
    function list(repository) {
      /** @type {unknown} */
      let value;
      try { value = JSON.parse(storage.getItem(key(repository)) || '[]'); }
      catch (cause) { throw new Error('交付记录读取失败，请保留浏览器数据后重试', { cause }); }
      if (!Array.isArray(value) || !value.every(isStoredRecord)) throw new Error('交付记录格式损坏，请保留浏览器数据后检查');
      // Older records may contain only a version and path. Keep the stored fields.
      return value;
    }
    /** @param {string} repository @param {import('../data-contracts').DeliveryRecord} record */
    function append(repository, record) { storage.setItem(key(repository), JSON.stringify([record, ...list(repository)].slice(0, 50))); }
    return { list, append };
  }
  const api = { createReleaseStore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaReleaseStore = api;
})(typeof window === 'undefined' ? globalThis : window);

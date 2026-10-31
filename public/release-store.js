'use strict';
(function (root) {
  function createReleaseStore(storage) {
    const key = repository => 'dita.releases.v1:' + JSON.stringify(repository);
    function list(repository) { try { const value = JSON.parse(storage.getItem(key(repository)) || '[]'); return Array.isArray(value) ? value.filter(item => item.schema === 1 && typeof item.manualPath === 'string') : []; } catch { return []; } }
    function append(repository, record) { storage.setItem(key(repository), JSON.stringify([record, ...list(repository)].slice(0, 50))); }
    return { list, append };
  }
  const api = { createReleaseStore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaReleaseStore = api;
})(typeof window === 'undefined' ? globalThis : window);

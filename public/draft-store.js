'use strict';
(function (root) {
  function createDraftStore(storage) {
    const prefix = 'dita.draft.v1:';
    const key = (scope, path) => prefix + JSON.stringify([scope.root, scope.branch, path]);
    function list(scope) {
      const result = [];
      for (let i = 0; i < storage.length; i++) {
        const name = storage.key(i); if (!name?.startsWith(prefix)) continue;
        try { const value = JSON.parse(storage.getItem(name)); if (value.schema === 1 && value.root === scope.root && value.branch === scope.branch && typeof value.path === 'string' && typeof value.base === 'string' && typeof value.current === 'string') result.push(value); } catch {}
      }
      return result.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    function put(scope, file) {
      if (!scope.root || !file?.path) return;
      if (!file.dirty) { storage.removeItem(key(scope, file.path)); return; }
      storage.setItem(key(scope, file.path), JSON.stringify({ schema: 1, root: scope.root, branch: scope.branch, path: file.path, base: file.disk, current: file.current, updatedAt: Date.now() }));
    }
    return { list, put, remove: (scope, path) => storage.removeItem(key(scope, path)) };
  }
  const api = { createDraftStore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDraftStore = api;
})(typeof window === 'undefined' ? globalThis : window);

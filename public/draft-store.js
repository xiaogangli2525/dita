'use strict';
(function (root) {
  function createDraftStore(storage) {
    const prefix = 'dita.draft.v1:';
    const key = (scope, path) => prefix + JSON.stringify([scope.root, scope.branch, path]);
    let warnings = [];
    function list(scope) {
      warnings = [];
      const result = [];
      for (let i = 0; i < storage.length; i++) {
        const name = storage.key(i); if (!name?.startsWith(prefix)) continue;
        const raw = storage.getItem(name);
        try {
          const value = JSON.parse(raw);
          if (!value || value.schema !== 1 || typeof value.path !== 'string' || typeof value.base !== 'string' || typeof value.current !== 'string') throw new Error('草稿格式无效');
          if (value.root === scope.root && value.branch === scope.branch) result.push(value);
        } catch (error) { warnings.push('有一份草稿损坏，已保留原始数据，未自动删除。'); }
      }
      return result.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    function put(scope, file, previous) {
      if (!scope.root || !file?.path) return;
      if (!file.dirty) {
        const name = key(scope, file.path), raw = storage.getItem(name);
        if (!raw) return;
        const draft = JSON.parse(raw);
        // A clean save/accept may concern the disk version while an older
        // session still has recoverable changes. Compare before removing it.
        if (draft?.schema === 1 && typeof draft.base === 'string' && draft.root === scope.root && draft.branch === scope.branch && draft.path === file.path &&
            (draft.current === file.current || previous?.path === file.path && draft.current === previous.current && draft.base === previous.disk)) storage.removeItem(name);
        return;
      }
      storage.setItem(key(scope, file.path), JSON.stringify({ schema: 1, root: scope.root, branch: scope.branch, path: file.path, base: file.disk, current: file.current, updatedAt: Date.now() }));
    }
    return { list, put, get warnings() { return warnings.slice(); }, remove: (scope, path) => storage.removeItem(key(scope, path)) };
  }
  const api = { createDraftStore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDraftStore = api;
})(typeof window === 'undefined' ? globalThis : window);

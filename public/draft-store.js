'use strict';
(function (root) {
  const legacyPrefix = 'dita.draft.v1:', prefix = 'dita.draft.v2:';
  const identifier = () => root.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  function createDraftStore(storage) {
    // A fresh page owns its own backups, including pages duplicated from a tab.
    // Every revision is immutable so deleting an older snapshot cannot delete a
    // newer write from a different page between getItem and removeItem.
    const owner = identifier(), owned = new Map(), restored = new Map();
    const identity = (scope, path) => JSON.stringify([scope.root, scope.branch, path]);
    const matches = (scope, path, draft) => draft.root === scope.root && draft.branch === scope.branch && draft.path === path;
    let warnings = [];
    function parse(raw, name) {
      const value = JSON.parse(raw), legacy = name.startsWith(legacyPrefix);
      const parts = JSON.parse(name.slice((legacy ? legacyPrefix : prefix).length));
      if (!value || value.schema !== (legacy ? 1 : 2) || typeof value.root !== 'string' || typeof value.branch !== 'string' ||
          typeof value.path !== 'string' || !value.path || typeof value.base !== 'string' || typeof value.current !== 'string' ||
          !Array.isArray(parts) || parts.length !== (legacy ? 3 : 5) || parts[0] !== value.root || parts[1] !== value.branch || parts[2] !== value.path ||
          !legacy && (typeof value.owner !== 'string' || parts[3] !== value.owner || typeof parts[4] !== 'string')) throw new Error('草稿格式无效');
      return { ...value, id: name, serialized: raw, fromCurrentWindow: value.owner === owner };
    }
    function list(scope) {
      warnings = [];
      const result = [];
      for (let i = 0; i < storage.length; i++) {
        const name = storage.key(i); if (!name?.startsWith(prefix) && !name?.startsWith(legacyPrefix)) continue;
        const raw = storage.getItem(name);
        if (raw === null) continue; // Another page can remove an obsolete revision while this list is read.
        try {
          const value = parse(raw, name);
          if (value.root === scope.root && value.branch === scope.branch) result.push(value);
        } catch (error) { warnings.push('有一份草稿损坏，已保留原始数据，未自动删除。'); }
      }
      return result.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    function exact(scope, path, draft) {
      if (!draft || !matches(scope, path, draft) || !draft.id?.startsWith(prefix) && !draft.id?.startsWith(legacyPrefix) ||
          storage.getItem(draft.id) !== draft.serialized) throw new Error('草稿已更新或移除，请重新打开列表核对。');
    }
    function put(scope, file, previous) {
      if (!scope.root || !file?.path) return;
      const key = identity(scope, file.path), oldName = owned.get(key), raw = oldName && storage.getItem(oldName);
      let old = null, damaged = false;
      if (raw) {
        try { old = parse(raw, oldName); }
        catch { damaged = true; warnings.push('有一份草稿损坏，已保留原始数据，未自动删除。'); }
      }
      if (!file.dirty) {
        if (old && (old.current === file.current || previous?.path === file.path && old.current === previous.current && old.base === previous.disk)) {
          storage.removeItem(old.id); owned.delete(key);
        }
        // Only the exact snapshot explicitly restored by this page is consumed
        // after saving it. Competing revisions remain available for comparison.
        for (const draft of restored.get(key)?.values() || []) if (draft.current === file.current && file.disk === file.current) {
          if (storage.getItem(draft.id) === draft.serialized) storage.removeItem(draft.id);
          restored.get(key).delete(draft.id);
        }
        return;
      }
      if (old?.base === file.disk && old.current === file.current) return;
      const name = prefix + JSON.stringify([scope.root, scope.branch, file.path, owner, identifier()]);
      storage.setItem(name, JSON.stringify({ schema: 2, root: scope.root, branch: scope.branch, path: file.path, owner, base: file.disk, current: file.current, updatedAt: Date.now() }));
      owned.set(key, name);
      if (oldName && !damaged) storage.removeItem(oldName);
    }
    function adopt(scope, draft) {
      exact(scope, draft.path, draft);
      const key = identity(scope, draft.path);
      if (!restored.has(key)) restored.set(key, new Map());
      restored.get(key).set(draft.id, draft);
    }
    function remove(scope, path, draft) {
      const key = identity(scope, path);
      if (draft) { exact(scope, path, draft); storage.removeItem(draft.id); }
      else {
        // Discarding an editor buffer never discards another page's recovery copy.
        const name = owned.get(key); if (name) storage.removeItem(name);
        restored.delete(key);
      }
      if (!draft || owned.get(key) === draft.id) owned.delete(key);
    }
    return { list, put, adopt, remove, get warnings() { return warnings.slice(); } };
  }
  const api = { createDraftStore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDraftStore = api;
})(typeof window === 'undefined' ? globalThis : window);

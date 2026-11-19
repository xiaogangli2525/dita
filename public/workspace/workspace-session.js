'use strict';
(function (root) {
  // Only this service replaces workspace identity, document membership and Map
  // metadata. Controllers read live views and request named operations.
  /** @param {Object} [state] Mutable UI-only fields coexist with protected domain views. */
  function createSession(state = {}) {
    const values = { root: '', files: [], maps: [], selectedMap: '', selectedMapSourcePath: '',
      repositories: [], branches: [], currentBranch: '', capabilities: { persistence: 'filesystem', git: true },
      activePath: '', historyTargetPath: '', mode: 'visual', ...state };
    const files = new Map(state.filesMap || []);
    let authorPaths = new Set(state.mapAuthorPaths || []);
    const copy = value => Array.isArray(value) ? Object.freeze(value.map(copy)) : value && typeof value === 'object' ?
      Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))) : value;
    const readonlyMap = Object.freeze({ get: key => files.get(key), has: key => files.has(key),
      get size() { return files.size; }, keys: () => files.keys(), values: () => files.values(), entries: () => files.entries(),
      forEach(callback, thisArg) { files.forEach((value, key) => callback.call(thisArg, value, key, readonlyMap)); },
      [Symbol.iterator]: () => files[Symbol.iterator]() });
    const readonlyPaths = Object.freeze({ has: path => authorPaths.has(path), get size() { return authorPaths.size; },
      values: () => authorPaths.values(), keys: () => authorPaths.keys(), entries: () => authorPaths.entries(),
      forEach(callback, thisArg) { authorPaths.forEach(value => callback.call(thisArg, value, value, readonlyPaths)); },
      [Symbol.iterator]: () => authorPaths[Symbol.iterator]() });
    const fields = ['root', 'files', 'maps', 'selectedMap', 'selectedMapSourcePath', 'repositories', 'branches',
      'currentBranch', 'capabilities', 'activePath', 'historyTargetPath', 'mode'];
    for (const key of fields) {
      values[key] = copy(values[key]);
      Object.defineProperty(state, key, { enumerable: true, configurable: false, get: () => values[key] });
    }
    Object.defineProperties(state, { filesMap: { enumerable: true, get: () => readonlyMap },
      mapAuthorPaths: { enumerable: true, get: () => readonlyPaths } });
    function defaultMap(preferred = '') {
      return values.maps.find(map => map.path === preferred)?.path || values.maps.find(map =>
        map.path.split('/').pop().replace(/\.ditamap$/i, '') === values.currentBranch)?.path || values.maps[0]?.path || '';
    }
    function validateWorkspace(result) {
      if (!result || typeof result.root !== 'string' || typeof result.workspaceToken !== 'string' || !result.workspaceToken ||
          !Array.isArray(result.files) || !Array.isArray(result.maps) || result.maps.some(map => !map || typeof map.path !== 'string') ||
          result.currentBranch !== undefined && typeof result.currentBranch !== 'string' ||
          result.branches !== undefined && !Array.isArray(result.branches) ||
          result.capabilities !== undefined && (!result.capabilities || typeof result.capabilities.persistence !== 'string' || typeof result.capabilities.git !== 'boolean')) {
        throw Error('工作区响应无效，当前编辑内容已保留');
      }
    }
    function updateDirectory(result, preserve = false) {
      const previous = values.selectedMap;
      values.root = result.root; values.files = copy(result.files);
      // A directory refresh reads disk. Keep a dirty Map's last valid projection
      // until its own guarded source resolver publishes a newer one.
      values.maps = copy(result.maps.map(map => preserve && files.get(map.path)?.dirty ?
        values.maps.find(item => item.path === map.path) || map : map));
      values.currentBranch = result.currentBranch ?? (preserve ? values.currentBranch : '');
      values.branches = copy(result.branches ?? (preserve ? values.branches : []));
      values.capabilities = copy(result.capabilities ?? (preserve ? values.capabilities : { persistence: 'filesystem', git: true }));
      values.selectedMap = defaultMap(preserve ? previous : '');
      if (!preserve || values.selectedMap !== previous) values.selectedMapSourcePath = '';
    }
    function replaceWorkspace(result) {
      validateWorkspace(result); updateDirectory(result);
      files.clear(); authorPaths = new Set(); values.activePath = ''; values.historyTargetPath = '';
    }
    function registerDocument(file) {
      if (!file || typeof file.path !== 'string' || !file.path || typeof file.current !== 'string') throw TypeError('文档记录无效');
      if (!files.has(file.path)) files.set(file.path, file);
      return files.get(file.path);
    }
    function closeDocument(path) {
      files.delete(path); authorPaths.delete(path);
      if (values.activePath === path) { values.activePath = [...files.keys()].pop() || ''; values.historyTargetPath = values.activePath; }
      else if (values.historyTargetPath === path) values.historyTargetPath = values.activePath;
    }
    function activateDocument(path) {
      if (!files.has(path)) throw Error('文档尚未加载：' + path);
      values.activePath = path; values.historyTargetPath = path;
    }
    function upsertMap(map) {
      if (!map || typeof map.path !== 'string') throw TypeError('Map 路径无效');
      const index = values.maps.findIndex(item => item.path === map.path), maps = [...values.maps];
      if (index < 0) maps.push(copy(map)); else maps[index] = copy(map);
      values.maps = Object.freeze(maps);
    }
    return Object.freeze({ validateWorkspace, replaceWorkspace,
      refreshDirectory(result) { validateWorkspace(result); updateDirectory(result, true); },
      registerDocument, closeDocument, activateDocument, upsertMap,
      updateMapTitle(path, title) { const map = values.maps.find(item => item.path === path); if (map) upsertMap({ ...map, title }); },
      ensureFile(entry) { if (!values.files.some(file => file.path === entry.path)) values.files = copy([...values.files, entry]); },
      setRepositories(repositories) { if (!Array.isArray(repositories)) throw TypeError('仓库列表无效'); values.repositories = copy(repositories); },
      selectMap(path) { if (path && !values.maps.some(map => map.path === path)) throw Error('手册不存在：' + path); values.selectedMap = path; values.selectedMapSourcePath = ''; },
      selectMapSource(path) { values.selectedMapSourcePath = path; },
      setHistoryTarget(path) { if (path && !files.has(path)) throw Error('历史目标尚未加载：' + path); values.historyTargetPath = path; },
      setAuthorPaths(paths) { authorPaths = new Set(paths); },
      setMode(mode) { if (!['visual', 'editor', 'preview', 'review'].includes(mode)) throw TypeError('编辑模式无效'); values.mode = mode; }
    });
  }
  const api = { createSession };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaWorkspaceSession = api;
})(typeof window === 'undefined' ? globalThis : window);

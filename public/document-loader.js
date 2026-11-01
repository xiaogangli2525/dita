'use strict';
(function (root) {
  const store = typeof module !== 'undefined' ? require('./document-store') : root.DitaDocumentStore;
  // Topic tabs and Map surfaces share one load per document/workspace. A late
  // read may populate an empty cache, but never replace an acknowledged buffer.
  function createDocumentLoader({ state, api, events }) {
    const pending = new Map(), revisions = new Map(); let generation = 0;
    function load(path) {
      const cached = state.filesMap.get(path); if (cached) return Promise.resolve(cached);
      if (pending.has(path)) return pending.get(path);
      const workspace = api.token, started = generation, revision = revisions.get(path);
      const task = (async () => {
        const [response, gitResponse] = await Promise.all([api.request('/api/file?path=' + encodeURIComponent(path)), api.request('/api/git?path=' + encodeURIComponent(path))]);
        if (!response.ok) throw new Error(path + '：' + await (api.error ? api.error(response) : response.text()));
        const content = await response.text(), git = await gitResponse.json().catch(() => ({}));
        if (workspace !== api.token || started !== generation || revision !== revisions.get(path)) throw new Error('工作区或文档已关闭，已忽略旧的加载结果');
        const current = state.filesMap.get(path); if (current) return current;
        const file = store.createDocument({ path, content, baseline: git.available ? git.content : content, gitStatus: git.status || 'unknown' });
        state.filesMap.set(path, file); return file;
      })().finally(() => { if (pending.get(path) === task) pending.delete(path); });
      pending.set(path, task); return task;
    }
    events.on('workspace:willChange', () => { generation++; pending.clear(); revisions.clear(); });
    events.on('file:closed', path => { revisions.set(path, (revisions.get(path) || 0) + 1); pending.delete(path); });
    return { load };
  }
  const api = { createDocumentLoader };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDocumentLoader = api;
})(typeof window === 'undefined' ? globalThis : window);

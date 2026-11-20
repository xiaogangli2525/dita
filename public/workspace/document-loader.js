// @ts-check
'use strict';
(function (root) {
  /** @typedef {import('../data-contracts').DocumentState} DocumentState */
  /** @typedef {import('../data-contracts').CapturePorts['api']} WorkspaceApi */
  const store = typeof module !== 'undefined' ? require('../document-store') : root.DitaDocumentStore;
  const browserFiles = typeof module !== 'undefined' ? require('../browser-files') : root.DitaBrowserFiles;

  /** @param {Pick<WorkspaceApi, 'request'>} api @param {string} path */
  async function readGit(api, path) {
    try {
      const response = await api.request('/api/git?path=' + encodeURIComponent(path));
      if (!response.ok) return null;
      /** @type {unknown} */
      const value = await response.json();
      if (!value || typeof value !== 'object' || !('available' in value)) return null;
      const status = 'status' in value && typeof value.status === 'string' && value.status || 'unknown';
      if (value.available === false) return { status };
      if (value.available === true && 'content' in value && typeof value.content === 'string') return { baseline: value.content, status };
      return null;
    } catch {
      // Git data is optional. The loader still checks the lifetime of the file
      // request before accepting its disk content.
      return null;
    }
  }

  // Topic tabs and Map surfaces share one load per document/workspace. A late
  // read may populate an empty cache, but never replace an acknowledged buffer.
  /** @param {{state: {readonly filesMap: ReadonlyMap<string, DocumentState>},
   * session: {registerDocument(file: DocumentState): DocumentState},
   * api: Pick<WorkspaceApi, 'token' | 'request'> & Partial<Pick<WorkspaceApi, 'error'>>,
   * events: {on(name: 'workspace:willChange', callback: () => void): unknown,
   * on(name: 'file:closed', callback: (path: string) => void): unknown}}} ports */
  function createDocumentLoader({ state, session, api, events }) {
    /** @type {Map<string, Promise<DocumentState>>} */
    const pending = new Map();
    /** @type {Map<string, number>} */
    const revisions = new Map();
    let generation = 0;
    /** @param {string} path */
    function load(path) {
      const cached = state.filesMap.get(path); if (cached) return Promise.resolve(cached);
      const inFlight = pending.get(path); if (inFlight) return inFlight;
      const workspace = api.token, started = generation, revision = revisions.get(path);
      const task = (async () => {
        const disk = api.request('/api/file?path=' + encodeURIComponent(path)).then(async response => {
          if (!response.ok) throw new Error(path + '：' + await (api.error ? api.error(response) : response.text()));
          return browserFiles.readXmlResponse(response);
        });
        const [content, git] = await Promise.all([disk, readGit(api, path)]);
        if (workspace !== api.token || started !== generation || revision !== revisions.get(path)) throw new Error('工作区或文档已关闭，已忽略旧的加载结果');
        const current = state.filesMap.get(path); if (current) return current;
        const file = store.createDocument({ path, content, baseline: git?.baseline ?? content, gitStatus: git?.status ?? 'unknown' });
        return session.registerDocument(file);
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

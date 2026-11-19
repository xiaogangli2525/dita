// @ts-check
'use strict';
(function (root) {
  /** @typedef {import('../data-contracts').DocumentState} DocumentState */
  /** @typedef {import('../data-contracts').WorkspaceState} WorkspaceState */
  /** @typedef {import('../data-contracts').MapEntry} MapEntry */
  /**
   * @param {{state: Pick<WorkspaceState, 'activePath' | 'filesMap' | 'maps' | 'mode' | 'selectedMap'>,
   * session: {activateDocument(path: string): void, closeDocument(path: string): void},
   * dom: {editor: HTMLTextAreaElement}, api: {readonly token: string},
   * events: {on(name: string, callback: () => void): unknown, emit(name: string, payload?: DocumentState | string): void},
   * ditaCore: {collectPreviewPaths(entries: readonly MapEntry[]): readonly MapEntry[]},
   * setMode(mode: WorkspaceState['mode']): void, ensureMapAuthorFile(path: string): Promise<DocumentState>,
   * setStatus(message: string, error?: boolean): void, shell?: {sidebar(open: boolean): void}, footnotes?: {setScope(path: string): void}}} A
   * @param {{renderTabs(): void, updateActivePanes(): void, updateHistoryButtons(): void, updateTree(): void}} views
   */
  function createController(A, { renderTabs, updateActivePanes, updateHistoryButtons, updateTree }) {
    const { state, session, dom, ditaCore, setMode, ensureMapAuthorFile, setStatus } = A;
    let openRevision = 0;
    A.events.on('workspace:willChange', () => { openRevision++; });
    A.events.on('file:opened', () => { openRevision++; });
    A.events.on('file:closed', () => { openRevision++; });
    /** @param {string} path */
    async function openFile(path, { preserveFootnotesScope = false } = {}) {
      const revision = ++openRevision, workspace = A.api.token;
      A.events.emit('file:opening', path);
      let file;
      try { file = await ensureMapAuthorFile(path); }
      catch (error) {
        if (revision !== openRevision || workspace !== A.api.token) return null;
        setStatus('打开失败：' + path + ' · ' + (error instanceof Error ? error.message : String(error)), true); throw error;
      }
      if (revision !== openRevision || workspace !== A.api.token || state.filesMap.get(path) !== file) return null;
      A.shell?.sidebar(false);
      session.activateDocument(path);
      if (!preserveFootnotesScope) {
        const manual = state.maps.find(map => map.path === state.selectedMap);
        const inManual = manual && ditaCore.collectPreviewPaths(manual.children || []).some(entry => entry.path === path);
        A.footnotes?.setScope(inManual ? manual.path : path);
      }
      const reviewableModes = ['visual', 'preview', 'review'];
      setMode(reviewableModes.includes(state.mode) ? state.mode : 'visual');
      renderTabs();
      updateActivePanes();
      updateHistoryButtons();
      updateTree();
      A.events.emit('file:opened', state.filesMap.get(path));
      const git = state.filesMap.get(path)?.gitStatus || 'unknown';
      setStatus(git === 'clean' ? 'Git\uFF1A\u65E0\u672A\u63D0\u4EA4\u4FEE\u6539' : `Git\uFF1A${git}`);
      return file;
    }

    /** @param {string} path @param {number} [start] @param {number} [end] @param {string} [expected] */
    async function navigateToSource(path,start=0,end=start,expected) {
      const token=A.api.token,file=await openFile(path,{preserveFootnotesScope:true});
      if(token!==A.api.token||!file||state.activePath!==path)throw Error('打开位置已变化，请重新选择来源');
      if(expected!==undefined&&file.current.slice(start,end)!==expected)throw Error('内容已变化');
      setMode('editor');dom.editor.focus();dom.editor.setSelectionRange(start,end);dom.editor.scrollTop=Math.max(0,file.current.slice(0,start).split('\n').length-5)*22;
    }
    /** @param {string} path */
    function closeFile(path) {
      const file = state.filesMap.get(path);
      if (file?.dirty && !confirm(`${path} \u5C1A\u672A\u4FDD\u5B58\uFF0C\u786E\u5B9A\u5173\u95ED\uFF1F`)) return;
      const wasActive = state.activePath === path;
      if (file?.dirty) A.events.emit('file:discarded', file);
      session.closeDocument(path); A.events.emit('file:closed', path);
      if (wasActive) {
        const nextMode = state.activePath ? state.mode : 'visual';
        setMode(nextMode);
        if (nextMode === 'editor') updateActivePanes();
      }
      renderTabs();
      updateTree();
    }

    return { openFile, closeFile, navigateToSource };
  }
  const api = { createController };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDocumentNavigation = api;
})(typeof window === 'undefined' ? globalThis : window);

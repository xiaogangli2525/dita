'use strict';
(function (root) {
  function createController(A, { renderTabs, updateActivePanes, updateHistoryButtons, updateTree }) {
    const { state, dom, ditaCore, setMode, ensureMapAuthorFile, setStatus } = A;
    let openRevision = 0;
    A.events.on('workspace:willChange', () => { openRevision++; });
    A.events.on('file:opened', () => { openRevision++; });
    A.events.on('file:closed', () => { openRevision++; });
    async function openFile(path, { preserveFootnotesScope = false } = {}) {
      const revision = ++openRevision, workspace = A.api.token;
      A.events.emit('file:opening', path);
      let file;
      try { file = await ensureMapAuthorFile(path); }
      catch (error) {
        if (revision !== openRevision || workspace !== A.api.token) return null;
        setStatus('打开失败：' + path + ' · ' + error.message, true); throw error;
      }
      if (revision !== openRevision || workspace !== A.api.token || state.filesMap.get(path) !== file) return null;
      A.shell?.sidebar(false);
      state.activePath = path;
      if (!preserveFootnotesScope) {
        const manual = state.maps.find(map => map.path === state.selectedMap);
        const inManual = manual && ditaCore.collectPreviewPaths(manual.children || []).some(entry => entry.path === path);
        A.footnotes?.setScope(inManual ? manual.path : path);
      }
      state.historyTargetPath = path;
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

    async function navigateToSource(path,start=0,end=start,expected) {
      const token=A.api.token,file=await openFile(path,{preserveFootnotesScope:true});
      if(token!==A.api.token||!file||state.activePath!==path)throw Error('打开位置已变化，请重新选择来源');
      if(expected!==undefined&&file.current.slice(start,end)!==expected)throw Error('内容已变化');
      setMode('editor');dom.editor.focus();dom.editor.setSelectionRange(start,end);dom.editor.scrollTop=Math.max(0,file.current.slice(0,start).split('\n').length-5)*22;
    }
    function closeFile(path) {
      const file = state.filesMap.get(path);
      if (file?.dirty && !confirm(`${path} \u5C1A\u672A\u4FDD\u5B58\uFF0C\u786E\u5B9A\u5173\u95ED\uFF1F`)) return;
      state.filesMap.delete(path); A.events.emit('file:closed', path);
      if (state.activePath === path) {
        state.activePath = Array.from(state.filesMap.keys()).pop() || '';
        state.historyTargetPath = state.activePath;
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

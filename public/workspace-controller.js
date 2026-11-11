'use strict';
(function (root) {
  const reviewSession = typeof module !== 'undefined' ? require('./review-session') : root.DitaReviewSession;
  function createController(A, views) {
    const { state, session, dom, setStatus, toast } = A;
    const { renderWorkspaceSwitches, renderMapPicker, renderTabs, updateActivePanes,
      updateTree, setActiveView, setSwitching = () => {},
      confirmDiscard = message => root.confirm(message) } = views;
    const request = A.api.request;
    let busy = false;

    function allowDiscard() {
      const dirty = [...state.filesMap.values()].filter(file => file.dirty);
      return !dirty.length || confirmDiscard(`以下文件尚未保存，切换将丢弃未保存内容：\n\n${dirty.map(file => file.path).join('\n')}\n\n继续吗？`);
    }
    async function reloadWorkspace(result) {
      const previouslyBusy = busy;
      busy = true; setSwitching(true);
      try {
        session.validateWorkspace(result);
        A.events.emit('workspace:willChange');
        A.api.adopt(result.workspaceToken);
        A.releaseExportPreview?.();
        session.replaceWorkspace(result);
        A.footnotes?.setScope('');
        reviewSession.clearReviewState(state);
        state.selectedVisualElement = null;
        dom.rootPath.textContent = result.root;
        dom.rootPath.title = result.root;
        dom.editor.value = '';
        renderWorkspaceSwitches(); renderMapPicker(); renderTabs(); updateActivePanes(); updateTree('');
        setActiveView(state.activeView);
        await A.project.load();
        A.events.emit('workspace:changed');
      } finally { busy = previouslyBusy; setSwitching(busy); }
    }
    async function loadRepositories() {
      const response = await request('/api/repos');
      if (!response.ok) throw Error(await A.api.error(response));
      session.setRepositories((await response.json()).repositories);
      renderWorkspaceSwitches();
    }
    async function switchWorkspace(kind) {
      if (busy || A.saving) {
        renderWorkspaceSwitches(); setStatus('当前操作尚未完成，请稍后切换'); return;
      }
      if (!allowDiscard()) { renderWorkspaceSwitches(); return; }
      const branch = kind === 'branch', label = branch ? '分支' : '仓库';
      const value = (branch ? dom.branchSelect : dom.repositorySelect).value;
      busy = true; setSwitching(true); setStatus('正在切换' + label + '…');
      try {
        const response = await request('/api/' + kind, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [kind]: value })
        });
        if (!response.ok) throw Error(await A.api.error(response));
        await reloadWorkspace(await response.json());
        setStatus(label + '已切换' + (branch ? '：' + value : ''));
      } catch (error) {
        renderWorkspaceSwitches(); setStatus('切换' + label + '失败：' + error.message, true);
        if (branch) toast(error.message, 'error');
      } finally { busy = false; setSwitching(false); }
    }
    async function refreshWorkspaceTree() {
      const response = await request('/api/workspace');
      if (!response.ok) throw Error(await A.api.error(response));
      const result = await response.json();
      if (result.workspaceToken !== A.api.token) throw Error('工作区已在其他窗口切换，请保留修改后刷新');
      session.refreshDirectory(result);
      dom.rootPath.textContent = state.root;
      dom.rootPath.title = state.root;
      renderWorkspaceSwitches(); renderMapPicker(); updateTree(''); setActiveView(state.activeView);
    }
    async function initialize() {
      busy = true; setSwitching(true);
      try {
        const [workspace, repositories] = await Promise.all([request('/api/workspace'), request('/api/repos')]);
        if (!workspace.ok) throw Error(await A.api.error(workspace));
        if (!repositories.ok) throw Error(await A.api.error(repositories));
        const result = await workspace.json();
        session.setRepositories((await repositories.json()).repositories);
        await reloadWorkspace(result);
        setStatus('就绪');
      } catch (error) { setStatus('初始化失败：' + error.message, true); }
      finally { busy = false; setSwitching(false); }
    }
    return { reloadWorkspace, loadRepositories, refreshWorkspaceTree, initialize,
      selectRepository: () => switchWorkspace('repository'), selectBranch: () => switchWorkspace('branch'),
      get busy() { return busy; } };
  }
  const api = { createController };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaWorkspaceController = api;
})(typeof window === 'undefined' ? globalThis : window);

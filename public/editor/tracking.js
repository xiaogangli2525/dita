// @ts-check
'use strict';
(function (root) {
  /** @typedef {import('../data-contracts').DocumentState} DocumentState */
  /** @typedef {import('../data-contracts').WorkspaceState} WorkspaceState */
  /** @typedef {{
   * trackingDialog: HTMLDialogElement, trackingButton: HTMLButtonElement, trackingEnabled: HTMLInputElement,
   * trackingAuthor: HTMLInputElement, trackingError: HTMLElement, trackingForm: HTMLFormElement,
   * trackingCancel: HTMLButtonElement, reviewScope: HTMLSelectElement
   * }} TrackingElements */
  /** @param {{
   * state: Pick<WorkspaceState, 'activePath' | 'filesMap' | 'mapAuthorPaths'>,
   * dom: {editor: HTMLTextAreaElement}, api: {readonly token: string},
   * events: {on(name: string, callback: () => void): unknown},
   * setFileContent(file: DocumentState, content: string, options: {origin: 'tracking'}): boolean,
   * setStatus(message: string): void, toast(message: string, kind: 'info'): void
   * }} A */
  function createController(A) {
    const core = root.DitaOxygenTracking;
    /** @template {keyof TrackingElements} K @param {K} id */
    const get = id => /** @type {TrackingElements[K]} */ (document.getElementById(id));
    const dialog = get('trackingDialog'), button = get('trackingButton');
    let author = '';
    /** @type {{file: DocumentState, content: string, workspace: string, path: string} | null} */
    let target = null;
    try { author = root.localStorage.getItem('dita.tracking.author') || ''; }
    catch { A.toast('修订作者仅在本页保留，浏览器存储不可用', 'info'); }
    /** @param {DocumentState} file */
    function active(file) {
      const map = A.state.filesMap.get(A.state.activePath);
      if (map && /\.ditamap$/i.test(map.path) && A.state.mapAuthorPaths.has(file.path) && core.setting(map.current) !== null) return core.enabled(map.current);
      return core.enabled(file.current);
    }
    function sync() {
      const file = A.state.filesMap.get(A.state.activePath), on = file && active(file);
      button.disabled = !file; button.textContent = on ? '跟踪修订：开' : '跟踪修订：关';
      button.setAttribute('aria-pressed', String(Boolean(on)));
      A.dom.editor.readOnly = Boolean(on);
      A.dom.editor.title = on ? '跟踪修订时源码只读；请在编写模式编辑，或关闭跟踪后修改源码' : '';
    }
    function show() {
      const file = A.state.filesMap.get(A.state.activePath); if (!file) return;
      target = { file, content: file.current, workspace: A.api.token, path: A.state.activePath };
      get('trackingEnabled').checked = active(file); get('trackingAuthor').value = author;
      get('trackingError').textContent = ''; dialog.showModal();
    }
    /** @param {DocumentState} file @param {string} content */
    function prepare(file, content) {
      if (content === file.current || !active(file)) return content;
      if (root.DitaOxygenCore.hasUnsupportedChanges(file.current)) throw new Error('文档含尚不支持的 Oxygen 属性、CDATA 修订或批注回复，请先在 Oxygen 中处理');
      const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '+0000');
      const result = core.trackEdit(file.current, content, { author, timestamp, id: 'dita-' + root.crypto.randomUUID() });
      return core.enabled(result) ? result : core.setEnabled(result, true);
    }
    get('trackingForm').addEventListener('submit', event => {
      event.preventDefault();
      try {
        if (!target || target.workspace !== A.api.token || target.path !== A.state.activePath || A.state.filesMap.get(target.file.path) !== target.file || target.file.current !== target.content) throw new Error('文档或工作区已变化，请重新打开跟踪设置');
        const nextAuthor = get('trackingAuthor').value.trim(), on = get('trackingEnabled').checked;
        if (on && !nextAuthor) throw new Error('请填写修订作者');
        const content = core.setEnabled(target.content, on);
        A.setFileContent(target.file, content, { origin: 'tracking' });
        author = nextAuthor;
        try { root.localStorage.setItem('dita.tracking.author', author); }
        catch { A.toast('修订作者仅在本页保留，浏览器存储不可用', 'info'); }
        if (on) get('reviewScope').value = 'oxygen';
        dialog.close(); sync();
        A.setStatus((on ? '已开启 Oxygen 兼容跟踪修订' : '已关闭后续修改跟踪，已有修订仍保留') + '；保存后写入文件');
      } catch (error) { get('trackingError').textContent = error instanceof Error ? error.message : String(error); }
    });
    get('trackingCancel').addEventListener('click', () => dialog.close());
    button.addEventListener('click', show);
    A.events.on('file:opened', () => {
      sync(); const file = A.state.filesMap.get(A.state.activePath);
      if (file && active(file)) get('reviewScope').value = 'oxygen';
    });
    for (const name of ['file:closed', 'document:changed', 'workspace:changed', 'author:rendered']) A.events.on(name, sync);
    A.events.on('workspace:willChange', () => { target = null; dialog.close(); });
    sync(); return { active, prepare, sync, show };
  }
  const api = { createController };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaTracking = api;
})(typeof window === 'undefined' ? globalThis : window);

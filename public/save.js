// @ts-check
'use strict';
(function (root) {
  /** @param {import('./data-contracts').SavePorts} A */
  function createSaveController(A) {
    /** @template {keyof import('./data-contracts').SaveElements} K
     * @param {K} id */
    const get = id => /** @type {import('./data-contracts').SaveElements[K]} */ (document.getElementById(id));
    /** @type {{snapshot:import('./data-contracts').ManualSnapshot,candidates:readonly import('./data-contracts').DocumentSnapshot[]}|null} */
    let configuration = null;
    let preparing = false;
    const persist = root.DitaDocumentStore.createSaveCoordinator(async snapshot => {
      const response = await A.api.request('/api/file', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot) });
      if (!response.ok) throw new Error(await A.api.error(response));
      return response.json();
    });
    /** @param {readonly import('./data-contracts').DocumentSnapshot[]} files
     * @param {string} workspace */
    async function write(files, workspace) {
      if (A.saving) return false;
      A.saving = true; A.refreshChrome();
      try {
        if (workspace !== A.api.token) throw new Error('工作区已切换，请重新保存');
        const submissions = files.map(snapshot => {
          A.validateXml(snapshot.current);
          const file = A.state.filesMap.get(snapshot.path);
          if (!file) throw new Error('文档已关闭，请重新打开：' + snapshot.path);
          const request = { path: snapshot.path, content: snapshot.current, expectedContent: snapshot.disk };
          return { file, request };
        });
        if (submissions.length === 1) {
          const { file, request } = submissions[0];
          await persist(file, request);
        } else {
          for (const { file } of submissions) root.DitaDocumentStore.breakHistoryGroup(file);
          const response = await A.api.request('/api/file/batch', {
            method: 'PUT', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ files: submissions.map(({ request }) => request) })
          });
          if (!response.ok) throw new Error(await A.api.error(response));
          if ((await response.json())?.saved !== true) throw new Error('未收到完整的批量保存回执，请核对磁盘状态');
          // The server acknowledges exactly the encoded request. Advance all
          // baselines together and retain edits made while the batch was writing.
          for (const { file, request } of submissions) {
            if (file.disk === request.expectedContent) root.DitaDocumentStore.acknowledgeSave(file, request, false);
          }
        }
        for (const { file } of submissions) if (A.state.filesMap.get(file.path) === file) A.events.emit('document:changed', file);
        A.refreshFiles();
        const pending = Array.from(A.state.filesMap.values()).filter(file => file.dirty).length;
        A.setStatus(`已保存 ${files.length} 个文档到${A.state.capabilities.persistence === 'browser' ? '浏览器' : '磁盘'}${A.state.capabilities.git ? ' · 尚未提交 Git' : ''}` + (pending ? ` · 仍有 ${pending} 个文档待保存` : ''));
        return true;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        A.setStatus('保存失败：' + error.message, true);
        A.toast(error.message, 'error'); return false;
      } finally { A.saving = false; A.refreshFiles(); A.refreshChrome(); }
    }
    async function saveCurrent() {
      if (preparing || A.saving || get('saveScopeDialog').open) return;
      const file = A.state.filesMap.get(A.state.activePath);
      if (!file) return false;
      if (!/\.ditamap$/i.test(file.path)) return write([root.DitaDocumentStore.snapshotDocument(file)], A.api.token);
      preparing = true;
      try {
        const snapshot = await A.manual.capture(file.path), candidates = A.manual.saveCandidates(snapshot);
        if (!candidates.length) { const pending = Array.from(A.state.filesMap.values()).filter(file => file.dirty).length; A.setStatus('当前可解析手册范围没有待保存修改' + (pending ? '；工作区仍有 ' + pending + ' 个文件待保存' : '')); return true; }
        configuration = { snapshot, candidates };
        get('saveScopeTitle').textContent = snapshot.map.title + ' · 保存范围';
        get('saveScopeList').replaceChildren();
        for (const file of candidates) {
          const label = document.createElement('label'), check = document.createElement('input');
          check.type = 'checkbox'; check.checked = true; check.value = file.path;
          label.append(check, document.createTextNode(file.path)); get('saveScopeList').append(label);
        }
        get('saveScopeError').textContent = ''; get('saveScopeDialog').showModal();
      } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); A.setStatus(message, true); A.toast(message, 'error'); }
      finally { preparing = false; }
    }
    get('saveScopeCancel').addEventListener('click', () => get('saveScopeDialog').close());
    get('saveScopeForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!configuration || !A.manual.current(configuration.snapshot)) { get('saveScopeError').textContent = '内容或工作区已变化，请重新打开保存范围'; return; }
      const selected = new Set(Array.from(get('saveScopeList').querySelectorAll('input:checked'), node => /** @type {HTMLInputElement} */ (node).value));
      if (!selected.size) { get('saveScopeError').textContent = '请至少选择一个文档'; return; }
      const files = configuration.candidates.filter(file => selected.has(file.path));
      get('saveScopeDialog').close(); await write(files, configuration.snapshot.workspace);
    });
    return { saveCurrent };
  }
  const api = { createSaveController };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaSave = api;
})(typeof window === 'undefined' ? globalThis : window);

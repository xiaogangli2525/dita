'use strict';
(function (root) {
  function createSaveController(A) {
    const get = id => document.getElementById(id);
    let configuration = null, preparing = false;
    const persist = root.DitaDocumentStore.createSaveCoordinator(async snapshot => {
      const response = await A.api.request('/api/file', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot) });
      if (!response.ok) throw new Error(await A.api.error(response));
      return response.json();
    });
    async function write(files, workspace) {
      if (A.saving) return false;
      A.saving = true; A.refreshChrome();
      let saved = 0;
      try {
        for (const file of files) A.validateXml(file.current);
        for (const snapshot of files) {
          if (workspace !== A.api.token) throw new Error('工作区已切换，请重新保存');
          const file = A.state.filesMap.get(snapshot.path);
          if (!file) throw new Error('文档已关闭，请重新打开：' + snapshot.path);
          await persist(file, { path: snapshot.path, content: snapshot.current, expectedContent: snapshot.disk });
          saved++; A.events.emit('document:changed', file);
        }
        A.clearTopicCache(); A.refreshFiles();
        const pending = Array.from(A.state.filesMap.values()).filter(file => file.dirty).length;
        A.setStatus(`已保存 ${saved} 个文档到${A.state.capabilities.persistence === 'browser' ? '浏览器' : '磁盘'}${A.state.capabilities.git ? ' · 尚未提交 Git' : ''}` + (pending ? ` · 仍有 ${pending} 个文档待保存` : ''));
        return true;
      } catch (error) {
        A.setStatus(`${saved ? '已保存 ' + saved + ' 个文档，其余未保存。' : ''}保存失败：${error.message}`, true);
        A.toast(error.message, 'error'); return false;
      } finally { A.saving = false; A.refreshFiles(); A.refreshChrome(); }
    }
    async function saveCurrent() {
      if (preparing || A.saving || get('saveScopeDialog').open) return;
      const file = A.state.filesMap.get(A.state.activePath);
      if (!file) return false;
      if (!/\.ditamap$/i.test(file.path)) return write([{ ...file }], A.api.token);
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
      } catch (error) { A.setStatus(error.message, true); A.toast(error.message, 'error'); }
      finally { preparing = false; }
    }
    get('saveScopeCancel').addEventListener('click', () => get('saveScopeDialog').close());
    get('saveScopeForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!configuration || !A.manual.current(configuration.snapshot)) { get('saveScopeError').textContent = '内容或工作区已变化，请重新打开保存范围'; return; }
      const selected = new Set(Array.from(get('saveScopeList').querySelectorAll('input:checked'), node => node.value));
      if (!selected.size) { get('saveScopeError').textContent = '请至少选择一个文档'; return; }
      const files = configuration.candidates.filter(file => selected.has(file.path));
      get('saveScopeDialog').close(); await write(files, configuration.snapshot.workspace);
    });
    return { saveCurrent };
  }
  root.DitaSave = { createSaveController };
})(window);

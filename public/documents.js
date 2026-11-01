'use strict';
(function (root) {
  function createDocumentController(A, { renderTabs, updateActivePanes, updateTree, refreshWorkspaceTree }) {
    const { state, setStatus, setMode } = A;
    const fetch = A.api.request, responseError = A.api.error;
    const fileNameFromPath = value => value.split('/').pop();
    const saveFile = () => A.save.saveCurrent();
    let savingAs = false, navigation = 0, saveAsOperation = 0;
    for (const event of ['file:opening', 'file:opened', 'file:closed', 'workspace:willChange']) A.events.on(event, () => { navigation++; });
    A.events.on('workspace:willChange', () => { saveAsOperation++; savingAs = false; });
function downloadFile() {
  const file = state.filesMap.get(state.activePath);
  if (!file) return;
  try {
    A.downloadXML(file.current, fileNameFromPath(file.path));
    setStatus('已发起 XML 下载（UTF-8），请查看浏览器下载记录');
  } catch (error) {
    setStatus(`下载失败：${error.message}`, true);
  }
}

async function saveAsFile() {
  if (savingAs) { setStatus('正在另存为，请等待当前操作完成'); return false; }
  const file = state.filesMap.get(state.activePath);
  if (!file) return;
  const suggested = file.path || 'new-topic.dita';
  const requested = prompt('请输入相对当前仓库根目录的文件路径：', suggested);
  if (requested == null) return;
  let target;
  try { target = root.DitaReferencePaths.normalize(requested.trim()); } catch (error) { setStatus(error.message, true); return false; }
  if (!target || !/\.(?:dita|ditamap|xml)$/i.test(target) || target.split('/').some(part => part === '..')) {
    setStatus('另存为路径必须是仓库内的 .dita、.ditamap 或 .xml 文件', true);
    return;
  }

  if (target !== file.path && state.filesMap.get(target)?.dirty) { setStatus('目标文件有未保存修改，请先保存或下载：' + target, true); return; }
  if (target === file.path) { await saveFile(); return; }
  const snapshot = file.current, workspace = A.api.token, startedNavigation = navigation, operation = ++saveAsOperation;
  const originalTarget = state.filesMap.get(target), originalCurrent = originalTarget?.current, originalDisk = originalTarget?.disk;
  let expectedContent, sentTarget;
  function guard() {
    if (workspace !== A.api.token || operation !== saveAsOperation) throw new Error('工作区已切换，请重新另存为');
    const current = state.filesMap.get(target);
    if (current !== originalTarget || current && (current.dirty || current.current !== originalCurrent || current.disk !== originalDisk)) throw new Error('目标编辑区已变化，已停止覆盖；请先保存或下载目标文档');
  }
  async function requestSave(overwrite = false) {
    guard();
    const current = state.filesMap.get(target); sentTarget = current && { file: current, current: current.current, disk: current.disk };
    return fetch('/api/file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target, content: snapshot, sourcePath: file.path, overwrite, expectedContent })
    });
  }

  try {
    A.validateXml(snapshot); savingAs = true; setStatus('正在另存为：' + target);
    let response = await requestSave(false);
    if (response.status === 409) {
      guard();
      const existing = await fetch('/api/file?path=' + encodeURIComponent(target));
      if (!existing.ok) throw new Error(await responseError(existing));
      expectedContent = await existing.text();
      guard();
      if (originalTarget && originalDisk !== expectedContent) throw new Error('目标磁盘文件已变化，请重新打开后比较，再执行另存为');
      if (!confirm(`文件已存在，是否覆盖？\n\n${target}`)) return;
      response = await requestSave(true);
    }
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.json();
    if (workspace !== A.api.token || operation !== saveAsOperation) throw new Error('工作区已切换，已忽略旧的另存为结果');
    const savedPath = result.path || target;
    let current = state.filesMap.get(savedPath), preserved = false, changedWorking = false;
    if (current) {
      const untouched = current === sentTarget?.file && current.current === sentTarget.current && current.disk === sentTarget.disk;
      const compatibleDisk = current.disk === sentTarget?.disk || current.disk === result.content || typeof expectedContent === 'string' && current.disk === expectedContent;
      if (compatibleDisk) {
        current.disk = result.content; current.gitStatus = result.created ? 'untracked' : 'modified';
        if (untouched) changedWorking = A.setFileContent(current, result.content, { render: false });
        current.dirty = current.current !== current.disk; A.events.emit('document:changed', current);
      }
      preserved = !untouched;
    } else if (!sentTarget) {
      current = root.DitaDocumentStore.createDocument({ path: savedPath, content: result.content, gitStatus: result.created ? 'untracked' : 'modified' });
      state.filesMap.set(savedPath, current);
    } else preserved = true; // The user closed the target while writing; keep it closed.
    if (!state.files.some(entry => entry.path === savedPath)) {
      state.files.push({ type: 'file', path: savedPath, name: fileNameFromPath(savedPath) });
    }
    if (result.map && (!current || current.current === result.content)) {
      const index = state.maps.findIndex(map => map.path === savedPath);
      if (index < 0) state.maps.push(result.map); else state.maps[index] = result.map;
      A.maps.renderPicker();
    }
    if (!preserved && current && navigation === startedNavigation && state.activePath === file.path && state.filesMap.get(file.path) === file && file.current === snapshot) await A.openFile(savedPath);
    else if (changedWorking && state.activePath === savedPath) updateActivePanes();
    renderTabs();
    updateTree();
    setStatus(`已另存为：${savedPath}` + (preserved ? ' · 已保留目标编辑区的后续状态' : ''));
    return true;
  } catch (error) {
    if (workspace === A.api.token && operation === saveAsOperation) setStatus(`另存为失败：${error.message}`, true);
    return false;
  } finally { if (operation === saveAsOperation) savingAs = false; }
}

const get = id => document.getElementById(id), templates = root.DitaDocumentTemplates;
let creating = false, creationWorkspace = '';
for (const [kind, [label]] of Object.entries(templates.definitions)) get('newDocumentTemplate').add(new Option(label, kind));
function suggestion() { return 'new-' + get('newDocumentTemplate').value + (get('newDocumentTemplate').value === 'ditamap' ? '.ditamap' : '.dita'); }
function createNewDocument() {
  if (creating) return;
  creationWorkspace = A.api.token; get('newDocumentForm').reset(); get('newDocumentPath').value = suggestion(); get('newDocumentError').textContent = '';
  get('newDocumentDialog').showModal(); get('newDocumentTitle').focus();
}
get('newDocumentTemplate').addEventListener('change', () => {
  const input = get('newDocumentPath'); if (/^new-[^/]+\.(dita|ditamap)$/.test(input.value)) input.value = suggestion();
});
get('newDocumentCancel').addEventListener('click', () => { if (!creating) get('newDocumentDialog').close(); });
get('newDocumentDialog').addEventListener('cancel', event => { if (creating) event.preventDefault(); });
get('newDocumentForm').addEventListener('submit', async event => {
  event.preventDefault(); if (creating) return;
  const kind = get('newDocumentTemplate').value, map = kind === 'ditamap';
  let target = get('newDocumentPath').value.trim().replace(/\\/g, '/');
  try {
    if (creationWorkspace !== A.api.token) throw new Error('工作区已切换，请重新打开新建表单');
    if (!/\.(dita|ditamap|xml)$/i.test(target)) target += map ? '.ditamap' : '.dita';
    if (target.split('/').some(part => !part || part === '..' || part === '.') || target.includes('\0')) throw new Error('请输入仓库内的相对文件路径');
    if (map !== /\.ditamap$/i.test(target)) throw new Error(map ? '目录文件须使用 .ditamap 扩展名' : '正文文件请使用 .dita 或 .xml 扩展名');
    if (state.filesMap.get(target)?.dirty) throw new Error('目标文件有未保存修改，请先保存或下载');
    const content = templates.create(kind, get('newDocumentTitle').value.trim() || '新建文档', target);
    A.validateXml(content); creating = true; get('newDocumentSubmit').disabled = true;
    // New templates create files only. Existing documents stay intact.
    const response = await fetch('/api/file', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: target, content, overwrite: false }) });
    if (response.status === 409) throw new Error('文件已存在，请换一个文件名');
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.json(); await refreshWorkspaceTree();
    const savedPath = result.path || target, file = root.DitaDocumentStore.createDocument({ path: savedPath, content: result.content, gitStatus: 'untracked' });
    if (!state.filesMap.has(savedPath)) state.filesMap.set(savedPath, file);
    await A.openFile(savedPath); setMode('visual'); get('newDocumentDialog').close(); setStatus('已创建：' + savedPath);
  } catch (error) { get('newDocumentError').textContent = error.message; }
  finally { creating = false; get('newDocumentSubmit').disabled = false; }
});

    return { downloadFile, saveAsFile, createNewDocument };
  }
  root.DitaDocuments = { createDocumentController };
})(window);

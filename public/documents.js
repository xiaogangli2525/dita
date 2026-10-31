'use strict';
(function (root) {
  function createDocumentController(A, { renderTabs, updateActivePanes, updateTree, refreshWorkspaceTree }) {
    const { state, setStatus, setMode } = A;
    const fetch = A.api.request, responseError = A.api.error;
    const fileNameFromPath = value => value.split('/').pop();
    const saveFile = () => A.save.saveCurrent();
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
  const file = state.filesMap.get(state.activePath);
  if (!file) return;
  const suggested = file.path || 'new-topic.dita';
  const requested = prompt('请输入相对当前仓库根目录的文件路径：', suggested);
  if (requested == null) return;
  const target = requested.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!target || !/\.(?:dita|ditamap|xml)$/i.test(target) || target.split('/').some(part => part === '..')) {
    setStatus('另存为路径必须是仓库内的 .dita、.ditamap 或 .xml 文件', true);
    return;
  }

  if (target !== file.path && state.filesMap.get(target)?.dirty) { setStatus('目标文件有未保存修改，请先保存或下载：' + target, true); return; }
  if (target === file.path) { await saveFile(); return; }
  const snapshot = file.current;
  let expectedContent;
  async function requestSave(overwrite = false) {
    return fetch('/api/file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target, content: snapshot, overwrite, expectedContent })
    });
  }

  try {
    let response = await requestSave(false);
    if (response.status === 409) {
      const existing = await fetch('/api/file?path=' + encodeURIComponent(target));
      if (!existing.ok) throw new Error(await responseError(existing));
      expectedContent = await existing.text();
      if (!confirm(`文件已存在，是否覆盖？\n\n${target}`)) return;
      response = await requestSave(true);
    }
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.json();
    A.clearTopicCache();
    const savedPath = result.path || target;
    state.filesMap.set(savedPath, {
      path: savedPath,
      disk: result.content,
      baseline: result.content,
      gitStatus: result.created ? 'untracked' : 'modified',
      current: result.content,
      dirty: false
    });
    state.activePath = savedPath; A.footnotes?.setScope(savedPath); A.events.emit('file:opened', state.filesMap.get(savedPath));
    if (!state.files.some(entry => entry.path === savedPath)) {
      state.files.push({ type: 'file', path: savedPath, name: fileNameFromPath(savedPath) });
    }
    renderTabs();
    updateActivePanes();
    updateTree();
    setStatus(`已另存为：${savedPath}`);
  } catch (error) {
    setStatus(`另存为失败：${error.message}`, true);
  }
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
    const result = await response.json(); await refreshWorkspaceTree(); A.clearTopicCache();
    const savedPath = result.path || target, file = { path: savedPath, disk: result.content, baseline: result.content, gitStatus: 'untracked', current: result.content, dirty: false };
    state.filesMap.set(savedPath, file); state.activePath = savedPath; A.footnotes?.setScope(savedPath); A.events.emit('file:opened', file);
    renderTabs(); setMode('visual'); updateActivePanes(); updateTree(); get('newDocumentDialog').close(); setStatus('已创建：' + savedPath);
  } catch (error) { get('newDocumentError').textContent = error.message; }
  finally { creating = false; get('newDocumentSubmit').disabled = false; }
});

    return { downloadFile, saveAsFile, createNewDocument };
  }
  root.DitaDocuments = { createDocumentController };
})(window);

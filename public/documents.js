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

function escapeXmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function newDocumentId(filePath) {
  const stem = fileNameFromPath(filePath).replace(/\.[^.]+$/, '');
  const id = stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'new-topic';
  return /^\d/.test(id) ? `topic-${id}` : id;
}

function newDocumentTemplate(type, title, filePath) {
  const safeTitle = escapeXmlText(title || '新建文档');
  const id = newDocumentId(filePath);
  const declaration = '<?xml version="1.0" encoding="UTF-8"?>';
  if (type === 'ditamap') {
    return `${declaration}\n<!DOCTYPE map PUBLIC "-//OASIS//DTD DITA Map//EN" "map.dtd">\n<map id="${id}">\n  <title>${safeTitle}</title>\n</map>\n`;
  }
  const definitions = {
    topic: ['topic', 'body', 'topic'],
    concept: ['concept', 'conbody', 'concept'],
    task: ['task', 'taskbody', 'task'],
    reference: ['reference', 'refbody', 'reference']
  };
  const [root, body, dtdName] = definitions[type] || definitions.topic;
  const bodyContent = type === 'task'
    ? '    <steps>\n      <step><cmd>在此输入步骤。</cmd></step>\n    </steps>'
    : '    <p>在此输入内容。</p>';
  const shortdesc = type === 'topic' || type === 'concept' || type === 'task' || type === 'reference'
    ? '  <shortdesc></shortdesc>\n'
    : '';
  return `${declaration}\n<!DOCTYPE ${root} PUBLIC "-//OASIS//DTD DITA ${dtdName[0].toUpperCase()}${dtdName.slice(1)}//EN" "${root}.dtd">\n<${root} id="${id}">\n  <title>${safeTitle}</title>\n${shortdesc}<${body}>\n${bodyContent}\n  </${body}>\n</${root}>\n`;
}

async function createNewDocument() {
  const requestedType = prompt('请选择文档类型（topic、concept、task、reference 或 ditamap）：', 'topic');
  if (requestedType == null) return;
  const type = requestedType.trim().toLowerCase();
  if (!['topic', 'concept', 'task', 'reference', 'ditamap'].includes(type)) {
    setStatus('不支持的文档类型', true);
    return;
  }
  const extension = type === 'ditamap' ? '.ditamap' : '.dita';
  const defaultName = `new-${type}${extension}`;
  const requestedPath = prompt('请输入相对当前仓库根目录的文件路径：', defaultName);
  if (requestedPath == null) return;
  let target = requestedPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!target) return;
  if (!/\.(?:dita|ditamap|xml)$/i.test(target)) target += extension;
  if (target.split('/').some(part => !part || part === '..') || !/^(?:[^/]+\/)*[^/]+\.(?:dita|ditamap|xml)$/i.test(target)) {
    setStatus('新建路径必须是仓库内的 .dita、.ditamap 或 .xml 文件', true);
    return;
  }
  if (type === 'ditamap' && !/\.ditamap$/i.test(target)) {
    setStatus('Map 文档必须使用 .ditamap 扩展名', true);
    return;
  }
  if (type !== 'ditamap' && /\.ditamap$/i.test(target)) {
    setStatus('主题文档不能使用 .ditamap 扩展名', true);
    return;
  }
  if (state.filesMap.get(target)?.dirty) { setStatus('目标文件有未保存修改，请先保存或下载：' + target, true); return; }
  const title = prompt('请输入文档标题：', type === 'ditamap' ? '新建 DITA Map' : '新建文档');
  if (title == null) return;
  const content = newDocumentTemplate(type, title.trim() || '新建文档', target);
  let expectedContent;
  async function requestCreate(overwrite = false) {
    return fetch('/api/file', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target, content, overwrite, expectedContent })
    });
  }
  try {
    let response = await requestCreate(false);
    if (response.status === 409) {
      const existing = await fetch('/api/file?path=' + encodeURIComponent(target));
      if (!existing.ok) throw new Error(await responseError(existing));
      expectedContent = await existing.text();
      if (!confirm(`文件已存在，是否覆盖？\n\n${target}`)) return;
      response = await requestCreate(true);
    }
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.json();
    await refreshWorkspaceTree();
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
    renderTabs();
    setMode('visual');
    updateActivePanes();
    updateTree();
    setStatus(`已创建：${savedPath}`);
  } catch (error) {
    setStatus(`新建文档失败：${error.message}`, true);
  }
}


    return { downloadFile, saveAsFile, createNewDocument };
  }
  root.DitaDocuments = { createDocumentController };
})(window);

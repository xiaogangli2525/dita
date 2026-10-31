'use strict';
(() => {
  window.DitaApp = window.DitaApp || {};
  const A = window.DitaApp;
﻿
const ditaCore = window.DitaVisualCore;
const workspaceClient = window.DitaWorkspaceClient;
const fetch = workspaceClient.request;
const responseError = workspaceClient.error;
const documentStore = window.DitaDocumentStore;
const events = window.DitaManualCore.createEvents();

const state = {
  root: '',
  files: [],
  maps: [],
  selectedMap: '',
  repositories: [],
  branches: [],
  currentBranch: '',
  capabilities: { persistence: 'filesystem', git: true },
  filesMap: new Map(),
  activePath: '',
  // Oxygen Author opens documents in the structured visual editor. Source is
  // an explicit secondary mode for XML-oriented work.
  mode: 'visual',
  suppressVisualInput: false,
  reviewGroups: new Map(),
  reviewDecisions: new Map(),
  reviewPath: '',
  reviewBaseline: '',
  reviewCurrent: '',
  activeView: 'map',
  selectedVisualElement: null,
  mapAuthorPaths: new Set(),
  mapAuthorRenderToken: 0,
  historyTargetPath: ''
};

// Keep a small, per-file edit history so source, visual, formatting, and
// review changes can all be undone through the same model.  The browser's
// native textarea history only knows about source edits and cannot restore a
// visual/review transition.

const dom = {
  rootPath: document.querySelector('#rootPath'),
  repositorySelect: document.querySelector('#repositorySelect'),
  branchSelect: document.querySelector('#branchSelect'),
  search: document.querySelector('#search'),
  sourceButton: document.querySelector('#sourceButton'),
  visualButton: document.querySelector('#visualButton'),
  previewButton: document.querySelector('#previewButton'),
  newDocumentButton: document.querySelector('#newDocumentButton'),
  formatButton: document.querySelector('#formatButton'),
  findReplaceButton: document.querySelector('#findReplaceButton'),
  insertElementSelect: document.querySelector('#insertElementSelect'),
  insertElementButton: document.querySelector('#insertElementButton'),
  undoButton: document.querySelector('#undoButton'),
  redoButton: document.querySelector('#redoButton'),
  authorUndoButton: document.querySelector('#authorUndoButton'),
  authorRedoButton: document.querySelector('#authorRedoButton'),
  validateButton: document.querySelector('#validateButton'),
  saveButton: document.querySelector('#saveButton'),
  saveAsButton: document.querySelector('#saveAsButton'),
  downloadButton: document.querySelector('#downloadButton'),
  htmlPreviewPane: document.querySelector('#htmlPreviewPane'),
  htmlPreviewFrame: document.querySelector('#htmlPreviewFrame'),
  closeHtmlPreviewButton: document.querySelector('#closeHtmlPreviewButton'),
  exportHtmlButton: document.querySelector('#exportHtmlButton'),
  previewHtmlButton: document.querySelector('#previewHtmlButton'),
  mdPreviewPane: document.querySelector('#mdPreviewPane'),
  mdPreviewContent: document.querySelector('#mdPreviewContent'),
  closeMdPreviewButton: document.querySelector('#closeMdPreviewButton'),
  exportMdButton: document.querySelector('#exportMdButton'),
  previewMdButton: document.querySelector('#previewMdButton'),
  reviewButton: document.querySelector('#reviewButton'),
  acceptAllButton: document.querySelector('#acceptAllButton'),
  rejectAllButton: document.querySelector('#rejectAllButton'),
  closeReviewButton: document.querySelector('#closeReviewButton'),
  status: document.querySelector('#status'),
  mapPicker: document.querySelector('#mapPicker'),
  mapToolbar: document.querySelector('#mapToolbar'),
  moveMapUpButton: document.querySelector('#moveMapUpButton'),
  moveMapDownButton: document.querySelector('#moveMapDownButton'),
  promoteMapButton: document.querySelector('#promoteMapButton'),
  demoteMapButton: document.querySelector('#demoteMapButton'),
  removeMapButton: document.querySelector('#removeMapButton'),
  addTopicrefButton: document.querySelector('#addTopicrefButton'),
  addTopicheadButton: document.querySelector('#addTopicheadButton'),
  tree: document.querySelector('#tree'),
  tabs: document.querySelector('#tabs'),
  editSearchPanel: document.querySelector('#editSearchPanel'),
  editFindInput: document.querySelector('#editFindInput'),
  editReplaceInput: document.querySelector('#editReplaceInput'),
  editFindCase: document.querySelector('#editFindCase'),
  editFindNextButton: document.querySelector('#editFindNextButton'),
  editReplaceButton: document.querySelector('#editReplaceButton'),
  editReplaceAllButton: document.querySelector('#editReplaceAllButton'),
  editFindCloseButton: document.querySelector('#editFindCloseButton'),
  editFindMeta: document.querySelector('#editFindMeta'),
  editor: document.querySelector('#editor'),
  editorPane: document.querySelector('#editorPane'),
  visualPane: document.querySelector('#visualPane'),
  visualEditor: document.querySelector('#visualEditor'),
  reviewPane: document.querySelector('#reviewPane'),
  reviewMeta: document.querySelector('#reviewMeta'),
  reviewScope: document.querySelector('#reviewScope'),
  diff: document.querySelector('#diff'),
  inspector: document.querySelector('#inspector'),
  inspectorTitle: document.querySelector('#inspectorTitle'),
  menuPopup: document.querySelector('#menuPopup'),
  exportMenuButton: document.querySelector('#exportMenuButton'),
  inspectorToggleButton: document.querySelector('#inspectorToggleButton'),
  exportMenu: document.querySelector('#exportMenu'),
  viewTabs: Array.from(document.querySelectorAll('.view-tab')),
  mapView: document.querySelector('#mapView'),
  outlineView: document.querySelector('#outlineView'),
  searchView: document.querySelector('#searchView'),
  outline: document.querySelector('#outline'),
  workspaceSearchInput: document.querySelector('#workspaceSearchInput'),
  workspaceSearchResults: document.querySelector('#workspaceSearchResults'),
  inspectorElement: document.querySelector('#inspectorElement'),
  attributesPanel: document.querySelector('#attributesPanel'),
  contextToolbar: document.querySelector('#contextToolbar')
};

function updateDocumentChrome() {
  const file = state.filesMap.get(state.activePath);
  const title = document.getElementById('documentTitle');
  const location = document.getElementById('documentLocation');
  const badge = document.getElementById('documentSaveState');
  const empty = document.getElementById('welcomePanel');
  if (title) title.textContent = file ? fileNameFromPath(file.path) : '你的文档工作台';
  if (location) location.textContent = file ? file.path : '选择一个文档，开始专注写作';
  if (badge) {
    const dirty = Array.from(state.filesMap.values()).filter(item => item.dirty).length;
    badge.textContent = A.saving ? '正在保存…' : dirty ? `${dirty} 个文档待保存` : file ? (state.capabilities.persistence === 'browser' ? '已保存到浏览器' : '已保存到磁盘') : '本地工作区';
    badge.dataset.state = A.saving ? 'saving' : dirty ? 'dirty' : 'saved';
  }
  if (empty) empty.hidden = Boolean(file);
  A.authorNotes?.syncMode();
  document.title = file ? `${fileNameFromPath(file.path)} · DITA Lite` : 'DITA Lite · 文档工作台';
}

function setStatus(message, isError = false) {
  dom.status.textContent = message;
  dom.status.classList.toggle('status-error', isError);
  if (isError) console.error(message);
}

let toastTimer;
function toast(message, level) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast show toast-' + (level || 'info');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}
Object.assign(A, { state, dom, ditaCore, setStatus, toast, api: workspaceClient,
  validateXml, openFile, events, downloadText: window.DitaBrowserFiles.downloadText, downloadXML: window.DitaBrowserFiles.downloadXML,
  refreshChrome: updateDocumentChrome, refreshFiles: () => { renderTabs(); updateHistoryButtons(); updateDocumentChrome(); },
  navigateToSource: async (path, start = 0, end = start, expected) => {
    const workspace = workspaceClient.token; await openFile(path, { preserveFootnotesScope: true });
    if (workspace !== workspaceClient.token) throw new Error('工作区已切换');
    const file = state.filesMap.get(path); if (expected !== undefined && file.current.slice(start, end) !== expected) throw new Error('内容已变化');
    setMode('editor'); dom.editor.focus(); dom.editor.setSelectionRange(start, end);
    dom.editor.scrollTop = Math.max(0, file.current.slice(0, start).split('\n').length - 5) * 22;
  },
  prepareProposal: (content, instruction = '') => documentStore.createProposal({ file: state.filesMap.get(state.activePath), workspaceToken: workspaceClient.token, content, instruction }, validateXml),
  applyProposal: proposal => documentStore.applyProposal(proposal, { file: state.filesMap.get(state.activePath), workspaceToken: workspaceClient.token }, validateXml, setFileContent),
  showLoading: function() { const el = document.getElementById('loadingOverlay'); if (el) { el.classList.add('active'); el.setAttribute('aria-hidden', 'false'); } },
  hideLoading: function() { const el = document.getElementById('loadingOverlay'); if (el) { el.classList.remove('active'); el.setAttribute('aria-hidden', 'true'); } } });

const editor = window.DitaEditorController.createEditorController(A, {
  renderTabs, renderOutline, renderInspector, updateTree, refreshChrome: updateDocumentChrome,
  beforeModeChange: () => A.releaseExportPreview?.(), modeChanged: () => { A.footnotes?.syncMode(); A.authorNotes?.syncMode(); A.editorTools?.syncMode(); }
});
const { setFileContent, setMode, updateHistoryButtons, updateActivePanes, ensureMapAuthorFile,
  undoFile, redoFile, syncVisualToModel, markDirty, renderDiff, renderMapReview, reviewAll } = editor;
Object.assign(A, { setFileContent, setMode, applyAuthorEdit: editor.applyAuthorEdit });

function setActiveView(view) {
  state.activeView = view;
  const panels = { map: dom.mapView, outline: dom.outlineView, search: dom.searchView };
  for (const [name, panel] of Object.entries(panels)) {
    if (!panel) continue;
    panel.hidden = name !== view;
    panel.classList.toggle('active', name === view);
  }
  for (const button of dom.viewTabs || []) { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-selected', button.dataset.view === view ? 'true' : 'false'); }
  if (view === 'outline') renderOutline();
  if (view === 'search') renderWorkspaceSearch(dom.workspaceSearchInput?.value || '');
}

function renderOutline() {
  if (!dom.outline) return;
  dom.outline.replaceChildren();
  const file = state.filesMap.get(state.activePath);
  if (!file || /\.ditamap$/i.test(file.path)) {
    const empty = document.createElement('div');
    empty.className = 'outline-empty';
    empty.textContent = file ? 'Map 文档没有 Author 大纲。' : '打开文档后显示标题和节结构。';
    dom.outline.append(empty);
    return;
  }
  try {
    const root = ditaCore.parseXml(file.current).documentElement;
    const titles = Array.from(root.querySelectorAll('title'));
    if (!titles.length) throw new Error('empty');
    const headings = Array.from(dom.visualEditor.querySelectorAll('h2, h3, h4, h5, h6'));
    titles.forEach((title, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      const heading = headings[index];
      item.className = `outline-item level-${Math.min(3, heading?.localName === 'h2' ? 1 : heading?.localName === 'h3' ? 2 : 3)}`;
      item.textContent = title.textContent.trim() || '(无标题)';
      item.title = title.textContent.trim();
      item.addEventListener('click', () => {
        if (/\.ditamap$/i.test(file.path)) return;
        setMode(state.mode === 'preview' ? 'preview' : 'visual');
        const target = Array.from(dom.visualEditor.querySelectorAll('h2, h3, h4, h5, h6'))[index];
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target?.classList.add('author-focus');
        setTimeout(() => target?.classList.remove('author-focus'), 900);
      });
      dom.outline.append(item);
    });
  } catch {
    const empty = document.createElement('div');
    empty.className = 'outline-empty';
    empty.textContent = '当前文档无法生成大纲。';
    dom.outline.append(empty);
  }
}

function renderWorkspaceSearch(term = '') {
  if (!dom.workspaceSearchResults) return;
  const query = term.trim().toLowerCase();
  dom.workspaceSearchResults.replaceChildren();
  const matches = flattenFiles(state.files).filter(path => !query || path.toLowerCase().includes(query));
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'outline-empty';
    empty.textContent = query ? '没有匹配文件路径。' : '输入文件名搜索。';
    dom.workspaceSearchResults.append(empty);
    return;
  }
  for (const path of matches.slice(0, 100)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-result';
    button.textContent = path.split('/').pop();
    const detail = document.createElement('small');
    detail.textContent = path;
    button.append(detail);
    button.addEventListener('click', () => openFile(path));
    dom.workspaceSearchResults.append(button);
  }
}

function selectedAuthorElement(target) {
  if (!target || !dom.visualEditor?.contains(target)) return null;
  const element = target.closest('[data-dita-source], .note, pre, img, table, li, ul, ol, h2, p');
  if (!element || element === dom.visualEditor || element.getAttribute('data-dita-body') === 'true') return null;
  return element;
}

function renderInspector(element = state.selectedVisualElement) { A.inspector?.render(element); }
function applyContextAction(action) { A.inspector?.context(action); }

const menuDefinitions = {
  file: [['恢复草稿', () => A.drafts.show()], ['交付记录', () => document.getElementById('releasesButton').click()], ['新建文档', () => createNewDocument()], ['保存', () => saveFile(), 'Ctrl+S'], ['另存为', () => saveAsFile()], ['下载', () => downloadFile()]],
  edit: [['撤销', () => undoFile(), 'Ctrl+Z'], ['重做', () => redoFile(), 'Ctrl+Y'], ['查找和替换', () => openFindReplace(), 'Ctrl+F'], ['格式化 XML', () => dom.formatButton?.click()]],
  view: [['Source 源码', () => setMode('editor')], ['Author 编辑', () => setMode('visual')], ['阅读（只读）', () => setMode('preview')], ['显示 Map', () => setActiveView('map')], ['显示 Outline', () => setActiveView('outline')]],
  dita: [['项目型号清单', () => A.project.show()], ['插入元素', () => dom.insertElementButton?.click()], ['XML 语法校验', () => dom.validateButton?.click()], ['审阅变更', () => setMode('review')]],
  help: [['快捷键', () => setStatus('Ctrl+S 保存 · Ctrl+F 查找 · Ctrl+Z 撤销')]]
};

function closeMenu() {
  if (dom.menuPopup) dom.menuPopup.hidden = true;
}

function openMenu(button) {
  if (!dom.menuPopup) return;
  const items = menuDefinitions[button.dataset.menu] || [];
  dom.menuPopup.replaceChildren();
  for (const [label, handler, shortcut] of items) {
    const item = document.createElement('button');
    item.type = 'button';
    item.append(document.createTextNode(label));
    if (shortcut) { const key = document.createElement('kbd'); key.textContent = shortcut; item.append(key); }
    item.addEventListener('click', () => { closeMenu(); handler(); });
    dom.menuPopup.append(item);
  }
  const rect = button.getBoundingClientRect();
  dom.menuPopup.style.left = `${Math.max(4, rect.left)}px`;
  dom.menuPopup.style.top = `${rect.bottom + 2}px`;
  dom.menuPopup.hidden = false;
}


function flattenFiles(nodes, result = []) {
  for (const node of nodes) {
    if (node.type === 'directory') flattenFiles(node.children, result);
    else result.push(node.path);
  }
  return result;
}

function fillSelect(select, items, selectedValue, renderOption) {
  select.replaceChildren();
  for (const item of items) {
    const option = document.createElement('option');
    renderOption(option, item);
    select.append(option);
  }
  select.value = selectedValue;
}

function renderWorkspaceSwitches() {
  fillSelect(dom.repositorySelect, state.repositories, state.root, (option, repository) => {
    option.value = repository.path;
    option.textContent = repository.name;
  });
  fillSelect(dom.branchSelect, state.branches, state.currentBranch, (option, branch) => {
    option.value = branch.name;
    option.textContent = `${branch.name} (${branch.commit})`;
  });
}

function hasUnsavedWork() {
  const dirtyFiles = Array.from(state.filesMap.values()).filter(file => file.dirty);
  if (!dirtyFiles.length) return true;
  const list = dirtyFiles.map(file => file.path).join('\n');
  return confirm(`以下文件尚未保存，切换将丢弃未保存内容：\n\n${list}\n\n继续吗？`);
}

async function reloadWorkspace(result) {
  events.emit('workspace:willChange');
  workspaceClient.adopt(result.workspaceToken);
  A.releaseExportPreview?.();
  state.root = result.root;
  state.capabilities = result.capabilities || { persistence: 'filesystem', git: true };
  state.files = result.files;
  state.maps = result.maps;
  state.currentBranch = result.currentBranch;
  state.branches = result.branches || [];
  const branchMap = state.currentBranch ? state.maps.find(map => map.path.replace(/^.*\//, '').replace(/\.ditamap$/i, '') === state.currentBranch) : null;
  state.selectedMap = (branchMap ? branchMap.path : null) || state.maps.find(map => /http_httpsdevelopmentusermanual_en\.ditamap$/i.test(map.path))?.path || state.maps[0]?.path || '';
  state.selectedMapSourcePath = '';
  state.filesMap.clear();
  A.footnotes?.setScope('');
  A.clearTopicCache();
  state.activePath = '';
  state.historyTargetPath = '';
  state.reviewGroups.clear();
  state.reviewDecisions.clear();
  state.reviewBaseline = '';
  state.reviewCurrent = '';
  state.mapAuthorPaths = new Set();
  dom.rootPath.textContent = result.root;
  dom.repositorySelect.value = result.root;
  dom.branchSelect.value = result.currentBranch;
  dom.editor.value = '';
  renderWorkspaceSwitches();
  renderMapPicker();
  renderTabs();
  updateActivePanes();
  updateTree('');
  await A.project.load(); events.emit('workspace:changed');
}

async function loadRepositories() {
  const response = await fetch('/api/repos');
  if (!response.ok) throw new Error(await response.text());
  const result = await response.json();
  state.repositories = result.repositories;
  renderWorkspaceSwitches();
}

async function selectRepository() {
  if (!hasUnsavedWork()) { renderWorkspaceSwitches(); return; }
  const repository = dom.repositorySelect.value;
  try {
    const response = await fetch('/api/repository', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository })
    });
    if (!response.ok) throw new Error(await responseError(response));
    await reloadWorkspace(await response.json());
    setStatus('仓库已切换');
  } catch (error) {
    renderWorkspaceSwitches();
    setStatus(`切换仓库失败：${error.message}`, true);
  }
}

async function selectBranch() {
  if (!hasUnsavedWork()) { renderWorkspaceSwitches(); return; }
  const branch = dom.branchSelect.value;
  try {
    const response = await fetch('/api/branch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branch })
    });
    if (!response.ok) throw new Error(await responseError(response));
    await reloadWorkspace(await response.json());
    setStatus(`分支已切换：${branch}`);
  } catch (error) {
    renderWorkspaceSwitches();
    setStatus(`切换分支失败：${error.message}`, true);
    toast(error.message, 'error');
  }
}
function renderMapPicker() { return A.maps.renderPicker(); }
function updateTree(filter) { return A.maps.updateTree(filter); }
function applyMapOperation(operation, details) { return A.maps.applyOperation(operation, details); }
function promptMapTarget() { return A.maps.promptTarget(); }

function makeTab(file) {
  const tab = document.createElement('div');
  tab.className = 'tab active';
  tab.dataset.path = file.path;
  const label = document.createElement('span');
  label.textContent = file.path.split('/').pop();
  const dirty = document.createElement('span');
  dirty.className = 'dirty';
  const mapDirty = /\.ditamap$/i.test(file.path) && Array.from(state.mapAuthorPaths || []).some(path => state.filesMap.get(path)?.dirty);
  dirty.hidden = !(file.dirty || mapDirty);
  dirty.textContent = '\u25CF';
  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = '\u00D7';
  close.addEventListener('click', event => {
    event.stopPropagation();
    closeFile(file.path);
  });
  tab.append(label, dirty, close);
  tab.addEventListener('click', () => openFile(file.path));
  return tab;
}

function renderTabs() {
  updateDocumentChrome();
  A.footnotes?.scheduleRefresh();
  const fragment = document.createDocumentFragment();
  for (const file of state.filesMap.values()) {
    if (/\.ditamap$/i.test(state.activePath) && state.mapAuthorPaths?.has(file.path)) continue;
    const tab = makeTab(file);
    tab.classList.toggle('active', file.path === state.activePath);
    fragment.append(tab);
  }
  dom.tabs.replaceChildren(fragment);
}

async function openFile(path, { preserveFootnotesScope = false } = {}) {
  if (!state.filesMap.has(path)) {
    try {
      const [fileResponse, gitResponse] = await Promise.all([
        fetch(`/api/file?path=${encodeURIComponent(path)}`),
        fetch(`/api/git?path=${encodeURIComponent(path)}`)
      ]);
      if (!fileResponse.ok) throw new Error(await fileResponse.text());
      const diskContent = await fileResponse.text();
      const gitInfo = await gitResponse.json();
      state.filesMap.set(path, {
        path,
        disk: diskContent,
        baseline: gitInfo.available ? gitInfo.content : diskContent,
        gitStatus: gitInfo.status || 'unknown',
        current: diskContent,
        dirty: false
      });
    } catch (error) {
      setStatus('\u6253\u5F00\u5931\u8D25', true);
      throw error;
    }
  }
  document.body.classList.remove('sidebar-open');
  document.getElementById('sidebarToggleButton')?.setAttribute('aria-expanded', 'false');
  state.activePath = path;
  if (!preserveFootnotesScope) A.footnotes?.setScope(path);
  state.historyTargetPath = path;
  const reviewableModes = ['visual', 'preview', 'review'];
  setMode(reviewableModes.includes(state.mode) ? state.mode : 'visual');
  renderTabs();
  updateActivePanes();
  updateHistoryButtons();
  updateTree();
  events.emit('file:opened', state.filesMap.get(path));
  const git = state.filesMap.get(path)?.gitStatus || 'unknown';
  setStatus(git === 'clean' ? 'Git\uFF1A\u65E0\u672A\u63D0\u4EA4\u4FEE\u6539' : `Git\uFF1A${git}`);
}

function closeFile(path) {
  const file = state.filesMap.get(path);
  if (file?.dirty && !confirm(`${path} \u5C1A\u672A\u4FDD\u5B58\uFF0C\u786E\u5B9A\u5173\u95ED\uFF1F`)) return;
  state.filesMap.delete(path); events.emit('file:closed', path);
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

// Tool behavior lives in its controller; menus and global shortcuts keep a
// narrow delegation boundary at the composition root.
function insertDitaElement() { return A.editorTools.insert(); }
function openFindReplace() { return A.editorTools.openFind(); }
function closeFindReplace() { return A.editorTools.closeFind(); }

function validateXml(text) {
  ditaCore.parseXml(text);
  return { valid: true, message: 'XML \u8BED\u6CD5\u6709\u6548' };
}

const formatContent = window.DitaXmlSource.formatXml;

function saveFile() { return A.save.saveCurrent(); }

function fileNameFromPath(filePath) {
  return String(filePath || '').split('/').pop() || 'document.dita';
}


function downloadFile() { return A.documents.downloadFile(); }
function saveAsFile() { return A.documents.saveAsFile(); }

async function refreshWorkspaceTree() {
  const response = await fetch('/api/workspace');
  if (!response.ok) throw new Error(await response.text());
  const result = await response.json();
  const previousMap = state.selectedMap;
  const previousSource = state.selectedMapSourcePath;
  state.root = result.root;
  state.files = result.files || [];
  state.maps = result.maps || [];
  state.currentBranch = result.currentBranch || state.currentBranch;
  state.branches = result.branches || state.branches;
  state.selectedMap = state.maps.some(map => map.path === previousMap)
    ? previousMap
    : (state.currentBranch ? state.maps.find(map => map.path.replace(/^.*\//, '').replace(/\.ditamap$/i, '') === state.currentBranch)?.path : null) || state.maps.find(map => /http_httpsdevelopmentusermanual_en\.ditamap$/i.test(map.path))?.path || state.maps[0]?.path || '';
  state.selectedMapSourcePath = state.selectedMap === previousMap ? previousSource : '';
  dom.rootPath.textContent = state.root;
  renderWorkspaceSwitches();
  renderMapPicker();
  updateTree('');
}

function createNewDocument() { return A.documents.createNewDocument(); }

dom.inspectorToggleButton?.addEventListener('click', () => {
  const open = dom.inspector.classList.toggle('drawer-open');
  dom.inspectorToggleButton.setAttribute('aria-expanded', String(open));
});
document.getElementById('inspectorCloseButton')?.addEventListener('click', () => {
  dom.inspector.classList.remove('drawer-open'); dom.inspectorToggleButton?.setAttribute('aria-expanded', 'false');
});
document.addEventListener('click', event => {
  const tools = document.querySelector('.editing-tools');
  if (tools && !tools.contains(event.target)) tools.open = false;
});
document.getElementById('welcomeNewButton')?.addEventListener('click', createNewDocument);
document.getElementById('sidebarToggleButton')?.addEventListener('click', event => {
  const open = document.body.classList.toggle('sidebar-open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  document.body.classList.remove('sidebar-open');
  document.getElementById('sidebarToggleButton')?.setAttribute('aria-expanded', 'false');
  dom.inspector?.classList.remove('drawer-open');
  dom.inspectorToggleButton?.setAttribute('aria-expanded', 'false');
  A.closeExportMenu();
  closeMenu();
});

dom.editor.addEventListener('input', markDirty);
dom.visualEditor.addEventListener('input', syncVisualToModel);
dom.visualEditor.addEventListener('click', event => {
  const element = selectedAuthorElement(event.target);
  if (!element || state.mode !== 'visual') return;
  event.stopPropagation();
  renderInspector(element);
  A.footnotes?.syncMode();
});
dom.visualEditor.addEventListener('keyup', event => {
  const element = selectedAuthorElement(event.target);
  if (element && state.mode === 'visual') { renderInspector(element); A.footnotes?.syncMode(); }
});
dom.visualEditor.addEventListener('focusout', () => {
  if (state.mode !== 'visual') renderInspector(null);
});
dom.search.addEventListener('input', () => updateTree(dom.search.value));
for (const button of dom.viewTabs || []) button.addEventListener('click', () => setActiveView(button.dataset.view));
  for (const tl of dom.viewTabs || []) tl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const tabs = dom.viewTabs || [];
    const idx = tabs.indexOf(tl);
    const next = e.key === 'ArrowLeft' ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
    tabs[next].focus();
    setActiveView(tabs[next].dataset.view);
  });
dom.workspaceSearchInput?.addEventListener('input', () => renderWorkspaceSearch(dom.workspaceSearchInput.value));
for (const button of document.querySelectorAll('.main-menu [data-menu]')) {
  button.addEventListener('click', event => {
    event.stopPropagation();
    if (!dom.menuPopup.hidden && dom.menuPopup.dataset.owner === button.dataset.menu) closeMenu();
    else { dom.menuPopup.dataset.owner = button.dataset.menu; openMenu(button); }
  });
}
document.addEventListener('click', event => {
  if (!event.target.closest('.main-menu') && !event.target.closest('.menu-popup')) closeMenu();
  if (!event.target.closest('.export-dropdown')) A.closeExportMenu();
});
dom.contextToolbar?.addEventListener('click', event => {
  const button = event.target.closest('[data-context-action]');
  if (button && dom.contextToolbar.contains(button)) applyContextAction(button.dataset.contextAction);
});
dom.sourceButton.addEventListener('click', () => setMode('editor'));
dom.visualButton.addEventListener('click', () => setMode('visual'));
dom.previewButton.addEventListener('click', () => setMode('preview'));
dom.newDocumentButton?.addEventListener('click', createNewDocument);
dom.validateButton.addEventListener('click', () => {
  const file = state.filesMap.get(state.activePath);
  if (!file) return;
  try {
    setStatus(validateXml(file.current).message);
  } catch (error) {
    setStatus(`\u6821\u9A8C\u5931\u8D25\uFF1A${error.message}`, true);
  }
});
dom.saveButton.addEventListener('click', saveFile);
dom.saveAsButton?.addEventListener('click', saveAsFile);
dom.downloadButton?.addEventListener('click', downloadFile);
dom.previewHtmlButton?.addEventListener('click', () => A.previewMapHtml());
dom.exportHtmlButton?.addEventListener('click', () => A.exportMapToHtmlFile());
dom.closeHtmlPreviewButton?.addEventListener('click', () => { dom.htmlPreviewPane.classList.remove('active'); dom.htmlPreviewFrame.src = ''; setMode(state.mode); });
dom.previewMdButton?.addEventListener('click', () => A.previewMapMd());
dom.exportMdButton?.addEventListener('click', () => A.exportMapToMarkdownFile());
dom.exportMenuButton?.addEventListener('click', (e) => { e.stopPropagation(); A.openModelExport(); });
[dom.previewHtmlButton, dom.exportHtmlButton, dom.previewMdButton, dom.exportMdButton].forEach(btn => btn?.addEventListener('click', () => A.closeExportMenu()));
dom.closeMdPreviewButton?.addEventListener('click', () => { dom.mdPreviewPane.classList.remove('active'); dom.mdPreviewContent.innerHTML = ''; setMode(state.mode); });
dom.branchSelect.addEventListener('change', selectBranch);
dom.undoButton?.addEventListener('click', undoFile);
dom.redoButton?.addEventListener('click', redoFile);
dom.authorUndoButton?.addEventListener('click', undoFile);
dom.authorRedoButton?.addEventListener('click', redoFile);
dom.formatButton.addEventListener('click', () => {
  const file = state.filesMap.get(state.activePath);
  if (!file) return;
  try {
    setFileContent(file, formatContent(file.current));
    setStatus('\u5DF2\u683C\u5F0F\u5316');
  } catch (error) {
    setStatus(`\u683C\u5F0F\u5316\u5931\u8D25\uFF1A${error.message}`, true);
  }
});
dom.moveMapUpButton.addEventListener('click', () => applyMapOperation('moveUp'));
dom.moveMapDownButton.addEventListener('click', () => applyMapOperation('moveDown'));
dom.promoteMapButton.addEventListener('click', () => applyMapOperation('promote'));
dom.demoteMapButton.addEventListener('click', () => applyMapOperation('demote'));
dom.removeMapButton.addEventListener('click', () => {
  if (confirm('确定删除选中的 Map 节点吗？')) applyMapOperation('remove');
});
dom.addTopicrefButton.addEventListener('click', () => {
  const href = promptMapTarget();
  if (href) applyMapOperation('addTopicref', { href });
});
dom.addTopicheadButton.addEventListener('click', () => {
  const title = prompt('请输入分组标题：');
  if (title?.trim()) applyMapOperation('addTopichead', { title: title.trim(), sourcePath: '' });
});
dom.reviewButton.addEventListener('click', () => setMode('review'));
dom.closeReviewButton.addEventListener('click', () => setMode('visual'));
dom.acceptAllButton.addEventListener('click', () => reviewAll(true));
dom.rejectAllButton.addEventListener('click', () => reviewAll(false));
dom.reviewScope.addEventListener('change', () => {
  const file = state.filesMap.get(state.activePath);
  if (file && /\.ditamap$/i.test(file.path)) renderMapReview(file); else renderDiff(file);
});
dom.repositorySelect.addEventListener('change', selectRepository);

document.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  // Leave native undo/redo available for the workspace search and other
  // controls; the shared history applies to the source and visual editors.
  const targetTag = event.target?.tagName;
  if (targetTag && ['INPUT', 'SELECT', 'TEXTAREA'].includes(targetTag) && event.target !== dom.editor) return;
  const key = event.key.toLowerCase();
  if (key === 'f' || key === 'h') {
    event.preventDefault();
    openFindReplace();
    return;
  }
  if (key === 'z') {
    event.preventDefault();
    if (event.shiftKey) redoFile();
    else undoFile();
    return;
  }
  if (key === 'y' && !event.shiftKey) {
    event.preventDefault();
    redoFile();
    return;
  }
  if (key === 's' && !event.shiftKey) {
    event.preventDefault();
    saveFile();
  }
});

window.addEventListener('beforeunload', event => {
  if (!Array.from(state.filesMap.values()).some(file => file.dirty)) return;
  event.preventDefault();
  event.returnValue = '';
});

async function initialize() {
  try {
    const [workspaceResponse, repositoriesResponse] = await Promise.all([
      fetch('/api/workspace'),
      fetch('/api/repos')
    ]);
    if (!workspaceResponse.ok) throw new Error(await workspaceResponse.text());
    if (!repositoriesResponse.ok) throw new Error(await repositoriesResponse.text());
    const result = await workspaceResponse.json();
    const repositories = await repositoriesResponse.json();
    state.repositories = repositories.repositories;
    await reloadWorkspace(result);
    setStatus('就绪');
  } catch (error) {
    setStatus(`初始化失败：${error.message}`, true);
  }
}

A.maps = window.DitaMapController.createMapController(A, { ensureMapAuthorFile, renderTabs });
A.documents = window.DitaDocuments.createDocumentController(A, { renderTabs, updateActivePanes, updateTree, refreshWorkspaceTree });
A.manual = window.DitaManualService.createManualService(A);
A.project = window.DitaProject.createProjectController(A);
A.save = window.DitaSave.createSaveController(A);
A.drafts = window.DitaDrafts.createDraftController(A);
A.search = window.DitaSearch.createSearchController(A);
A.authorSelection = window.DitaAuthorSelection.createController(A);
A.bodyNavigation = window.DitaBodyNavigation.createController(A);
A.authorCommands = window.DitaAuthorCommands.createController({ state, dom, core: ditaCore, selection: A.authorSelection, apply: editor.applyAuthorEdit, validate: validateXml });
A.inspector = window.DitaInspector.createController({ state, dom, commands: A.authorCommands, format: tag => A.editorTools.format(tag), status: setStatus });
A.resources = window.DitaResources.createResourceController(A);
A.footnotes = window.DitaFootnotes.createPanel(A);
A.authorNotes = window.DitaAuthorNotes.createController(A);
A.editorTools = window.DitaEditorTools.createController(A);
window.DitaClipboard.createController({ state, dom, core: ditaCore, selection: A.authorSelection, status: setStatus, toast });
const measureHeader = () => document.documentElement.style.setProperty('--workspace-header-bottom', Math.ceil(document.querySelector('.app-header').getBoundingClientRect().bottom + 8) + 'px');
new ResizeObserver(measureHeader).observe(document.querySelector('.app-header'));
measureHeader();
initialize();
})();


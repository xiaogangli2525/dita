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
const createVisualApiFromCore = ditaCore.createVisualApi;

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
  setFileContent, validateXml, openFile, setMode, events, downloadText: window.DitaBrowserFiles.downloadText, downloadXML: window.DitaBrowserFiles.downloadXML,
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

function buildContextToolbar(tag) {
  if (!dom.contextToolbar) return;
  const actions = [];
  const add = (action, label, cls) => actions.push({ action, label, cls });
  const tagLower = (tag || '').toLowerCase();
  if (state.selectedVisualElement?.closest('td,th') || ['table'].includes(tagLower) || tagLower === 'div' && (state.selectedVisualElement?.getAttribute('data-dita-source') === 'table')) {
    add('row-before', '上方插行');
    add('row-after', '下方插行');
    add('row-delete', '删除行');
    add('col-before', '左侧插列');
    add('col-after', '右侧插列');
    add('col-delete', '删除列');
    add('delete', '删除表格');
  } else if (['code', 'codeph', 'filepath', 'span', 'a', 'b', 'i', 'u'].includes(tagLower)) {
    add('bold', '加粗');
    add('italic', '斜体');
    add('code-inline', '行内代码');
    add('delete', '删除元素');
  } else if (['h2'].includes(tagLower)) {
    add('delete', '删除标题');
  } else {
    add('before', '上方插入');
    add('after', '下方插入');
    add('delete', '删除元素');
  }
  dom.contextToolbar.replaceChildren();
  const label = document.createElement('span');
  label.className = 'context-label';
  label.textContent = '<' + tag + '>';
  dom.contextToolbar.append(label);
  for (const item of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.contextAction = item.action;
    btn.textContent = item.label;
    dom.contextToolbar.append(btn);
  }
}
function renderInspector(targetElement = state.selectedVisualElement) {
  if (state.selectedVisualElement && state.selectedVisualElement.classList) state.selectedVisualElement.classList.remove('author-selected');
  state.selectedVisualElement = targetElement && dom.visualEditor?.contains(targetElement) ? targetElement : null;
  if (!dom.attributesPanel || !dom.inspectorElement) return;
  dom.attributesPanel.replaceChildren();
  if (!state.selectedVisualElement) {
    dom.inspectorElement.textContent = '未选择元素';
    if (dom.contextToolbar) dom.contextToolbar.hidden = true;
    const empty = document.createElement('div');
    empty.className = 'inspector-empty';
    empty.textContent = '在 Author 视图中选择一个元素以查看属性。';
    dom.attributesPanel.append(empty);
    return;
  }
  const selectedElement = state.selectedVisualElement;
  selectedElement.classList.add('author-selected');
  const tag = selectedElement.getAttribute('data-dita-source') || (selectedElement.localName === 'h2' ? 'title' : selectedElement.localName);
  dom.inspectorElement.textContent = `<${tag}>`;
  dom.contextToolbar.hidden = state.mode !== 'visual';
  if (!dom.contextToolbar.hidden) buildContextToolbar(tag);
  const attributes = Array.from(selectedElement.attributes).filter(attr => !['class', 'style', 'contenteditable'].includes(attr.name) && !attr.name.startsWith('data-'));
  if (!attributes.length) {
    const empty = document.createElement('div');
    empty.className = 'inspector-empty';
    empty.textContent = '此元素没有可编辑属性。';
    dom.attributesPanel.append(empty);
  }
  for (const attr of attributes) {
    const row = document.createElement('div');
    row.className = 'attribute-row';
    const label = document.createElement('label');
    label.textContent = attr.name;
    label.title = attr.name;
    const input = document.createElement('input');
    input.value = attr.value;
    input.dataset.attribute = attr.name;
    input.addEventListener('change', () => {
      selectedElement.setAttribute(attr.name, input.value);
      syncVisualToModel();
      setStatus(`已更新属性：${attr.name}`);
    });
    row.append(label, input);
    dom.attributesPanel.append(row);
  }
  const ditaSource = selectedElement.getAttribute('data-dita-source') || selectedElement.localName;
  if (['td', 'th'].includes(ditaSource) || selectedElement.closest('td,th')) {
    const cell = selectedElement.closest('td,th') || selectedElement;
    const tr = cell.closest('tr');
    const table = cell.closest('table');
    const groups = [];
    if (tr && tr !== selectedElement) groups.push(['Row', tr]);
    if (table) {
      const tableWrapper = table.closest('[data-dita-source="table"]') || table;
      if (tableWrapper !== selectedElement) groups.push(['Table', tableWrapper]);
    }
    for (const [label, el] of groups) {
      const header = document.createElement('div');
      header.className = 'attribute-group-header';
      header.textContent = label + ' 属性';
      dom.attributesPanel.append(header);
      const attrs = Array.from(el.attributes).filter(a => !['class', 'style', 'contenteditable'].includes(a.name) && !a.name.startsWith('data-'));
      if (!attrs.length) {
        const none = document.createElement('div');
        none.className = 'inspector-empty';
        none.textContent = '无属性';
        dom.attributesPanel.append(none);
        continue;
      }
      for (const attr of attrs) {
        const row = document.createElement('div');
        row.className = 'attribute-row';
        const label2 = document.createElement('label');
        label2.textContent = attr.name;
        const input2 = document.createElement('input');
        input2.value = attr.value;
        input2.readOnly = true;
        row.append(label2, input2);
        dom.attributesPanel.append(row);
      }
    }
  }
  const actions = document.createElement('div');
  actions.className = 'attribute-actions';
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = '添加属性';
  add.addEventListener('click', () => {
    const name = prompt('属性名：');
    if (!name?.trim()) return;
    selectedElement.setAttribute(name.trim(), '');
    syncVisualToModel();
    renderInspector(selectedElement);
  });
  actions.append(add);
  dom.attributesPanel.append(actions);
}

function applyContextAction(action) {
  const element = state.selectedVisualElement;
  if (!element || state.mode !== 'visual') return;
  const editSurface = element.closest('.map-topic-surface') || dom.visualEditor;
  const table = element.closest('table');
  const wrapper = table?.closest('[data-dita-source="table"]');
  const originalTable = wrapper?.getAttribute('data-dita-original') || '';
  if (/^(row|col)-/.test(action) && /\b(?:morerows|namest|nameend|spanname)\s*=/.test(originalTable)) {
    setStatus('此表格包含合并单元格，请在源码中调整行列结构', true);
    return;
  }
  if (/^col-/.test(action) && /<colspec\b/.test(originalTable)) {
    setStatus('此表格包含列定义，请在源码中调整列结构', true);
    return;
  }

  if (action === 'bold') { document.execCommand('bold'); syncVisualToModel({ target: element }); return; }
  if (action === 'italic') { document.execCommand('italic'); syncVisualToModel({ target: element }); return; }
  if (action === 'code-inline') {
    const code = document.createElement('code');
    code.setAttribute('data-dita-source', 'codeph');
    code.textContent = String(window.getSelection() || '');
    if (code.textContent) { window.getSelection().getRangeAt(0).surroundContents(code); syncVisualToModel({ target: element }); }
    return;
  }
  if (action === 'row-before' || action === 'row-after' || action === 'row-delete') {
    const tr = element.closest('tr');
    if (!tr) return;
    if (action === 'row-delete') { tr.remove(); }
    else {
      const newRow = tr.cloneNode(true);
      for (const node of [newRow, ...newRow.querySelectorAll('td,th')]) {
        node.removeAttribute('id');
        for (const name of ['data-dita-row-attrs', 'data-dita-entry-attrs']) {
          if (!node.hasAttribute(name)) continue;
          const attrs = JSON.parse(node.getAttribute(name)); delete attrs.id;
          node.setAttribute(name, JSON.stringify(attrs));
        }
      }
      newRow.querySelectorAll('td,th').forEach(td => { td.textContent = ''; });
      action === 'row-before' ? tr.before(newRow) : tr.after(newRow);
    }
    syncVisualToModel({ target: editSurface });
    return;
  }
  if (action === 'col-before' || action === 'col-after' || action === 'col-delete') {
    const td = element.closest('td,th');
    if (!td) return;
    const cellIndex = Array.from(td.parentElement.children).indexOf(td);
    if (action === 'col-delete' && td.parentElement.children.length <= 1) { setStatus('表格至少保留一列', true); return; }
    table.querySelectorAll('tr').forEach(row => {
      const cell = row.children[cellIndex];
      if (!cell) return;
      if (action === 'col-delete') cell.remove();
      else {
        const newCell = document.createElement(row.children[0]?.tagName || 'td');
        newCell.textContent = '';
        action === 'col-before' ? cell.before(newCell) : cell.after(newCell);
      }
    });
    if (wrapper && originalTable) {
      const doc = ditaCore.parseXml(originalTable);
      const tgroup = doc.querySelector('tgroup');
      if (tgroup) tgroup.setAttribute('cols', String(table.querySelector('tr')?.children.length || 1));
      wrapper.setAttribute('data-dita-original', ditaCore.serializeXmlNode(doc.documentElement));
    }
    syncVisualToModel({ target: editSurface });
    return;
  }
  if (action === 'delete') {
    if (!element.parentElement || ['h2'].includes(element.localName)) return;
    const parent = element.parentElement;
    element.remove();
    state.selectedVisualElement = null;
    syncVisualToModel({ target: parent });
    renderInspector(null);
    return;
  }
  const paragraph = document.createElement('p');
  paragraph.setAttribute('data-dita-source', 'p');
  paragraph.textContent = '新段落';
  if (action === 'before') element.before(paragraph);
  else element.after(paragraph);
  syncVisualToModel({ target: paragraph });
  renderInspector(paragraph);
}

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
  state.mapAuthorRenderToken += 1;
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

function ensureHistory(file) {
  return documentStore.historyOf(file);
}

function historyTargetFile() {
  const active = state.filesMap.get(state.activePath);
  if (!active) return null;
  const candidate = state.filesMap.get(state.historyTargetPath);
  if (candidate && candidate.path !== active.path && /\.ditamap$/i.test(active.path) && state.mapAuthorPaths?.has(candidate.path)) return candidate;
  return active;
}

function updateHistoryButtons() {
  const file = historyTargetFile();
  const history = file ? ensureHistory(file) : null;
  if (dom.undoButton) dom.undoButton.disabled = !history || history.undo.length === 0;
  if (dom.redoButton) dom.redoButton.disabled = !history || history.redo.length === 0;
}

const mapRefreshTimers = new Map();
function scheduleMapRefresh(file) {
  if (!/\.ditamap$/i.test(file.path)) return;
  clearTimeout(mapRefreshTimers.get(file.path));
  const workspace = workspaceClient.token;
  mapRefreshTimers.set(file.path, setTimeout(async () => {
    mapRefreshTimers.delete(file.path);
    if (workspace !== workspaceClient.token || state.filesMap.get(file.path) !== file) return;
    const content = file.current;
    try {
      // Incomplete XML during typing is expected; retain the last valid tree.
      validateXml(content);
      const response = await fetch('/api/map/resolve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: file.path, content })
      });
      if (!response.ok) return;
      const map = await response.json();
      if (file.current !== content || state.filesMap.get(file.path) !== file) return;
      const index = state.maps.findIndex(item => item.path === file.path);
      if (index < 0) state.maps.push(map); else state.maps[index] = map;
      if (state.selectedMap === file.path) updateTree();
      if (state.activePath === file.path && ['visual', 'preview', 'review'].includes(state.mode)) updateMapAuthor(file);
    } catch { /* An incomplete edit or superseded workspace keeps its buffer. */ }
  }, 180));
}

function refreshFileViews(file, { updateEditor = true } = {}) {
  if (file) scheduleMapRefresh(file);
  if (!file || state.activePath !== file.path) return;
  if (updateEditor) dom.editor.value = file.current;
  if (state.mode === 'visual' || state.mode === 'preview' || state.mode === 'review') {
    state.suppressVisualInput = true;
    updateVisual(file, state.mode === 'review');
    state.suppressVisualInput = false;
  }
  if (state.mode === 'review') {
    if (/\.ditamap$/i.test(file.path)) renderMapReview(file);
    else renderDiff(file, false);
  }
  renderTabs();
  updateHistoryButtons();
}

function refreshHistoryTargetView(file) {
  if (!file) return;
  if (state.activePath === file.path) {
    refreshFileViews(file);
    return;
  }
  const active = state.filesMap.get(state.activePath);
  if (active && /\.ditamap$/i.test(active.path) && state.mapAuthorPaths?.has(file.path)) {
    state.suppressVisualInput = true;
    updateVisual(active);
    state.suppressVisualInput = false;
    renderTabs();
    updateHistoryButtons();
    if (state.mode === 'review') renderMapReview(active);
  }
}

function setFileContent(file, content, { record = true, updateEditor = true, historyMeta, render = true } = {}) {
  if (!file) return false;
  if (!documentStore.editDocument(file, content, { record, historyMeta })) return false;
  if (file.path === state.activePath || (/\.ditamap$/i.test(state.activePath) && state.mapAuthorPaths?.has(file.path))) {
    state.historyTargetPath = file.path;
  }
  if (render) refreshFileViews(file, { updateEditor });
  events.emit('document:changed', file);
  return true;
}

function undoFile() {
  const file = historyTargetFile();
  if (!file) return;
  const entry = documentStore.travelHistory(file, 'undo');
  if (!entry) return;
  if (entry.reviewDecisionsBefore) state.reviewDecisions = new Map(entry.reviewDecisionsBefore);
  refreshHistoryTargetView(file); events.emit('document:changed', file);
  setStatus('已撤销');
}

function redoFile() {
  const file = historyTargetFile();
  if (!file) return;
  const entry = documentStore.travelHistory(file, 'redo');
  if (!entry) return;
  if (entry.reviewDecisionsAfter) state.reviewDecisions = new Map(entry.reviewDecisionsAfter);
  refreshHistoryTargetView(file); events.emit('document:changed', file);
  setStatus('已重做');
}

function updateActivePanes() {
  const file = state.filesMap.get(state.activePath);
  dom.editor.value = file?.current || '';
  dom.editor.disabled = !file;
  dom.visualEditor.contentEditable = file && state.mode === 'visual' && !/\.ditamap$/i.test(file.path) ? 'true' : 'false';
  state.suppressVisualInput = true;
  updateVisual(file);
  state.suppressVisualInput = false;
  renderOutline();
  renderInspector(null);
  updateHistoryButtons();
  updateDocumentChrome();
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

function setMode(mode) {
  A.releaseExportPreview?.();
  state.mode = mode;
  dom.editorPane.classList.toggle('active', mode === 'editor');
  // Review keeps the Author surface in the main column. The review pane is a
  // docked right sidebar, matching Oxygen Author's reading flow.
  dom.visualPane.classList.toggle('active', mode === 'visual' || mode === 'preview' || mode === 'review');
  // Reading reuses the Author rendering with all editing disabled.
  dom.reviewPane.classList.toggle('active', mode === 'review');
  dom.visualEditor?.classList.toggle('preview-editable', mode === 'preview');
  dom.inspector?.classList.toggle('reviewing', mode === 'review');
  if (dom.inspectorTitle) dom.inspectorTitle.textContent = mode === 'review' ? '变更审阅' : '文档属性';
  dom.htmlPreviewPane?.classList.remove('active');
  dom.mdPreviewPane?.classList.remove('active');
  if (dom.inspectorElement) dom.inspectorElement.hidden = mode === 'review';
  if (dom.attributesPanel) dom.attributesPanel.hidden = mode === 'review';
  for (const [button, buttonMode] of [[dom.sourceButton, 'editor'], [dom.visualButton, 'visual'], [dom.previewButton, 'preview']]) {
    button?.classList.toggle('active', mode === buttonMode);
  }
  dom.reviewButton?.classList.toggle('active', mode === 'review');
  for (const button of [dom.insertElementButton, dom.formatButton]) button.disabled = mode === 'preview' || mode === 'review';
  dom.contextToolbar.hidden = true;
  const file = state.filesMap.get(state.activePath);
  if (file && mode === 'editor') dom.editor.value = file.current;
  if (dom.visualEditor && (mode === 'review' || mode === 'preview')) {
    dom.visualEditor.contentEditable = 'false';
    for (const surface of dom.visualEditor.querySelectorAll('[contenteditable]')) surface.contentEditable = 'false';
  } else if (dom.visualEditor && mode === 'visual' && file && !/\.ditamap$/i.test(file.path)) {
    dom.visualEditor.contentEditable = 'true';
  }
  if (file && (mode === 'visual' || mode === 'preview' || mode === 'review')) {
    state.suppressVisualInput = true;
    updateVisual(file);
    state.suppressVisualInput = false;
  }
  if (file && mode === 'review') {
    if (/\.ditamap$/i.test(file.path)) renderMapReview(file);
    else renderDiff(file, false);
  }
  if (!file && mode === 'review') renderDiff(null);
  if (dom.contextToolbar) dom.contextToolbar.hidden = mode !== 'visual' || !state.selectedVisualElement;
  if (mode !== 'visual') renderInspector(null);
  if (mode === 'visual' || mode === 'preview') renderOutline();
  A.footnotes?.syncMode();
}


const visualCore = createVisualApiFromCore(state, dom);

async function ensureMapAuthorFile(path) {
  const cached = state.filesMap.get(path);
  if (cached) return cached;
  const [fileResponse, gitResponse] = await Promise.all([
    fetch(`/api/file?path=${encodeURIComponent(path)}`),
    fetch(`/api/git?path=${encodeURIComponent(path)}`)
  ]);
  if (!fileResponse.ok) throw new Error(`${path}: ${(await fileResponse.text()).trim()}`);
  const disk = await fileResponse.text();
  const git = await gitResponse.json().catch(() => ({}));
  const file = {
    path,
    disk,
    baseline: git.available ? git.content : disk,
    gitStatus: git.status || 'unknown',
    current: disk,
    dirty: false
  };
  state.filesMap.set(path, file);
  return file;
}

async function updateMapAuthor(file) {
  const token = ++state.mapAuthorRenderToken;
  const map = state.maps.find(item => item.path === file.path);
  if (!map) return;
  const entries = ditaCore.collectPreviewPaths(map.children || []);
  state.mapAuthorPaths = new Set(entries.map(entry => entry.path));
  dom.visualEditor.classList.add('map-author-editor');
  dom.visualEditor.contentEditable = 'false';
  dom.visualEditor.replaceChildren(document.createTextNode('正在加载 Map 全文…'));
  const loaded = await Promise.all(entries.map(async entry => {
    try {
      return { entry, file: await ensureMapAuthorFile(entry.path) };
    } catch (error) {
      return { entry, error };
    }
  }));
  if (token !== state.mapAuthorRenderToken || state.activePath !== file.path) return;
  const fragment = document.createDocumentFragment();
  const heading = document.createElement('h1');
  heading.className = 'map-author-title';
  heading.textContent = map.title || map.name || map.path;
  heading.dataset.mapTitle = 'true';
  heading.contentEditable = state.mode === 'visual' ? 'true' : 'false';
  fragment.append(heading);
  if (!loaded.length) {
    const empty = document.createElement('p');
    empty.className = 'map-author-empty';
    empty.textContent = '此 Map 没有可编辑的 topic 引用。';
    fragment.append(empty);
  }
  for (const item of loaded) {
    const topic = document.createElement('section');
    topic.className = 'map-topic';
    topic.dataset.mapTopicPath = item.entry.path;
    const header = document.createElement('div');
    header.className = 'map-topic-header';
    const name = document.createElement('strong');
    name.textContent = item.entry.title || item.entry.path;
    const path = document.createElement('small');
    path.textContent = item.entry.path;
    header.append(name, path);
    topic.append(header);
    if (item.error) {
      const error = document.createElement('p');
      error.className = 'preview-error';
      error.textContent = `无法打开 ${item.entry.path}：${item.error.message}`;
      topic.append(error);
    } else {
      try {
        const surface = ditaCore.createAuthorTopic(item.file.current, document, state.mode === 'review', item.entry.path);
        surface.className = 'map-topic-surface';
        surface.dataset.mapTopicPath = item.entry.path;
        surface.contentEditable = state.mode === 'visual' ? 'true' : 'false';
        topic.append(surface);
      } catch (error) {
        const message = document.createElement('p');
        message.className = 'preview-error';
        message.textContent = `无法解析 ${item.entry.path}：${error.message}`;
        topic.append(message);
      }
    }
    fragment.append(topic);
  }
  dom.visualEditor.replaceChildren(fragment);
  renderInspector(null);
  // setMode('review') starts the async Map Author load and can render the
  // review dock before topic files finish loading. Refresh it once the
  // complete surface and mapAuthorPaths are ready.
  if (state.mode === 'review') renderMapReview(file);
}

function syncMapAuthorToModel(event) {
  const file = state.filesMap.get(state.activePath);
  if (!file || !/\.ditamap$/i.test(file.path)) return false;
  const target = event?.target?.closest?.('[data-map-topic-path]');
  const mapTitle = event?.target?.closest?.('[data-map-title]');
  if (mapTitle) {
    try {
      const doc = ditaCore.parseXml(file.current);
      const root = doc.documentElement;
      let title = Array.from(root.childNodes).find(node => node.localName === 'title');
      if (!title) {
        title = doc.createElement('title');
        root.insertBefore(title, root.firstChild);
      }
      title.textContent = mapTitle.textContent.trim();
      const map = state.maps.find(item => item.path === file.path);
      if (map) map.title = title.textContent;
      const declaration = file.current.match(/^\s*<\?xml[^?]*\?>/i)?.[0] || '<?xml version="1.0" encoding="UTF-8"?>';
      const doctype = file.current.match(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/i)?.[0] || '';
      const next = `${declaration}\n${doctype ? `${doctype}\n` : ''}${ditaCore.serializeXmlNode(root)}\n`;
      setFileContent(file, next, { updateEditor: false });
      renderTabs();
      setStatus(`Map Author：已修改 Map 标题${file.dirty ? '（待保存）' : ''}`);
    } catch (error) {
      setStatus(`Map 标题同步失败：${error.message}`, true);
    }
    return true;
  }
  const path = target?.dataset.mapTopicPath;
  const topicFile = path ? state.filesMap.get(path) : null;
  const surface = target?.classList.contains('map-topic-surface') ? target : target?.querySelector('.map-topic-surface');
  if (!topicFile || !surface) return true;
  try {
    const next = ditaCore.updateCurrentFromVisual(null, { visualEditor: surface }, topicFile.current);
    if (next !== topicFile.current) {
      setFileContent(topicFile, next, { updateEditor: false });
      topicFile.gitStatus = topicFile.gitStatus === 'unknown' ? 'modified' : topicFile.gitStatus;
      renderTabs();
      updateHistoryButtons();
    }
    setStatus(`Map Author：已修改 ${path}${topicFile.dirty ? '（待保存）' : ''}`);
  } catch (error) {
    setStatus(`Map Author 同步失败：${error.message}`, true);
  }
  return true;
}

function updateVisual(file, reviewMode = false) {
  if (state.selectedVisualElement?.classList) state.selectedVisualElement.classList.remove('author-selected');
  state.selectedVisualElement = null;
  if (!file) {
    dom.visualEditor.classList.remove('map-author-editor');
    dom.visualEditor.replaceChildren(document.createTextNode('\u672A\u6253\u5F00\u6587\u4EF6'));
    renderInspector(null);
    return;
  }
  if (/\.ditamap$/i.test(file.path)) {
    updateMapAuthor(file).catch(error => {
      dom.visualEditor.replaceChildren(document.createTextNode(`Map Author 加载失败：${error.message}`));
      setStatus(`Map Author 加载失败：${error.message}`, true);
    });
    return;
  }
  try {
    dom.visualEditor.classList.remove('map-author-editor');
    visualCore.updateVisualFromXml(file.current, reviewMode);
    renderInspector(null);
  } catch (error) {
    dom.visualEditor.replaceChildren(document.createTextNode(`\u53EF\u89C6\u5316\u7F16\u8F91\u4E0D\u53EF\u7528\uFF1A${error.message}`));
    renderInspector(null);
  }
}

function syncVisualToModel(event) {
  if (state.suppressVisualInput) return;
  if (state.mode !== 'visual') return;
  const file = state.filesMap.get(state.activePath);
  if (!file) return;
  if (/\.ditamap$/i.test(file.path)) {
    syncMapAuthorToModel(event);
    return;
  }
  try {
    const previous = file.current;
    const next = visualCore.visualToXml();
    if (next !== previous) {
      setFileContent(file, next, { updateEditor: false, render: false });
    }
    // Keep the live Author DOM in place while the user is typing. Rebuilding
    // it on every input would move the caret and drop the current selection;
    // Oxygen updates the source model separately from the editor surface.
    dom.editor.value = file.current;
    renderTabs();
    updateHistoryButtons();
    const surfaceLabel = state.mode === 'preview' ? '\u9884\u89C8\u7F16\u8F91' : '\u53EF\u89C6\u5316\u7F16\u8F91';
    setStatus(`${surfaceLabel}\u5DF2\u540C\u6B65\uFF1A${file.dirty ? '\u6709\u672A\u4FDD\u5B58\u4FEE\u6539' : '\u65E0\u4FEE\u6539'}`);
  } catch (error) {
    setStatus(`\u53EF\u89C6\u5316\u7F16\u8F91\u540C\u6B65\u5931\u8D25\uFF1A${error.message}`, true);
  }
}

const { resetReviewSnapshot, renderDiff, renderMapReview, reviewAll } = window.DitaReview.createReviewController({
  state, dom, ditaCore, setFileContent, updateVisual, renderTabs, updateHistoryButtons, setStatus
});

function markDirty() {
  const file = state.filesMap.get(state.activePath);
  if (!file) return;
  setFileContent(file, dom.editor.value, { updateEditor: false });
}

// These templates cover the most common DITA authoring actions. Author mode
// inserts visual nodes directly; Source mode uses the serialized templates.
const DITA_INSERT_TEMPLATES = Object.freeze({
  p: '<p>{{selection}}</p>',
  section: '<section>\n  <title>新节</title>\n  <p>{{selection}}</p>\n</section>',
  ul: '<ul>\n  <li>{{selection}}</li>\n  <li>列表项</li>\n</ul>',
  ol: '<ol>\n  <li>{{selection}}</li>\n  <li>列表项</li>\n</ol>',
  note: '<note>{{selection}}</note>',
  codeblock: '<codeblock>在此输入代码</codeblock>',
  table: '<table>\n  <title>表格标题</title>\n  <tgroup cols="2">\n    <tbody>\n      <row><entry>单元格</entry><entry>单元格</entry></row>\n    </tbody>\n  </tgroup>\n</table>',
  image: '<image href="image.png" alt="图片说明"/>',
  xref: '<xref href="topic.dita">链接文字</xref>',
  ph: '<ph>{{selection}}</ph>',
  b: '<b>{{selection}}</b>',
  i: '<i>{{selection}}</i>'
});

function insertionIndent(text, position) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const linePrefix = text.slice(lineStart, position);
  return { linePrefix, indent: (linePrefix.match(/^\s*/) || [''])[0] };
}

function insertDitaElement() {
  const file = state.filesMap.get(state.activePath);
  if (!file) {
    setStatus('请先打开一个 DITA 文件', true);
    return;
  }
  if (state.mode === 'preview' || state.mode === 'review') return;
  const tag = dom.insertElementSelect?.value || 'p';
  if (tag === 'image' || tag === 'xref') { A.resources.show(tag === 'image' ? 'image' : 'link'); return; }
  if (state.mode === 'visual' || state.mode === 'preview') {
    insertVisualElement(tag);
    return;
  }
  if (state.mode !== 'editor') setMode('editor');
  const template = DITA_INSERT_TEMPLATES[tag];
  if (!template) return;
  const text = file.current || '';
  const start = Number.isInteger(dom.editor.selectionStart) ? dom.editor.selectionStart : text.length;
  const end = Number.isInteger(dom.editor.selectionEnd) ? dom.editor.selectionEnd : start;
  const selected = text.slice(start, end);
  const body = selected || '在此输入内容';
  let snippet = template.replace(/\{\{selection\}\}/g, body);
  const { linePrefix, indent } = insertionIndent(text, start);
  // Preserve the indentation of the current source line for multiline
  // snippets, and avoid adding a leading newline when the caret is on an
  // otherwise empty line.
  snippet = snippet.split('\n').map((line, index) => index ? indent + line : line).join('\n');
  const insertion = linePrefix.trim() ? `\n${indent}${snippet}` : snippet;
  const next = text.slice(0, start) + insertion + text.slice(end);
  setFileContent(file, next, { updateEditor: false });
  dom.editor.value = file.current;
  const caret = start + insertion.length;
  dom.editor.focus();
  dom.editor.setSelectionRange(caret, caret);
  setStatus(`已插入 <${tag}> 元素`);
}

function createVisualInsertion(tag) {
  let element = document.createElement(
    tag === 'image' ? 'img'
      : tag === 'xref' ? 'a'
        : tag === 'ph' || tag === 'b' || tag === 'i' ? 'span'
          : tag === 'codeblock' ? 'pre'
            : tag
  );
  const sourceTag = tag === 'image' ? 'image' : tag;
  element.setAttribute('data-dita-source', sourceTag);
  if (tag === 'p') element.textContent = '在此输入内容';
  else if (tag === 'section') {
    element.setAttribute('data-dita-source', 'section');
    const paragraph = document.createElement('p');
    paragraph.setAttribute('data-dita-source', 'p');
    paragraph.textContent = '新节内容';
    element.append(paragraph);
  } else if (tag === 'ul' || tag === 'ol') {
    for (const text of ['列表项', '列表项']) {
      const item = document.createElement('li');
      item.setAttribute('data-dita-source', 'li');
      item.textContent = text;
      element.append(item);
    }
  } else if (tag === 'note') {
    element.className = 'note';
    element.textContent = '在此输入说明';
  } else if (tag === 'codeblock') {
    element.textContent = '在此输入代码';
  } else if (tag === 'table') {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-dita-source', 'table');
    wrapper.append(element);
    element = wrapper;
    const row = document.createElement('tr');
    for (let index = 0; index < 2; index++) {
      const cell = document.createElement('td');
      cell.textContent = '单元格';
      row.append(cell);
    }
    element.firstElementChild.append(row);
  } else if (tag === 'image') {
    element.alt = '图片说明';
    element.setAttribute('href', 'image.png');
    element.src = '/api/asset?path=image.png';
  } else if (tag === 'xref') {
    element.setAttribute('href', 'topic.dita');
    element.textContent = '链接文字';
  } else {
    element.textContent = '在此输入内容';
  }
  return element;
}

function insertVisualElement(tag) {
  const file = state.filesMap.get(state.activePath);
  if (!file || !dom.visualEditor.querySelector('[data-dita-body]')) {
    setStatus('当前文档没有可编辑的 Author 内容区', true);
    return;
  }
  const element = createVisualInsertion(tag);
  const selection = window.getSelection?.();
  const anchor = selection?.anchorNode?.nodeType === 1 ? selection.anchorNode : selection?.anchorNode?.parentElement;
  const selected = selectedAuthorElement(anchor);
  const inline = ['ph', 'b', 'i', 'xref'].includes(tag);
  if (inline && selection?.rangeCount && dom.visualEditor.contains(selection.anchorNode)) {
    selection.getRangeAt(0).deleteContents();
    selection.getRangeAt(0).insertNode(element);
  } else if (selected && selected !== dom.visualEditor && !['h2', 'img'].includes(selected.localName)) {
    selected.after(element);
  } else {
    const activeSurface = document.activeElement?.closest?.('.map-topic-surface');
    const body = activeSurface?.querySelector('[data-dita-body]') || dom.visualEditor.querySelector('[data-dita-body]');
    body.append(element);
  }
  syncVisualToModel({ target: element });
  renderInspector(element);
  element.focus?.();
  setStatus(`已在 Author 视图插入 <${tag}> 元素`);
}

function openFindReplace() {
  if (!dom.editSearchPanel) return;
  if (!state.filesMap.has(state.activePath)) {
    setStatus('请先打开一个 DITA 文件', true);
    return;
  }
  // Find/replace works on serialized XML, so switching to Source is explicit
  // and visible instead of silently editing hidden source text.
  if (state.mode !== 'editor') setMode('editor');
  dom.editSearchPanel.hidden = false;
  const selected = dom.editor.value.slice(dom.editor.selectionStart || 0, dom.editor.selectionEnd || 0);
  if (!dom.editFindInput.value && selected) dom.editFindInput.value = selected;
  dom.editFindInput.focus();
  dom.editFindInput.select();
}

function closeFindReplace() {
  if (!dom.editSearchPanel) return;
  dom.editSearchPanel.hidden = true;
  dom.editFindMeta.textContent = '';
}

function findNextEditMatch() {
  const query = dom.editFindInput?.value || '';
  const text = dom.editor.value || '';
  if (!query) {
    if (dom.editFindMeta) dom.editFindMeta.textContent = '请输入查找内容';
    return -1;
  }
  const caseSensitive = Boolean(dom.editFindCase?.checked);
  const haystack = caseSensitive ? text : text.toLocaleLowerCase();
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  let from = Number.isInteger(dom.editor.selectionEnd) ? dom.editor.selectionEnd : 0;
  let index = haystack.indexOf(needle, from);
  let wrapped = false;
  if (index < 0 && from > 0) {
    index = haystack.indexOf(needle, 0);
    wrapped = index >= 0;
  }
  if (index < 0) {
    if (dom.editFindMeta) dom.editFindMeta.textContent = '未找到';
    setStatus(`未找到“${query}”`);
    return -1;
  }
  dom.editor.focus();
  dom.editor.setSelectionRange(index, index + query.length);
  const before = haystack.slice(0, index);
  const matchNumber = before.split(needle).length;
  const total = haystack.split(needle).length - 1;
  if (dom.editFindMeta) dom.editFindMeta.textContent = `${wrapped ? '已从头查找；' : ''}${matchNumber}/${total}`;
  setStatus(`找到“${query}”`);
  return index;
}

function replaceCurrentEditMatch() {
  const file = state.filesMap.get(state.activePath);
  const query = dom.editFindInput?.value || '';
  if (!file || !query) return findNextEditMatch();
  const start = dom.editor.selectionStart || 0;
  const end = dom.editor.selectionEnd || start;
  const selected = dom.editor.value.slice(start, end);
  const matches = dom.editFindCase?.checked ? selected === query : selected.toLocaleLowerCase() === query.toLocaleLowerCase();
  if (!matches) {
    findNextEditMatch();
    return;
  }
  const replacement = dom.editReplaceInput?.value || '';
  const next = dom.editor.value.slice(0, start) + replacement + dom.editor.value.slice(end);
  setFileContent(file, next, { updateEditor: false });
  dom.editor.value = file.current;
  dom.editor.focus();
  dom.editor.setSelectionRange(start, start + replacement.length);
  setStatus('已替换当前匹配');
  findNextEditMatch();
}

function replaceAllEditMatches() {
  const file = state.filesMap.get(state.activePath);
  const query = dom.editFindInput?.value || '';
  if (!file || !query) {
    if (dom.editFindMeta) dom.editFindMeta.textContent = '请输入查找内容';
    return;
  }
  const replacement = dom.editReplaceInput?.value || '';
  const flags = dom.editFindCase?.checked ? 'g' : 'gi';
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  let count = 0;
  const next = file.current.replace(expression, () => {
    count += 1;
    return replacement;
  });
  if (!count) {
    if (dom.editFindMeta) dom.editFindMeta.textContent = '未找到';
    setStatus(`未找到“${query}”`);
    return;
  }
  setFileContent(file, next);
  dom.editor.focus();
  if (dom.editFindMeta) dom.editFindMeta.textContent = `已替换 ${count} 处`;
  setStatus(`已替换 ${count} 处匹配`);
}

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
});
dom.visualEditor.addEventListener('keyup', event => {
  const element = selectedAuthorElement(event.target);
  if (element && state.mode === 'visual') renderInspector(element);
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
dom.findReplaceButton?.addEventListener('click', () => {
  if (dom.editSearchPanel?.hidden) openFindReplace();
  else closeFindReplace();
});
dom.insertElementButton?.addEventListener('click', insertDitaElement);
dom.editFindNextButton?.addEventListener('click', findNextEditMatch);
dom.editReplaceButton?.addEventListener('click', replaceCurrentEditMatch);
dom.editReplaceAllButton?.addEventListener('click', replaceAllEditMatches);
dom.editFindCloseButton?.addEventListener('click', closeFindReplace);
dom.editFindInput?.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    findNextEditMatch();
  }
});
dom.editFindInput?.addEventListener('input', () => {
  if (dom.editFindMeta) dom.editFindMeta.textContent = '';
});
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
A.resources = window.DitaResources.createResourceController(A);
A.footnotes = window.DitaFootnotes.createPanel(A);
initialize();
})();


'use strict';
(function (root) {
  function createMapController(A, { ensureMapAuthorFile, renderTabs, documentLabel }) {
    const { state, dom, setStatus, setFileContent, openFile } = A;
    const fetch = A.api.request, responseError = A.api.error;
    let operationGeneration = 0, busy = false;
    A.events.on('workspace:willChange', () => { operationGeneration++; busy = false; });
function renderMapPicker() {
  dom.mapPicker.replaceChildren();
  const label = document.createElement('label');
  label.className = 'map-label';
  label.append('当前手册');
  const select = document.createElement('select');
  select.id = 'mapSelect';
  for (const map of state.maps) {
    const option = document.createElement('option');
    option.value = map.path;
    const title = map.title?.trim() || map.name || map.path;
    const duplicates = state.maps.filter(m => (m.title?.trim() || m.name) === (map.title?.trim() || map.name));
    option.textContent = duplicates.length > 1 ? title + '（' + map.name + '）' : title;
    select.append(option);
  }
  select.value = state.selectedMap;
  select.addEventListener('change', () => {
    operationGeneration++; busy = false;
    state.selectedMap = select.value;
    state.selectedMapSourcePath = '';
    updateTree();
  });
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'map-open-author';
  openButton.textContent = '打开全文';
  openButton.title = '在 Author 编辑区打开整个 DITA Map';
  openButton.addEventListener('click', () => openFile(select.value));
  label.append(select, openButton);
  dom.mapPicker.append(label);
}

function renderTree(nodes, filter = '') {
  const result = [];
  const term = filter.trim().toLowerCase();

  function walk(items, parentMatched = false, output = result) {
    for (const node of Array.from(items || [])) {
      const file = state.filesMap.get(node.path);
      const title = file ? documentLabel(file) : node.title || node.name || '';
      const matched = !term || title.toLowerCase().includes(term) || node.path?.toLowerCase().includes(term);
      const children = node.children ? walk(node.children, parentMatched || matched, []) : [];
      if (!matched && !parentMatched && !children.length) continue;
      const nodeButton = document.createElement('button');
      nodeButton.type = 'button';
      nodeButton.className = 'map-node';
      nodeButton.dataset.sourcePath = node.sourcePath || '';
      nodeButton.textContent = title;
      nodeButton.title = node.path || title;
      nodeButton.dataset.path = node.path || '';
      nodeButton.dataset.kind = node.type;
      nodeButton.addEventListener('click', () => {
        state.selectedMapSourcePath = node.sourcePath || '';
        if (node.type === 'file') openFile(node.path);
        else updateTree();
      });
      output.push(nodeButton);
      if (children.length) {
        const childContainer = document.createElement('div');
        childContainer.className = 'children';
        childContainer.append(...children);
        output.push(childContainer);
      }

    }
    return output;
  }

  const selected = state.maps.find(map => map.path === state.selectedMap);
  const items = (selected?.children || state.files) || [];
  return walk(items);
}

function updateTree(filter = dom.search.value) {
  const searched = Boolean(filter && filter.trim()) && !state.selectedMap;
  const source = searched ? state.files : (state.maps.find(map => map.path === state.selectedMap)?.children || state.files);
  dom.tree.replaceChildren(...renderTree(source, filter));
  for (const button of dom.tree.querySelectorAll('button')) {
    const selected = state.selectedMapSourcePath ? button.dataset.sourcePath === state.selectedMapSourcePath : Boolean(state.activePath && button.dataset.path === state.activePath);
    button.classList.toggle('selected', selected);
    if (selected) button.scrollIntoView({ block: 'nearest' });
  }
  updateMapToolbar();
}

function updateMapToolbar() {
  const hasMap = Boolean(state.selectedMap);
  const hasSelection = hasMap && state.selectedMapSourcePath !== '';
  for (const button of [dom.moveMapUpButton, dom.moveMapDownButton, dom.promoteMapButton, dom.demoteMapButton, dom.removeMapButton, dom.addTopicrefButton]) {
    button.disabled = busy || !hasSelection;
  }
  dom.addTopicheadButton.disabled = busy || !hasMap;
}

async function applyMapOperation(operation, details = {}) {
  if (!state.selectedMap || busy) return null;
  const mapPath = state.selectedMap, workspace = A.api.token, sourcePath = details.sourcePath !== undefined ? details.sourcePath : state.selectedMapSourcePath;
  const generation = ++operationGeneration; busy = true; updateMapToolbar();
  const current = () => generation === operationGeneration && workspace === A.api.token && mapPath === state.selectedMap;
  try {
    const file = await ensureMapAuthorFile(mapPath);
    if (!current()) return null;
    const before = file.current;
    const response = await fetch('/api/map/operation', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: mapPath, content: before, operation,
        ...details, sourcePath })
    });
    if (!response.ok) throw new Error(await responseError(response));
    const result = await response.json();
    if (!current()) return null;
    if (file.current !== before) throw new Error('Map 已修改，请重新执行结构操作');
    const selectedMap = state.maps.find(map => map.path === mapPath);
    if (selectedMap) Object.assign(selectedMap, result.map);
    setFileContent(file, result.content);
    if (state.activePath !== mapPath) await openFile(mapPath);
    state.historyTargetPath = mapPath;
    state.selectedMapSourcePath = result.selectedSourcePath || '';
    updateTree('');
    renderTabs();
    setStatus('Map 结构已更新；可撤销，按 Ctrl/Cmd+S 保存');
    return result;
  } catch (error) {
    if (current()) setStatus(`Map 结构操作失败：${error.message}`, true);
    return null;
  } finally { if (generation === operationGeneration) { busy = false; updateMapToolbar(); } }
}

function promptMapTarget() {
  const input = prompt('请输入要添加的 DITA 文件路径（相对当前 Map）：');
  if (input === null) return '';
  const value = input.trim();
  if (!value) return '';
  if (!/\.dita$/i.test(value)) {
    setStatus('Map 引用必须指向 .dita 文件', true);
    return '';
  }
  return value;
}


    return { renderPicker: renderMapPicker, updateTree, applyOperation: applyMapOperation, promptTarget: promptMapTarget };
  }
  root.DitaMapController = { createMapController };
})(window);

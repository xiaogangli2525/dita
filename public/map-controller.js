'use strict';
(function (root) {
  function createMapController(A, { ensureMapAuthorFile, renderTabs, documentLabel }) {
    const { state, session, dom, setStatus, setFileContent, openFile } = A;
    const fetch = A.api.request, responseError = A.api.error;
    let operationGeneration = 0, busy = false;
    A.events.on('workspace:willChange', () => { operationGeneration++; busy = false; });
function renderMapPicker() {
  dom.mapPicker.replaceChildren();
  const label = document.createElement('div');
  label.className = 'map-label';
  const heading = document.createElement('div'), caption = document.createElement('label');
  heading.className = 'map-picker-heading'; caption.htmlFor = 'mapSelect'; caption.textContent = '当前手册';
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
  const describeSelection = () => { select.title = select.selectedOptions[0]?.textContent || ''; };
  describeSelection();
  select.addEventListener('change', () => {
    describeSelection();
    operationGeneration++; busy = false;
    session.selectMap(select.value);
    updateTree();
  });
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'map-open-author';
  openButton.textContent = '打开全文';
  openButton.title = '在 Author 编辑区打开整个 DITA Map';
  openButton.disabled=!state.maps.length;
  openButton.addEventListener('click', () => { Promise.resolve(openFile(select.value)).catch(error=>setStatus(error.message,true)); });
  heading.append(caption, openButton);
  label.append(heading, select);
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
      const text = document.createElement('span'); text.className = 'map-node-label'; text.textContent = title; nodeButton.append(text);
      nodeButton.title = node.path || title;
      nodeButton.dataset.path = node.path || '';
      nodeButton.dataset.kind = node.type;
      nodeButton.addEventListener('click', () => {
        session.selectMapSource(node.sourcePath || '');
        if (node.type === 'file') Promise.resolve(openFile(node.path)).catch(error=>setStatus(error.message,true));
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
  if (!dom.tree.childElementCount) {
    const empty = document.createElement('p'); empty.className = 'sidebar-empty'; empty.setAttribute('role', 'status');
    empty.textContent = filter.trim() ? '没有匹配的文档，试试标题或文件路径。' : state.selectedMap ? '当前手册暂无章节，可在目录结构工具中添加引用。' : '暂无文档，可新建文档或加载文档库。';
    dom.tree.append(empty);
  }
  for (const button of dom.tree.querySelectorAll('button')) {
    const selected = state.selectedMapSourcePath ? button.dataset.sourcePath === state.selectedMapSourcePath : Boolean(state.activePath && button.dataset.path === state.activePath);
    button.classList.toggle('selected', selected);
    if (state.activePath && button.dataset.path === state.activePath) button.setAttribute('aria-current', 'page');
    if (selected) button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    session.upsertMap(result.map);
    setFileContent(file, result.content);
    if (state.activePath !== mapPath) await openFile(mapPath);
    session.setHistoryTarget(mapPath);
    session.selectMapSource(result.selectedSourcePath || '');
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

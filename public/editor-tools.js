'use strict';
(function (root) {
  function createController(A) {
    const { state, dom, setStatus, setFileContent, setMode } = A;
    const selection = A.authorSelection, get = id => document.getElementById(id);
    let scope = null, matches = [], active = -1, truncated = false, composing = false, generation = 0;
    const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const elementOf = node => node.nodeType === 1 ? node : node.parentElement;
    const report = error => { setStatus(error.message, true); A.toast?.(error.message, 'error'); };
    const guard = action => { try { return action(); } catch (error) { report(error); } };
    function selectedText() { return String(root.getSelection() || ''); }
    function hasFormat(node, tag) {
      for (let parent = node.parentElement; parent && !parent.matches(selection.BLOCKS); parent = parent.parentElement) {
        if ((parent.getAttribute('data-dita-source') || parent.localName) === tag) return true;
      }
      return false;
    }
    function wrap(node, start, end, tag) {
      const fragment = document.createDocumentFragment();
      if (start) fragment.append(document.createTextNode(node.data.slice(0, start)));
      if (end > start) {
        const span = document.createElement('span'); span.setAttribute('data-dita-source', tag); span.textContent = node.data.slice(start, end); fragment.append(span);
      }
      if (end < node.length) fragment.append(document.createTextNode(node.data.slice(end)));
      node.replaceWith(fragment);
    }
    function format(tag) {
      return guard(() => {
        if (!['b', 'i', 'codeph', 'ph'].includes(tag)) return;
        const target = selection.capture(), { copy, range } = selection.clone(target);
        const block = selection.validateRange(range, copy, { selected: true, formatting: true });
        const parts = selection.textParts(range, block), begin = selection.offset(block, range.startContainer, range.startOffset), end = selection.offset(block, range.endContainer, range.endOffset);
        if (!parts.length) throw new Error('请先选中需要设置格式的文字');
        const remove = tag !== 'ph' && parts.every(part => hasFormat(part.node, tag));
        if (remove) {
          const ancestors = new Set();
          for (const part of parts) for (let node = part.node.parentElement; node && node !== block; node = node.parentElement) {
            if ((node.getAttribute('data-dita-source') || node.localName) === tag) ancestors.add(node);
          }
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT), records = []; let node;
          while ((node = walker.nextNode())) {
            if (node.parentElement.closest(selection.PROTECTED)) continue;
            if (!Array.from(ancestors).some(parent => parent.contains(node))) continue;
            const part = parts.find(part => part.node === node); records.push({ node, start: part?.start ?? 0, end: part?.end ?? 0 });
          }
          // Retain ID/product/other attributes on a neutral phrase around the
          // original extent, then keep emphasis on the unselected text only.
          for (const parent of ancestors) {
            const phrase = document.createElement('span');
            for (const attr of parent.attributes) phrase.setAttribute(attr.name, attr.value);
            phrase.setAttribute('data-dita-source', 'ph'); phrase.ditaSourcePath = parent.ditaSourcePath;
            phrase.append(...parent.childNodes); parent.replaceWith(phrase);
          }
          for (const record of records) {
            const { node, start, end } = record, fragment = document.createDocumentFragment();
            const append = (text, formatted) => {
              if (!text) return;
              if (!formatted) fragment.append(document.createTextNode(text));
              else { const span = document.createElement('span'); span.setAttribute('data-dita-source', tag); span.textContent = text; fragment.append(span); }
            };
            if (end === 0) append(node.data, true);
            else { append(node.data.slice(0, start), true); append(node.data.slice(start, end), false); append(node.data.slice(end), true); }
            node.replaceWith(fragment);
          }
        } else for (const part of parts) if (!hasFormat(part.node, tag)) wrap(part.node, part.start, part.end, tag);
        selection.commit(target, copy, block, begin, end);
        setStatus((remove ? '已取消' : '已设置') + ({ b: '粗体', i: '斜体', codeph: '行内代码', ph: '短语标记' })[tag] + '，可撤销；保存后写入工作区');
      });
    }
    function createBlock(tag) {
      let node = document.createElement(tag === 'codeblock' ? 'pre' : tag);
      node.setAttribute('data-dita-source', tag); let focus = node;
      if (['ul', 'ol'].includes(tag)) {
        for (const text of ['列表项', '列表项']) { const li = document.createElement('li'); li.setAttribute('data-dita-source', 'li'); li.textContent = text; node.append(li); }
        focus = node.firstElementChild;
      } else if (tag === 'section') {
        const title = document.createElement('h3'), paragraph = document.createElement('p');
        title.setAttribute('data-dita-source', 'title'); title.textContent = '新节标题'; paragraph.setAttribute('data-dita-source', 'p'); paragraph.textContent = '新节内容';
        node.append(title, paragraph); focus = title;
      } else if (tag === 'table') {
        node = document.createElement('div'); node.setAttribute('data-dita-source', 'table');
        const table = document.createElement('table'), row = document.createElement('tr');
        for (let i = 0; i < 2; i++) { const cell = document.createElement('td'); cell.textContent = '单元格'; row.append(cell); }
        table.append(row); node.append(table); focus = row.firstElementChild;
      } else { node.textContent = tag === 'note' ? '在此输入说明' : tag === 'codeblock' ? '在此输入代码' : '在此输入内容'; if (tag === 'note') node.className = 'note'; }
      return { node, focus };
    }
    function insert(tag = dom.insertElementSelect.value) {
      return guard(() => {
        if (!state.filesMap.has(state.activePath)) throw new Error('请先打开一个文档');
        if (!['visual', 'editor'].includes(state.mode)) throw new Error('请先切换到编写模式');
        if (tag === 'fn') return A.authorNotes.show();
        if (tag === 'image' || tag === 'xref') return A.resources.show(tag === 'image' ? 'image' : 'link');
        if (state.mode === 'editor') return insertSource(tag);
        if (['b', 'i', 'codeph', 'ph'].includes(tag)) return format(tag);
        if (!['p', 'ul', 'ol', 'section', 'note', 'codeblock', 'table'].includes(tag)) return;
        const target = selection.capture(), { copy, range } = selection.clone(target);
        range.collapse(false);
        const body = elementOf(range.endContainer).closest('[data-dita-body]');
        let anchor = range.endContainer === body ? body : selection.validateRange(range, copy, { body: true });
        if (!body || anchor.matches('h2,h3,h4')) throw new Error('请在正文段落、列表或表格中放置光标');
        if (anchor !== body && tag === 'section') while (anchor.parentElement !== body) anchor = anchor.parentElement;
        if (tag === 'table' && anchor.closest('td,th')) anchor = anchor.closest('[data-dita-source="table"]');
        if (['ul', 'ol'].includes(tag) && anchor.matches('li')) anchor = anchor.closest('ul,ol');
        const created = createBlock(tag);
        if (anchor === body || anchor.matches('li') && tag === 'p') anchor.append(created.node); else anchor.after(created.node);
        selection.commit(target, copy, created.focus, 0, created.focus.textContent.length);
        setStatus('已插入' + ({ p: '段落', ul: '无序列表', ol: '有序列表', section: '节', note: '说明', codeblock: '代码块', table: '表格' })[tag] + '，可直接输入；保存后写入工作区');
      });
    }
    function surfaces() {
      const file = state.filesMap.get(state.activePath); if (!file) return [];
      return /\.ditamap$/i.test(file.path) ? Array.from(dom.visualEditor.querySelectorAll('.map-topic-surface')).map(surface => ({ surface, path: surface.dataset.mapTopicPath })) : [{ surface: dom.visualEditor, path: file.path }];
    }
    function chooseScope(preferred) {
      const choices = surfaces(), picker = get('editSearchTopic'), old = preferred || picker.value;
      picker.replaceChildren();
      for (const choice of choices) { const option = document.createElement('option'); option.value = choice.path; option.textContent = choice.path; picker.append(option); }
      if (choices.some(choice => choice.path === old)) picker.value = old;
      picker.disabled = choices.length <= 1;
      scope = choices.find(choice => choice.path === picker.value) || null;
    }
    function clearHighlights() { for (const name of ['dita-find-all', 'dita-find-current']) root.CSS?.highlights?.delete(name); }
    function paint() {
      clearHighlights();
      if (root.CSS?.highlights && root.Highlight) {
        root.CSS.highlights.set('dita-find-all', new root.Highlight(...matches.map(match => match.range)));
        if (matches[active]) root.CSS.highlights.set('dita-find-current', new root.Highlight(matches[active].range));
      }
    }
    function collectMatches(surface, query) {
      const groups = [], walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT); let node, group;
      while ((node = walker.nextNode())) {
        const block = selection.blockOf(node);
        if (!block || node.parentElement.closest(selection.PROTECTED)) { group = null; continue; }
        if (!group || group.block !== block) { group = { block, text: '', nodes: [] }; groups.push(group); }
        group.nodes.push({ node, start: group.text.length, end: group.text.length + node.length }); group.text += node.data;
      }
      const found = [], regex = new RegExp(escapeRegex(query), dom.editFindCase.checked ? 'g' : 'gi'); truncated = false;
      for (const group of groups) for (const hit of group.text.matchAll(regex)) {
        if (found.length === 2000) { truncated = true; return found; }
        const start = hit.index, end = start + hit[0].length, parts = group.nodes.filter(part => part.end > start && part.start < end).map(part => ({ node: part.node, start: Math.max(0, start - part.start), end: Math.min(part.node.length, end - part.start) }));
        if (!parts.length) continue;
        const range = document.createRange(); range.setStart(parts[0].node, parts[0].start); range.setEnd(parts.at(-1).node, parts.at(-1).end);
        found.push({ range, parts, block: group.block, text: hit[0] });
      }
      return found;
    }
    function refreshFind({ reset = true } = {}) {
      if (dom.editSearchPanel.hidden || state.mode === 'editor') return;
      const query = dom.editFindInput.value;
      scope = surfaces().find(choice => choice.path === get('editSearchTopic').value) || null;
      const file = scope && state.filesMap.get(scope.path), stale = file && scope.surface.ditaSourceContent !== file.current;
      matches = query && scope && !stale ? collectMatches(scope.surface, query) : []; if (!query || !scope || stale) truncated = false;
      active = !matches.length ? -1 : reset ? 0 : Math.min(Math.max(0, active), matches.length - 1);
      if (scope) scope.current = state.filesMap.get(scope.path)?.current;
      paint(); dom.editFindMeta.textContent = stale ? '正文已变化，请重新打开此 Topic 后查找' : !query ? '输入要查找的正文文字（不含注脚）' : !matches.length ? '未找到' : (active + 1) + '/' + matches.length + (truncated ? '（已达 2000 处上限，请缩小查找范围）' : '');
      const readOnly = state.mode !== 'visual'; dom.editReplaceButton.disabled = readOnly || !matches.length; dom.editReplaceAllButton.disabled = readOnly || !matches.length || truncated;
      get('editSearchKind').textContent = readOnly ? '只读正文' : '正文';
    }
    function showMatch(index, focus = false) {
      if (!matches.length) return;
      active = (index + matches.length) % matches.length; paint();
      dom.editFindMeta.textContent = (active + 1) + '/' + matches.length + (truncated ? '（已达上限）' : '');
      const match = matches[active]; match.block.scrollIntoView({ block: 'nearest' });
      if (focus || !root.CSS?.highlights) { scope.surface.focus({ preventScroll: true }); const s = root.getSelection(); s.removeAllRanges(); s.addRange(match.range.cloneRange()); selection.remember(); }
    }
    function openFind() {
      return guard(() => {
        if (!state.filesMap.has(state.activePath)) throw new Error('请先打开一个文档');
        if (state.mode === 'review') throw new Error('请切换到编写或阅读模式后查找正文');
        const text = selectedText();
        if (state.mode === 'editor') {
          get('editSearchKind').textContent = 'XML 源码'; get('editSearchTopic').hidden = true;
          dom.editReplaceButton.disabled = false; dom.editReplaceAllButton.disabled = false; return openSourceFind();
        }
        let path; try { path = selection.capture().path; } catch { /* Reading and a fresh Map use the visibly selected scope. */ }
        get('editSearchTopic').hidden = false; chooseScope(path); dom.editSearchPanel.hidden = false;
        if (text && text.length <= 200) dom.editFindInput.value = text;
        refreshFind(); if (matches.length) showMatch(0); dom.editFindInput.focus(); dom.editFindInput.select();
      });
    }
    function closeFind() { generation++; dom.editSearchPanel.hidden = true; dom.editFindMeta.textContent = ''; clearHighlights(); matches = []; active = -1; }
    function nextFind() { return guard(() => { if (state.mode === 'editor') return findNextSource(); if (!matches.length) refreshFind(); else showMatch(active + 1, true); }); }
    function replace(all = false) {
      return guard(() => {
        if (state.mode === 'editor') return all ? replaceAllSource() : replaceSource();
        if (state.mode !== 'visual') throw new Error('阅读模式不可替换，请先切换到编写模式');
        if (!scope || !matches.length) return;
        const file = state.filesMap.get(scope.path);
        if (!file || file.current !== scope.current || scope.surface.ditaSourceContent !== file.current || !scope.surface.isConnected || matches.some(match => !scope.surface.contains(match.range.startContainer))) { refreshFind(); throw new Error('正文已变化，请确认最新匹配后再替换'); }
        if (all && truncated) throw new Error('匹配过多，请缩小查找范围后再全部替换');
        const chosen = all ? matches : [matches[active]], target = { ...scope, file, range: chosen[0].range, activePath: state.activePath, workspace: A.api.token, current: file.current };
        const { copy } = selection.clone(target);
        function copyNode(node) { const path = []; while (node !== scope.surface) { path.unshift(Array.from(node.parentNode.childNodes).indexOf(node)); node = node.parentNode; } return path.reduce((n, i) => n.childNodes[i], copy); }
        const replacement = dom.editReplaceInput.value;
        const first = chosen[0], focusBlock = copyNode(first.block), begin = selection.offset(first.block, first.range.startContainer, first.range.startOffset);
        for (const match of chosen.slice().reverse()) for (let i = match.parts.length - 1; i >= 0; i--) {
          const part = match.parts[i], node = copyNode(part.node);
          node.data = node.data.slice(0, part.start) + (i === 0 ? replacement : '') + node.data.slice(part.end);
        }
        selection.commit(target, copy, focusBlock, begin, begin + replacement.length);
        const afterReplacement = root.getSelection().getRangeAt(0).cloneRange(); afterReplacement.collapse(false);
        refreshFind({ reset: false });
        if (matches.length) {
          const next = all ? 0 : matches.findIndex(match => match.range.compareBoundaryPoints(Range.START_TO_START, afterReplacement) >= 0);
          showMatch(next < 0 ? 0 : next);
        }
        setStatus('已替换 ' + chosen.length + ' 处 · ' + scope.path + '；可撤销，保存后写入工作区');
      });
    }
    function syncMode() {
      if (state.mode !== 'visual') { closeFind(); clearHighlights(); }
      else if (!dom.editSearchPanel.hidden) { chooseScope(scope?.path); refreshFind(); }
    }
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
  i: '<i>{{selection}}</i>',
  codeph: '<codeph>{{selection}}</codeph>'
});

function insertionIndent(text, position) {
  const lineStart = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  const linePrefix = text.slice(lineStart, position);
  return { linePrefix, indent: (linePrefix.match(/^\s*/) || [''])[0] };
}

function insertSource(tag) {
  const file = state.filesMap.get(state.activePath);
  if (!file) {
    setStatus('请先打开一个 DITA 文件', true);
    return;
  }
  if (state.mode === 'preview' || state.mode === 'review') return;
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


function openSourceFind() {
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

function closeSourceFind() {
  if (!dom.editSearchPanel) return;
  dom.editSearchPanel.hidden = true;
  dom.editFindMeta.textContent = '';
}

function findNextSource() {
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

function replaceSource() {
  const file = state.filesMap.get(state.activePath);
  const query = dom.editFindInput?.value || '';
  if (!file || !query) return findNextSource();
  const start = dom.editor.selectionStart || 0;
  const end = dom.editor.selectionEnd || start;
  const selected = dom.editor.value.slice(start, end);
  const matches = dom.editFindCase?.checked ? selected === query : selected.toLocaleLowerCase() === query.toLocaleLowerCase();
  if (!matches) {
    findNextSource();
    return;
  }
  const replacement = dom.editReplaceInput?.value || '';
  const next = dom.editor.value.slice(0, start) + replacement + dom.editor.value.slice(end);
  setFileContent(file, next, { updateEditor: false });
  dom.editor.value = file.current;
  dom.editor.focus();
  dom.editor.setSelectionRange(start, start + replacement.length);
  setStatus('已替换当前匹配');
  findNextSource();
}

function replaceAllSource() {
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


    const formatButtons = [['authorBoldButton', 'b'], ['authorItalicButton', 'i'], ['authorCodeButton', 'codeph']];
    function syncFormatState() {
      let parts = [];
      try {
        if (!document.querySelector('dialog[open]')) { const target = selection.capture(); if (!target.range.collapsed) { const block = selection.validateRange(target.range, target.surface, { selected: true, formatting: true }); parts = selection.textParts(target.range, block); } }
      } catch { /* Missing, protected or stale selections have no active format. */ }
      for (const [id, tag] of formatButtons) get(id).setAttribute('aria-pressed', String(parts.length > 0 && parts.every(part => hasFormat(part.node, tag))));
    }
    for (const [id, tag] of formatButtons) {
      get(id).addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault(); }); get(id).addEventListener('click', () => format(tag));
    }
    document.addEventListener('selectionchange', syncFormatState); syncFormatState();
    get('authorInsertSelect').addEventListener('change', event => { const tag = event.target.value; event.target.value = ''; if (tag) insert(tag); });
    get('authorFindButton').addEventListener('click', openFind);
    dom.insertElementButton.addEventListener('click', () => insert());
    dom.findReplaceButton.addEventListener('click', () => dom.editSearchPanel.hidden ? openFind() : closeFind());
    dom.editFindNextButton.addEventListener('click', nextFind); dom.editReplaceButton.addEventListener('click', () => replace()); dom.editReplaceAllButton.addEventListener('click', () => replace(true)); dom.editFindCloseButton.addEventListener('click', closeFind);
    dom.editFindInput.addEventListener('compositionstart', () => { composing = true; }); dom.editFindInput.addEventListener('compositionend', () => { composing = false; refreshFind(); });
    dom.editFindInput.addEventListener('input', () => { if (!composing) state.mode === 'editor' ? dom.editFindMeta.textContent = '' : refreshFind(); });
    dom.editFindCase.addEventListener('change', () => refreshFind()); get('editSearchTopic').addEventListener('change', () => { refreshFind(); if (matches.length) showMatch(0); });
    dom.editFindInput.addEventListener('keydown', event => { if (event.isComposing || event.keyCode === 229) return; if (event.key === 'Enter') { event.preventDefault(); nextFind(); } else if (event.key === 'Escape') { event.preventDefault(); closeFind(); } });
    A.dom.visualEditor.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || event.keyCode === 229 || state.mode !== 'visual') return;
      const tag = ({ b: 'b', i: 'i' })[event.key.toLowerCase()]; if (tag) { event.preventDefault(); format(tag); }
    });
    dom.contextToolbar.addEventListener('mousedown', event => { if (event.target.closest('[data-context-action="bold"],[data-context-action="italic"],[data-context-action="code-inline"]')) event.preventDefault(); });
    A.events.on('document:changed', file => { if (scope?.path !== file.path || dom.editSearchPanel.hidden) return; const ticket = ++generation; queueMicrotask(() => { if (ticket === generation) refreshFind({ reset: false }); }); });
    for (const name of ['workspace:willChange', 'file:opened', 'file:closed']) A.events.on(name, closeFind);
    return { insert, format, openFind, closeFind, nextFind, replace, syncMode };
  }
  root.DitaEditorTools = { createController };
})(window);

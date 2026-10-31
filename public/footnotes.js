'use strict';
(function (root) {
  function createPanel(A) {
    const core = root.DitaFootnotesCore;
    const $ = id => document.getElementById(id);
    const panel = $('footnotesPanel'), inspector = A.dom.inspector;
    let shown = false, notes = [], revision = '', generation = 0, timer;
    let editing = null, scopePath = '';
    function setScope(path) { scopePath = path; revision = ''; generation++; scheduleRefresh(); }
    const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
    function show(showNotes) {
      shown = showNotes;
      if (showNotes && A.state.mode === 'review') A.setMode('visual');
      inspector.classList.toggle('notes-open', shown);
      inspector.classList.add('drawer-open');
      $('inspectorToggleButton')?.setAttribute('aria-expanded', 'true');
      syncMode();
      if (shown) refresh(true);
    }
    function syncMode() {
      const visible = shown && A.state.mode !== 'review';
      panel.hidden = !visible;
      $('propertiesTab').classList.toggle('active', !shown);
      $('footnotesTab').classList.toggle('active', shown);
      $('propertiesTab').setAttribute('aria-selected', String(!shown));
      $('footnotesTab').setAttribute('aria-selected', String(shown));
      A.dom.attributesPanel.hidden = visible || A.state.mode === 'review';
      A.dom.inspectorElement.hidden = visible || A.state.mode === 'review';
      if (visible) { A.dom.contextToolbar.hidden = true; A.dom.inspectorTitle.textContent = '型号与注脚'; }
    }
    function error(message) { $('footnotesMessage').textContent = message; }
    function draw() {
      const model = $('footnoteModel').value, query = $('footnoteSearch').value;
      const matches = core.filterNotes(notes, model, query);
      $('footnoteCount').textContent = String(notes.length);
      $('footnoteUnassigned').textContent = String(notes.filter(note => !note.products.length).length);
      $('footnoteResultCount').textContent = matches.length + ' 条注脚';
      const list = $('footnoteList'); list.replaceChildren();
      if (!matches.length) list.append(el('p', 'footnote-empty', notes.length ? '没有匹配注脚，试试其他型号或关键词。' : '当前文档没有注脚。打开功能手册或包含 fn 注脚的 Topic 后查看。'));
      for (const note of matches) {
        const card = el('article', 'footnote-card');
        const header = el('div', 'footnote-card-heading');
        header.append(el('span', 'footnote-number', String(note.index + 1).padStart(2, '0')),
          el('span', note.products.length ? 'footnote-model-badge' : 'footnote-unassigned', note.products.join(' / ') || '未标注型号'));
        card.append(header, el('p', 'footnote-context', note.context || '文档注脚'), el('p', 'footnote-text', note.text || (note.referenced ? '引用注脚，请在引用源中维护。' : '（空注脚）')));
        const path = el('small', 'footnote-path', note.path); path.title = note.path; card.append(path);
        const actions = el('div', 'footnote-actions');
        const locate = el('button', '', '定位正文'); locate.type = 'button'; locate.addEventListener('click', () => focus(note));
        const edit = el('button', 'footnote-edit-button', '编辑注脚'); edit.type = 'button'; edit.disabled = note.referenced;
        edit.title = note.referenced ? '此注脚来自内容引用，请在引用源中修改' : '修改内容与适用型号';
        edit.addEventListener('click', () => beginEdit(note));
        actions.append(locate, edit); card.append(actions); list.append(card);
      }
      syncMode();
    }
    async function focus(note) {
      try {
        await A.openFile(note.path, { preserveFootnotesScope: true });
        const file = A.state.filesMap.get(note.path);
        if (file.current !== note.source) throw new Error('文档已变化，请刷新注脚列表后定位');
        A.setMode('visual');
        const marker = Array.from(A.dom.visualEditor.querySelectorAll('[data-dita-source="fn"]')).find(node => node.ditaSourcePath === note.xmlPath);
        if (marker) {
          const target = marker.closest('p,td,li') || marker;
          A.dom.visualEditor.querySelectorAll('.footnote-located').forEach(node => node.classList.remove('footnote-located'));
          target.classList.add('footnote-located'); target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else {
          A.setMode('editor'); A.dom.editor.focus(); A.dom.editor.setSelectionRange(note.start, note.end);
          const lines = file.current.slice(0, note.start).split('\n').length - 1;
          A.dom.editor.scrollTop = Math.max(0, lines - 4) * parseFloat(getComputedStyle(A.dom.editor).lineHeight || '20');
        }
        A.setStatus('已定位注脚 · ' + note.path); syncMode();
      } catch (e) { error(e.message); }
    }
    async function beginEdit(note) {
      try {
        if (editing && !confirm('放弃当前注脚编辑，打开另一条注脚？')) return;
        await A.openFile(note.path, { preserveFootnotesScope: true });
        const file = A.state.filesMap.get(note.path);
        if (file.current !== note.source) throw new Error('文档已变化，请刷新后重新编辑注脚');
        editing = { note, file, workspace: A.api.token };
        $('footnoteEditHeading').textContent = '编辑注脚 ' + (note.index + 1);
        $('footnoteContentLabel').textContent = note.rich ? '注脚内容（保留行内 XML 标记）' : '注脚内容';
        $('footnoteContent').value = note.rich ? note.inner : note.text;
        $('footnoteProducts').value = note.products.join(' ');
        $('footnoteEditError').textContent = '';
        $('footnoteEditDialog').showModal(); $('footnoteContent').focus();
      } catch (e) { error(e.message); }
    }
    function signature() {
      return JSON.stringify([A.api.token, scopePath || A.state.activePath, Array.from(A.state.filesMap.values(), f => [f.path, f.current])]);
    }
    async function refresh(force = false) {
      if (!shown || A.state.mode === 'review') return;
      if (scopePath && !A.state.filesMap.has(scopePath)) scopePath = A.state.activePath;
      const key = signature();
      if (!force && key === revision) { syncMode(); return; }
      revision = key;
      const token = ++generation, workspace = A.api.token;
      const activePath = scopePath || A.state.activePath;
      const active = A.state.filesMap.get(activePath);
      $('footnoteScope').textContent = activePath || '当前功能文档';
      let files = new Map(), failures = [];
      error(active ? '正在读取注脚…' : '先从左侧打开一份功能手册。');
      try {
        if (active && /\.ditamap$/i.test(active.path)) {
          const response = await A.api.request('/api/map/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: active.path, content: active.current }) });
          if (!response.ok) throw new Error(await A.api.error(response));
          ({ files, failures } = await A.loadTopicFiles(await response.json()));
        } else if (active) files.set(active.path, { path: active.path, current: active.current });
        const next = [];
        for (const file of files.values()) {
          try { next.push(...core.listFootnotes(file.current, file.path)); }
          catch (e) { failures.push({ path: file.path, error: e.message }); }
        }
        if (token !== generation || workspace !== A.api.token || activePath !== (scopePath || A.state.activePath)) return;
        notes = next;
        const previous = $('footnoteModel').value;
        $('footnoteModel').replaceChildren(new Option('全部型号', ''));
        for (const model of [...new Set(notes.flatMap(note => note.products))].sort()) $('footnoteModel').add(new Option(model, model));
        if (Array.from($('footnoteModel').options).some(option => option.value === previous)) $('footnoteModel').value = previous;
        draw();
        error(failures.length ? '有 ' + failures.length + ' 个文档无法读取：' + failures.map(f => f.path).join('、') : '未标注型号的注脚始终保留在筛选结果中。');
      } catch (e) { if (token === generation) { notes = []; draw(); error('读取失败：' + e.message); } }
    }
    function scheduleRefresh() { clearTimeout(timer); if (shown) timer = setTimeout(() => refresh(), 180); }
    $('footnotesTab').addEventListener('click', () => show(true));
    $('propertiesTab').addEventListener('click', () => show(false));
    $('footnotesButton').addEventListener('click', () => show(true));
    $('footnoteModel').addEventListener('change', draw);
    $('footnoteSearch').addEventListener('input', draw);
    $('footnoteRefresh').addEventListener('click', () => refresh(true));
    $('footnoteCancel').addEventListener('click', () => $('footnoteEditDialog').close());
    $('footnoteEditDialog').addEventListener('close', () => { editing = null; });
    $('footnoteEditForm').addEventListener('submit', event => {
      event.preventDefault();
      try {
        if (!editing || editing.workspace !== A.api.token || A.state.filesMap.get(editing.file.path) !== editing.file) throw new Error('工作区已变化，请重新打开注脚');
        const { file, note } = editing;
        const next = core.updateFootnote(file.current, note, { content: $('footnoteContent').value, products: $('footnoteProducts').value });
        A.setFileContent(file, next);
        $('footnoteEditDialog').close();
        A.setStatus('注脚已更新，可撤销 · 点击保存后写入磁盘');
        refresh(true);
      } catch (e) { $('footnoteEditError').textContent = e.message; }
    });
    return { scheduleRefresh, syncMode, show, setScope };
  }
  root.DitaFootnotes = { createPanel };
})(window);

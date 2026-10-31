'use strict';
(function (root) {
  function createPanel(A) {
    const core = root.DitaFootnotesCore;
    const $ = id => document.getElementById(id);
    const panel = $('footnotesPanel'), inspector = A.dom.inspector;
    let shown = false, notes = [], revision = '', generation = 0, timer;
    let editing = null, scopePath = '';
    const picker = root.DitaNoteScope.createPicker(A, 'footnote', 'footnoteEditForm', 'footnoteProducts');
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
      const matches = core.filterNotes(notes, model, query).filter(note => !$('footnoteUnassignedOnly').checked || note.unmarked);
      $('footnoteCount').textContent = String(notes.length);
      $('footnoteUnassigned').textContent = String(notes.filter(note => note.unmarked).length);
      $('footnoteResultCount').textContent = matches.length + ' 条注脚';
      const list = $('footnoteList'); list.replaceChildren();
      if (!matches.length) list.append(el('p', 'footnote-empty', notes.length ? '没有匹配注脚。试试其他型号，或取消“仅看待确认”。' : '还没有注脚。在编写模式将光标放到正文文字后，点击“新增注脚”。'));
      for (const note of matches) {
        const card = el('article', 'footnote-card');
        const header = el('div', 'footnote-card-heading');
        header.append(el('span', 'footnote-number', String(note.index + 1).padStart(2, '0')),
          el('span', !note.unmarked ? 'footnote-model-badge' : 'footnote-unassigned', note.common ? '已确认通用' : note.conditions.join(' ∩ ') || '待确认适用范围'));
        card.append(header, el('p', 'footnote-context', note.context || '文档注脚'), el('p', 'footnote-text', note.text || (note.referenced ? '引用注脚，请在引用源中维护。' : '（空注脚）')));
        const path = el('small', 'footnote-path', note.path); path.title = note.path; card.append(path);
        const actions = el('div', 'footnote-actions');
        const locate = el('button', '', '定位正文'); locate.type = 'button'; locate.addEventListener('click', () => focus(note));
        const edit = el('button', 'footnote-edit-button', '编辑注脚'); edit.type = 'button'; edit.disabled = false;
        edit.title = note.reused ? '打开公共注脚引用源进行修改' : '修改内容与适用型号';
        if (note.reused) edit.textContent = '编辑引用源';
        edit.addEventListener('click', () => beginEdit(note));
        actions.append(locate, edit); card.append(actions); list.append(card);
      }
      syncMode();
    }
    async function focus(note) {
      note = note.sourceNote || note;
      try {
        await A.bodyNavigation.node(note.path, note.xmlPath, note.source);
        A.setStatus('已定位注脚 · ' + note.path); syncMode();
      } catch (e) { error(e.message); }
    }
    async function beginEdit(note) {
      const reused = note.reused; note = note.sourceNote || note;
      try {
        if (editing && $('footnoteEditDialog').open && !confirm('放弃当前注脚编辑，打开另一条注脚？')) return;
        await A.project.ready();
        let surface = A.state.mode === 'visual' ? (/\.ditamap$/i.test(A.state.activePath) ? Array.from(A.dom.visualEditor.querySelectorAll('.map-topic-surface')).find(node => node.dataset.mapTopicPath === note.path) : A.state.activePath === note.path ? A.dom.visualEditor : null) : null;
        if (reused || !surface) { await A.openFile(note.path, { preserveFootnotesScope: true }); if (A.state.mode !== 'visual') A.setMode('visual'); surface = A.dom.visualEditor; }
        const file = A.state.filesMap.get(note.path);
        if (file.current !== note.source) throw new Error('文档已变化，请刷新后重新编辑注脚');
        if (surface.ditaSourceContent !== file.current) throw new Error('正文已变化，请重新打开后编辑注脚');
        editing = { note, file, workspace: A.api.token, activePath: A.state.activePath, surface, project: A.project.expectedContent,
          beforeSelection: A.authorSelection.bookmark(surface) || A.authorSelection.afterNode(note.xmlPath) };
        $('footnoteEditHeading').textContent = '编辑注脚 ' + (note.index + 1);
        $('footnoteContentLabel').textContent = note.rich ? '注脚内容（保留行内 XML 标记）' : '注脚内容';
        $('footnoteContent').value = note.rich ? note.inner : note.text;
        picker.draw(note);
        $('footnoteSourceHint').textContent = reused ? '正在修改公共引用源，所有引用位置会随之更新。引用处的型号条件仍会生效。' : '型号条件同时受 Topic 祖先约束。';
        $('footnoteEditError').textContent = '';
        $('footnoteEditDialog').showModal(); $('footnoteContent').focus();
      } catch (e) { error(e.message); }
    }
    function signature() {
      return JSON.stringify([A.api.token, scopePath || A.state.activePath, A.project?.expectedContent, Array.from(A.state.filesMap.values(), f => [f.path, f.current])]);
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
      error(active ? '正在读取注脚…' : '先从左侧打开一份功能手册。');
      try {
        if (!active) { notes = []; draw(); return; }
        const snapshot = await A.manual.capture(activePath);
        const data = A.manual.listNotes(snapshot);
        if (token !== generation || workspace !== A.api.token || activePath !== (scopePath || A.state.activePath)) return;
        notes = data.notes;
        const previous = $('footnoteModel').value;
        $('footnoteModel').replaceChildren(new Option('全部型号', ''));
        const models = new Set([...(A.project?.value.models || []), ...A.manual.listModels(snapshot)]);
        for (const model of [...models].sort()) $('footnoteModel').add(new Option(model, model));
        if (Array.from($('footnoteModel').options).some(option => option.value === previous)) $('footnoteModel').value = previous;
        draw();
        const common = notes.filter(note => note.common).length;
        error(common + ' 条已确认通用 · 待确认注脚会保留在交付中。');
      } catch (e) { if (token === generation) { notes = []; draw(); error('读取失败：' + e.message); } }
    }
    function scheduleRefresh() { clearTimeout(timer); if (shown) timer = setTimeout(() => refresh(), 180); }
    $('footnotesTab').addEventListener('click', () => show(true));
    $('propertiesTab').addEventListener('click', () => show(false));
    $('footnotesButton').addEventListener('click', () => show(true));
    $('footnoteModel').addEventListener('change', draw);
    $('footnoteSearch').addEventListener('input', draw);
    $('footnoteUnassignedOnly').addEventListener('change', draw);
    $('footnoteRefresh').addEventListener('click', () => refresh(true));
    function cancelEdit() {
      const target = editing; editing = null; $('footnoteEditDialog').close();
      if (target?.surface?.isConnected && target.workspace === A.api.token && target.activePath === A.state.activePath && target.file.current === target.note.source) A.authorSelection.restore(target.surface, target.beforeSelection);
    }
    $('footnoteCancel').addEventListener('click', cancelEdit);
    $('footnoteEditDialog').addEventListener('cancel', event => { event.preventDefault(); cancelEdit(); });
    $('footnoteEditDialog').addEventListener('close', () => { if (!$('footnoteEditDialog').open) editing = null; });
    $('footnoteEditForm').addEventListener('submit', event => {
      event.preventDefault();
      try {
        if (!editing || editing.workspace !== A.api.token || A.state.filesMap.get(editing.file.path) !== editing.file) throw new Error('工作区已变化，请重新打开注脚');
        const { file, note } = editing;
        if (editing.project !== A.project.expectedContent) throw new Error('型号清单已变化，请重新打开注脚');
        const next = core.updateFootnote(file.current, note, { content: $('footnoteContent').value, ...picker.read() });
        const surface = editing.surface;
        if (surface) {
          if (editing.activePath !== A.state.activePath || !editing.surface.isConnected) throw new Error('编写位置已变化，请重新打开注脚');
          A.applyAuthorEdit(file, next, surface, { selectionBefore: editing.beforeSelection, selectionAfter: A.authorSelection.afterNode(note.xmlPath) });
        } else A.setFileContent(file, next);
        editing = null;
        $('footnoteEditDialog').close();
        if (surface) A.authorNotes?.focusAfter(surface, note.xmlPath);
        A.setStatus('注脚已更新，可撤销 · 点击保存后写入工作区');
        refresh(true);
      } catch (e) { $('footnoteEditError').textContent = e.message; }
    });
    A.events.on('project:changed', () => { revision = ''; scheduleRefresh(); });
    async function editAt(path, xmlPath) {
      try {
        const file = A.state.filesMap.get(path), note = file && core.listFootnotes(file.current, path).find(note => note.xmlPath === xmlPath);
        if (!note) throw new Error('注脚位置已变化，请重新点击正文标记');
        if (note.referenced) { show(true); error('这条注脚引用公共内容，请在列表中选择“编辑引用源”。'); return; }
        await beginEdit(note);
      } catch (e) { A.setStatus(e.message, true); }
    }
    return { scheduleRefresh, syncMode, show, setScope, editAt };
  }
  root.DitaFootnotes = { createPanel };
})(window);

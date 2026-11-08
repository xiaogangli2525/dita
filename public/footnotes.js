'use strict';
(function (root) {
  function createPanel(A) {
    const core = root.DitaFootnotesCore;
    const $ = id => document.getElementById(id);
    const panel = $('footnotesPanel');
    let shown = false, notes = [], revision = '', generation = 0, timer;
    const expandedContexts = new Set();
    let editing = null, scopePath = '', peekNote = null, peekMarker = null, peekGeneration = 0;
    const peek = $('footnotePeek');
    const picker = root.DitaNoteScope.createPicker(A, 'footnote', 'footnoteEditForm', 'footnoteProducts');
    function setScope(path) {
      hidePeek();
      const changed = scopePath !== path;
      scopePath = path; revision = ''; generation++;
      A.notePresentation.setScope(path);
      if (changed) {
        // Do not leave actionable notes from the previous document on screen
        // while the new manual is being captured by the debounced refresh.
        notes = [];
        expandedContexts.clear();
        $('footnoteScope').textContent = path || '当前功能文档';
        $('footnoteCount').textContent = '—';
        $('footnoteUnassigned').textContent = '—';
        $('footnoteResultCount').textContent = '';
        $('footnoteList').replaceChildren(el('p', 'footnote-empty', '正在读取注脚…'));
      }
      scheduleRefresh();
    }
    const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
    function show(showNotes) { A.shell.openPanel(showNotes ? 'notes' : 'properties'); }
    function setVisible(value) {
      const changed = shown !== value;
      shown = value; syncMode();
      if (shown && changed) refresh(true);
    }
    function syncMode() { panel.hidden = !shown || A.state.mode === 'review'; }
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
        header.append(el('span', 'footnote-number', note.label || String(note.index + 1)),
          el('span', !note.unmarked ? 'footnote-model-badge' : 'footnote-unassigned', note.common ? '已确认通用' : note.conditions.join(' ∩ ') || '待确认适用范围'));
        const text = note.text || (note.referenced ? '引用注脚，请在引用源中维护。' : '（空注脚）');
        const excerpt = Array.from(text.split('\n').slice(0, 3).join('\n')).slice(0, 150).join('').trimEnd();
        card.append(header, el('p', 'footnote-text', excerpt === text ? text : excerpt + '…'));
        const actions = el('div', 'footnote-actions');
        const locate = el('button', '', '定位正文'); locate.type = 'button'; locate.addEventListener('click', () => focus(note));
        const edit = el('button', 'footnote-edit-button', '编辑注脚'); edit.type = 'button'; edit.disabled = false;
        edit.title = note.reused ? '打开公共注脚引用源进行修改' : '修改内容与适用型号';
        if (note.reused) edit.textContent = '编辑引用源';
        edit.addEventListener('click', () => beginEdit(note));
        const rules = el('button', '', '导出型号规则'); rules.type = 'button'; rules.addEventListener('click', () => A.noteRules.show(note));
        actions.append(edit, locate, rules); card.append(actions);
        const context = el('details', 'footnote-card-context');
        const key = note.path + '\n' + note.xmlPath;
        context.open = expandedContexts.has(key);
        const disclosure = el('summary', '', excerpt === text ? '命令上下文与来源' : '完整注脚、命令上下文与来源');
        disclosure.addEventListener('click', () => {
          if (context.open) expandedContexts.delete(key);
          else expandedContexts.add(key);
        });
        context.append(disclosure);
        if (excerpt !== text) context.append(el('p', 'footnote-text', text));
        if (note.context) context.append(el('p', 'footnote-context', note.context));
        context.append(el('p', 'note-card-impact', (note.reused ? '公共来源 · ' : '本地注脚 · ') + (note.usages?.length || 0) + ' 处使用（当前手册）'),
          el('small', 'footnote-path', note.path));
        card.append(context); list.append(card);
      }
      syncMode();
    }
    function scopeText(note) {
      return note.common ? '已确认通用' : note.conditions?.length ? '需同时满足：' + note.conditions.join(' ∩ ') + (note.unmarked ? ' · 本条待确认' : '') : '待确认适用范围 · 所有型号交付时保留';
    }
    function details(note, container) {
      container.replaceChildren(el('p', 'note-detail-scope', scopeText(note)));
      const source = note.sourceNote || note;
      container.append(el('p', 'note-detail-source', (note.reused ? '公共来源：' : '来源：') + source.path));
      const usages = note.usages || [];
      container.append(el('p', 'note-detail-impact', '当前手册内 ' + usages.length + ' 处使用' + (note.reused ? '；修改内容会更新引用此源的文档，其他手册未统计。' : '；修改此处的内容与型号条件。')));
      if (usages.length) {
        const disclosure = el('details', 'note-usage-list'), list = el('ul');
        disclosure.append(el('summary', '', '查看使用位置与型号条件'));
        for (const [index, use] of usages.entries()) list.append(el('li', '', '第 ' + (index + 1) + ' 处 · [' + use.label + '] ' + use.path + ' · ' + (use.conditions.join(' ∩ ') || '无型号约束')));
        disclosure.append(list); container.append(disclosure);
      }
    }
    function hidePeek({ restoreFocus = false } = {}) {
      const marker = peekMarker; peek.hidden = true; peekNote = peekMarker = null; peekGeneration++;
      if (restoreFocus && marker?.isConnected) marker.focus({ preventScroll: true });
    }
    function positionPeek() {
      if (peek.hidden || !peekMarker?.isConnected) return;
      const rect = peekMarker.getBoundingClientRect(), height = peek.offsetHeight;
      peek.style.left = Math.max(8, Math.min(innerWidth - peek.offsetWidth - 8, rect.left - 12)) + 'px';
      peek.style.top = Math.max(8, Math.min(innerHeight - height - 8, rect.bottom + height + 10 > innerHeight ? rect.top - height - 8 : rect.bottom + 8)) + 'px';
    }
    peek.addEventListener('toggle', positionPeek, true);
    async function previewMarker(marker) {
      hidePeek();
      if (A.state.mode !== 'visual' || document.querySelector('dialog[open]')) return;
      const ticket = peekGeneration, workspace = A.api.token, active = A.state.activePath;
      const surface = marker.closest('.map-topic-surface') || A.dom.visualEditor, path = surface.dataset.mapTopicPath || active;
      try {
        const note = await A.notePresentation.resolve(path, marker.ditaSourcePath);
        if (ticket !== peekGeneration || workspace !== A.api.token || active !== A.state.activePath || !marker.isConnected || A.state.mode !== 'visual' || document.querySelector('dialog[open]')) return;
        if (!note) throw new Error('注脚暂未解析，请检查手册或引用');
        peekNote = note; peekMarker = marker;
        $('footnotePeekHeading').textContent = '注脚 ' + (note.displayLabel || note.label);
        details(note, $('footnotePeekDetails'));
        $('footnotePeekDetails').prepend(el('p', 'note-peek-text', note.text || '（空注脚）'));
        $('footnotePeekEdit').textContent = note.reused ? '编辑公共源' : '编辑内容与型号';
        peek.hidden = false;
        positionPeek();
      } catch (e) { A.setStatus(e.message, true); }
    }
    A.dom.visualEditor.addEventListener('click', event => { const marker = event.target.closest('.fn-ref'); if (marker) previewMarker(marker); });
    A.dom.visualEditor.addEventListener('keydown', event => { if (event.key === ' ' && event.target.matches('.fn-ref')) { event.preventDefault(); previewMarker(event.target); } });
    $('footnotePeekClose').addEventListener('click', () => hidePeek({ restoreFocus: true }));
    $('footnotePeekEdit').addEventListener('click', () => { const note = peekNote; hidePeek(); if (note) beginEdit(note); });
    document.addEventListener('pointerdown', event => { if (!peek.contains(event.target) && !event.target.closest('.fn-ref')) hidePeek(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !peek.hidden) { event.preventDefault(); hidePeek({ restoreFocus: peek.contains(document.activeElement) }); } });
    document.addEventListener('focusin', event => { if (!peek.hidden && !peek.contains(event.target) && !A.dom.visualEditor.contains(event.target)) hidePeek(); });
    root.addEventListener('resize', () => hidePeek());
    document.addEventListener('scroll', event => { if (!peek.contains(event.target)) hidePeek(); }, true);
    for (const name of ['workspace:willChange', 'file:opening', 'file:closed', 'document:changed', 'project:changed', 'author:rendered']) A.events.on(name, () => hidePeek());
    async function focus(note) {
      note = note.sourceNote || note;
      try {
        await A.bodyNavigation.node(note.path, note.xmlPath, note.source);
        A.setStatus('已定位注脚 · ' + note.path); syncMode();
      } catch (e) { error(e.message); }
    }
    async function beginEdit(note) {
      hidePeek();
      const published = note;
      const displayLabel = note.displayLabel || note.label || '编号待确认';
      const reused = note.reused; note = note.sourceNote || note;
      try {
        if (editing && $('footnoteEditDialog').open && !confirm('放弃当前注脚编辑，打开另一条注脚？')) return;
        let returnTarget = null;
        try { const origin = A.authorSelection.capture(); returnTarget = { surface: origin.surface, file: origin.file, path: origin.path, current: origin.current, bookmark: A.authorSelection.bookmark(origin.surface, origin.range), activePath: A.state.activePath, workspace: A.api.token }; } catch { /* panel edits may have no body selection */ }
        await A.project.ready();
        let surface = A.state.mode === 'visual' ? (/\.ditamap$/i.test(A.state.activePath) ? Array.from(A.dom.visualEditor.querySelectorAll('.map-topic-surface')).find(node => node.dataset.mapTopicPath === note.path) : A.state.activePath === note.path ? A.dom.visualEditor : null) : null;
        if (!surface) { A.bodyNavigation.remember(); await A.openFile(note.path, { preserveFootnotesScope: true }); if (A.state.mode !== 'visual') A.setMode('visual'); surface = A.dom.visualEditor; }
        const file = A.state.filesMap.get(note.path);
        if (file.current !== note.source) throw new Error('文档已变化，请刷新后重新编辑注脚');
        if (surface.ditaSourceContent !== file.current) throw new Error('正文已变化，请重新打开后编辑注脚');
        editing = { note, file, returnTarget, workspace: A.api.token, activePath: A.state.activePath, surface, project: A.project.expectedContent,
          beforeSelection: A.authorSelection.bookmark(surface) || A.authorSelection.afterNode(note.xmlPath) };
        $('footnoteEditHeading').textContent = '编辑注脚 ' + displayLabel;
        $('footnoteContentLabel').textContent = note.rich ? '注脚内容（保留行内 XML 标记）' : '注脚内容';
        $('footnoteContent').value = note.rich ? note.inner : note.text;
        picker.draw(note); details(published, $('footnoteEditDetails'));
        $('footnoteSourceHint').textContent = reused ? '这里设置的是公共引用源的型号条件；引用位置的上级条件仍会进一步限制适用范围。当前正文中已有的源就地修改；切换到源文件后可用“返回编写位置”回到原文。' : '型号条件同时受 Topic 祖先约束。';
        $('footnoteEditError').textContent = '';
        $('footnoteEditDialog').showModal(); $('footnoteContent').focus();
      } catch (e) { error(e.message); }
    }
    function signature() {
      return JSON.stringify([A.api.token, scopePath || A.state.activePath, A.project?.expectedContent, Array.from(A.state.filesMap.values(), f => [f.path, f.current])]);
    }
    async function refresh(force = false) {
      if (!shown || A.state.mode === 'review') return;
      if (scopePath && !A.state.filesMap.has(scopePath) && !A.state.maps.some(map => map.path === scopePath)) { scopePath = A.state.activePath; A.notePresentation.setScope(scopePath); }
      const key = signature();
      if (!force && key === revision) { syncMode(); return; }
      revision = key;
      const token = ++generation, workspace = A.api.token;
      const activePath = scopePath || A.state.activePath;
      const active = A.state.filesMap.get(activePath) || A.state.maps.find(map => map.path === activePath);
      $('footnoteScope').textContent = activePath || '当前功能文档';
      error(active ? '正在读取注脚…' : '先从左侧打开一份功能手册。');
      try {
        if (!active) { notes = []; draw(); return; }
        const data = await A.notePresentation.ready();
        if (token !== generation || workspace !== A.api.token || activePath !== (scopePath || A.state.activePath)) return;
        notes = data.notes;
        const previous = $('footnoteModel').value;
        $('footnoteModel').replaceChildren(new Option('全部型号', ''));
        const models = new Set(([...(A.project?.value.models || []), ...data.models]).filter(root.DitaModelDiscovery.isModel));
        for (const model of [...models].sort()) $('footnoteModel').add(new Option(model, model));
        if (Array.from($('footnoteModel').options).some(option => option.value === previous)) $('footnoteModel').value = previous;
        draw();
        const common = notes.filter(note => note.common).length;
        error(common + ' 条已确认通用 · 待确认注脚会保留在交付中。独立规则只在导出中应用，可打开规则预览。');
      } catch (e) { if (token === generation) { notes = []; draw(); error('读取失败：' + e.message); } }
    }
    function scheduleRefresh() { clearTimeout(timer); if (shown) timer = setTimeout(() => refresh(), 180); }
    $('footnoteModel').addEventListener('change', draw);
    $('footnoteSearch').addEventListener('input', draw);
    $('footnoteUnassignedOnly').addEventListener('change', draw);
    $('footnoteRefresh').addEventListener('click', () => refresh(true));
    function restoreOrigin(target, applied = false) {
      const saved = target?.returnTarget;
      if (saved?.surface.isConnected && saved.workspace === A.api.token && saved.activePath === A.state.activePath && A.state.filesMap.get(saved.path) === saved.file && saved.surface.ditaSourceContent === saved.file.current && (saved.file.current === saved.current || applied && saved.file === target.file)) return A.authorSelection.restore(saved.surface, saved.bookmark);
      return false;
    }
    function cancelEdit() {
      const target = editing; editing = null; $('footnoteEditDialog').close();
      if (restoreOrigin(target)) return;
      if (target?.surface?.isConnected && target.workspace === A.api.token && target.activePath === A.state.activePath && target.file.current === target.note.source) A.authorSelection.restore(target.surface, target.beforeSelection);
    }
    $('footnoteCancel').addEventListener('click', cancelEdit);
    $('footnoteEditDialog').addEventListener('cancel', event => { event.preventDefault(); cancelEdit(); });
    $('footnoteEditDialog').addEventListener('close', () => { if (!$('footnoteEditDialog').open) editing = null; });
    $('footnoteEditForm').addEventListener('submit', event => {
      event.preventDefault();
      try {
        if (!editing || editing.workspace !== A.api.token || A.state.filesMap.get(editing.file.path) !== editing.file) throw new Error('工作区已变化，请重新打开注脚');
        const target = editing, { file, note } = target;
        if (editing.project !== A.project.expectedContent) throw new Error('型号清单已变化，请重新打开注脚');
        const next = core.updateFootnote(file.current, note, { content: $('footnoteContent').value, ...picker.read() });
        const surface = editing.surface;
        if (surface) {
          if (editing.activePath !== A.state.activePath || !editing.surface.isConnected) throw new Error('编写位置已变化，请重新打开注脚');
          A.applyAuthorEdit(file, next, surface, { selectionBefore: editing.beforeSelection, selectionAfter: A.authorSelection.afterNode(note.xmlPath) });
        } else A.setFileContent(file, next);
        editing = null;
        $('footnoteEditDialog').close();
        if (!restoreOrigin(target, true) && surface) A.authorNotes?.focusAfter(surface, note.xmlPath);
        A.setStatus('注脚已更新，可撤销 · 点击保存后写入工作区');
        refresh(true);
      } catch (e) { $('footnoteEditError').textContent = e.message; }
    });
    A.events.on('project:changed', () => { revision = ''; scheduleRefresh(); });
    A.events.on('footnotes:numbered', () => { revision = ''; scheduleRefresh(); });
    async function editAt(path, xmlPath) {
      try {
        const file = A.state.filesMap.get(path);
        let note = await A.notePresentation.resolve(path, xmlPath).catch(() => null);
        note ||= file && core.listFootnotes(file.current, path).find(note => note.xmlPath === xmlPath);
        if (!note) throw new Error('注脚位置已变化，请重新点击正文标记');
        if (note.referenced) { show(true); error('这条注脚引用公共内容，请在列表中选择“编辑引用源”。'); return; }
        await beginEdit(note);
      } catch (e) { A.setStatus(e.message, true); }
    }
    return { scheduleRefresh, syncMode, show, setVisible, setScope, editAt, hidePeek };
  }
  root.DitaFootnotes = { createPanel };
})(window);

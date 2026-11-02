'use strict';
(function (root) {
  function createController(A) {
    const get = id => document.getElementById(id), selection = A.authorSelection, core = root.DitaNoteReuseCore, dialog = get('reuseNoteDialog');
    let pending = null, definitions = [], generation = 0;
    function preview() {
      const chosen = definitions[Number(get('reuseNoteTarget').value)], box = get('reuseNotePreview'); box.replaceChildren();
      get('reuseNoteSubmit').disabled = !pending?.snapshot || !chosen || !get('reuseNoteTarget').options.length;
      if (!chosen || !get('reuseNoteTarget').options.length) { box.textContent = definitions.length ? '没有匹配的公共注脚。' : '当前手册及其公共资源中没有可引用的注脚定义。仅列出已有 ID 且不含复用引用的定义。'; return; }
      const conditions = [...(pending.conditions || []), ...chosen.conditions], models = pending.snapshot.project.models;
      const scope = chosen.common ? '公共源已确认通用' : chosen.conditions.length ? '公共源条件：' + chosen.conditions.join(' ∩ ') : '公共源适用范围待确认';
      const effective = models.filter(model => root.DitaManualCore.matches(conditions, model));
      const applicability = conditions.some(value => /[()]/.test(value)) ? '包含分组型号条件，请在交付前检查。' : conditions.length ? models.length ? effective.length ? '此处适用：' + effective.join('、') : '当前位置与公共源的型号条件没有交集。' : '此处需同时满足：' + conditions.join(' ∩ ') : '当前位置无额外型号约束。';
      for (const text of [chosen.text || '（空注脚）', '来源：' + chosen.path + '#' + chosen.fragment, scope, applicability, '插入引用，不复制或修改公共源；后续内容修改会影响使用同一来源的位置。']) { const p = document.createElement('p'); p.textContent = text; box.append(p); }
    }
    function draw() {
      const query = get('reuseNoteFilter').value.trim().toLowerCase(), picker = get('reuseNoteTarget'), previous = picker.value; picker.replaceChildren();
      definitions.forEach((note, index) => { if (!query || [note.text, note.path, note.fragment, ...note.conditions].join(' ').toLowerCase().includes(query)) { const option = document.createElement('option'); option.value = String(index); option.textContent = (note.text || '（空注脚）').slice(0, 90) + ' · ' + note.path; picker.append(option); } });
      if ([...picker.options].some(option => option.value === previous)) picker.value = previous;
      else if (picker.options.length) picker.selectedIndex = 0;
      preview();
    }
    async function show() {
      if (dialog.open) return;
      let ticket;
      try {
        const target = selection.capture(), block = selection.validateRange(target.range, target.surface, { body: true }), at = target.range.endContainer.nodeType === 1 ? target.range.endContainer : target.range.endContainer.parentElement;
        if (block.matches('pre,h2,h3,h4') || at.closest('[data-dita-source="xref"]')) throw new Error('请在普通正文、列表或表格文字中引用注脚');
        const conditions = [];
        for (let node = at; node && target.surface.contains(node); node = node.parentElement) { if (node.hasAttribute('xml:base')) throw new Error('此位置使用 xml:base，请先使用源码维护引用'); if (node.getAttribute('product')?.trim()) conditions.unshift(node.getAttribute('product').trim()); }
        ticket = ++generation; pending = { target, conditions, snapshot: null }; definitions = [];
        get('reuseNoteFilter').value = ''; get('reuseNoteError').textContent = '正在读取公共注脚…'; get('reuseNoteTarget').replaceChildren(); get('reuseNotePreview').replaceChildren(); get('reuseNoteSubmit').disabled = true;
        dialog.showModal(); get('reuseNoteFilter').focus();
        const snapshot = await A.manual.capture(A.notePresentation.scope || target.path, { resources: true });
        if (ticket !== generation || !pending || !dialog.open) return;
        selection.check(target); if (!A.manual.current(snapshot)) throw new Error('手册已变化，请重新打开注脚选择器');
        pending.snapshot = snapshot; definitions = core.list(snapshot.files); get('reuseNoteError').textContent = ''; draw();
      } catch (error) { if (ticket && ticket !== generation) return; if (dialog.open) get('reuseNoteError').textContent = error.message; else A.setStatus(error.message, true); }
    }
    function cancel() { const target = pending?.target; pending = null; generation++; dialog.close(); if (target) try { selection.restoreTarget(target); } catch { /* A changed buffer keeps ownership. */ } }
    get('reuseNoteCancel').addEventListener('click', cancel); dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    dialog.addEventListener('close', () => { if (!dialog.open) { pending = null; generation++; } });
    get('reuseNoteFilter').addEventListener('input', draw); get('reuseNoteTarget').addEventListener('change', preview);
    get('reuseNoteForm').addEventListener('submit', event => {
      event.preventDefault();
      try {
        const chosen = definitions[Number(get('reuseNoteTarget').value)], target = pending?.target, snapshot = pending?.snapshot;
        if (!target || !snapshot || !chosen || !get('reuseNoteTarget').options.length) throw new Error('请先选择一个公共注脚');
        selection.check(target); if (!A.manual.current(snapshot)) throw new Error('手册或公共源已变化，请关闭后重新选择');
        const marker = document.createElement('sup'), href = core.href(target.path, chosen);
        marker.className = 'fn-ref'; marker.dataset.ditaSource = 'xref'; marker.dataset.ditaOriginal = '<xref type="fn" href="' + href.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"/>'; marker.setAttribute('type', 'fn'); marker.setAttribute('href', href); marker.textContent = '[?]';
        const { copy, range } = selection.clone(target); range.collapse(false); range.insertNode(marker.cloneNode(true));
        const next = A.ditaCore.updateCurrentFromVisual(null, { visualEditor: copy }, target.current), files = new Map(snapshot.files);
        files.set(target.path, { ...files.get(target.path), current: next }); A.manual.listNotes({ ...snapshot, files });
        selection.insertInline(target, marker, { collapse: true }); pending = null; generation++; dialog.close(); A.setStatus('已引用公共注脚，可撤销；公共源保持不变，保存后写入工作区');
      } catch (error) { get('reuseNoteError').textContent = error.message; }
    });
    A.events.on('workspace:willChange', () => { pending = null; generation++; dialog.close(); });
    return { show };
  }
  root.DitaNoteReuse = { createController };
})(window);

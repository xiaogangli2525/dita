'use strict';
(function (root) {
  function createController(A) {
    const get = id => document.getElementById(id), core = root.DitaFootnotesCore;
    let remembered = null, pending = null, composing = false, opening = false;
    function surfaceOf(element) { return element?.closest('.map-topic-surface') || A.dom.visualEditor; }
    function filePath(surface) { return surface.dataset.mapTopicPath || A.state.activePath; }
    function syncMode() {
      const writing = A.state.mode === 'visual' && Boolean(A.state.activePath);
      get('authoringToolbar').hidden = !writing;
      for (const id of ['newFootnoteButton', 'panelNewFootnoteButton']) get(id).disabled = !writing;
    }
    function remember() {
      if (A.state.mode !== 'visual' || composing || get('newFootnoteDialog').open) return;
      const selection = root.getSelection(); if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!A.dom.visualEditor.contains(range.endContainer)) return;
      remembered = null;
      const element = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
      const surface = surfaceOf(element), startElement = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const body = element?.closest('[data-dita-body]');
      const block = element?.closest('p,td,th,li,[data-dita-source="entry"],[data-dita-source="cmd"],[data-dita-source="dd"]');
      const forbidden = element?.closest('pre,h2,h3,h4,[data-dita-source="fn"],[data-dita-source="xref"],[data-dita-source="codeblock"],[data-dita-source="foreign"]');
      if (!body || !block || !body.contains(block) || forbidden || !A.dom.visualEditor.contains(range.startContainer) || surfaceOf(startElement) !== surface) {
        get('authoringHint').textContent = '请在正文段落、列表或表格文字后放置光标'; return;
      }
      const file = A.state.filesMap.get(filePath(surface)); if (!file || /\.ditamap$/i.test(file.path)) return;
      const saved = range.cloneRange(); saved.collapse(false);
      remembered = { range: saved, surface, file, path: file.path, workspace: A.api.token, activePath: A.state.activePath };
      get('authoringHint').textContent = (range.collapsed ? '插入到当前光标处' : '插入到所选文字之后') + ' · ' + file.path.split('/').pop();
    }
    function connected(target) {
      return target && target.workspace === A.api.token && target.activePath === A.state.activePath &&
        A.state.filesMap.get(target.path) === target.file && target.surface.isConnected && target.surface.contains(target.range.endContainer) && A.state.mode === 'visual';
    }
    function cloneWithPoint(target) {
      const indexes = []; let node = target.range.endContainer;
      while (node !== target.surface) { indexes.unshift(Array.from(node.parentNode.childNodes).indexOf(node)); node = node.parentNode; }
      const copy = target.surface.cloneNode(true);
      function metadata(from, to) {
        if (from.ditaSourcePath !== undefined) to.ditaSourcePath = from.ditaSourcePath;
        Array.from(from.childNodes).forEach((child, index) => metadata(child, to.childNodes[index]));
      }
      metadata(target.surface, copy);
      const point = indexes.reduce((parent, index) => parent.childNodes[index], copy), range = document.createRange();
      range.setStart(point, target.range.endOffset); range.collapse(true);
      return { copy, range };
    }
    function scopeChanged() {
      const models = get('newFootnoteForm').elements.scope.value === 'models';
      get('newFootnoteModelPicker').hidden = !models;
    }
    async function show() {
      if (opening || get('newFootnoteDialog').open) return;
      opening = true;
      try {
        remember();
        const target = remembered;
        if (composing || !connected(target)) throw new Error('请先在编写模式的正文文字后放置光标，再点击“新增注脚”');
        const current = target.file.current, { copy, range } = cloneWithPoint(target);
        // getRandomValues also works in HTTP preview/proxy contexts, where
        // randomUUID is unavailable. The temporary ID is never persisted.
        const id = 'note-insert-' + Array.from(root.crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
        const marker = document.createElement('sup');
        marker.setAttribute('data-dita-source', 'fn'); marker.setAttribute('data-dita-original', '<fn id="' + id + '"/>');
        range.insertNode(marker);
        // Work on a detached copy until all content/scope checks pass. Opening
        // or cancelling this dialog must never mutate the live DOM or XML.
        const template = A.ditaCore.updateCurrentFromVisual(null, { visualEditor: copy }, current);
        const note = core.listFootnotes(template, target.path).find(note => root.DitaXmlSource.inspectSource(note.before).attrs.id === id);
        if (!note) throw new Error('无法确定插入位置，请重新点击正文');
        await A.project.ready();
        if (!connected(target) || target.file.current !== current) throw new Error('正文已变化，请重新选择插入位置');
        if (A.project.error) throw new Error(A.project.error);
        pending = { ...target, current, template, id, project: A.project.expectedContent };
        get('newFootnoteForm').reset(); get('newFootnoteError').textContent = '';
        get('newFootnoteLocation').textContent = target.path + ' · ' + (note.context || '当前正文位置').slice(0, 100);
        get('newFootnoteCommon').disabled = note.conditions.length > 0;
        get('newFootnoteInheritance').textContent = note.conditions.length ? '当前位置受型号条件约束：' + note.conditions.join(' ∩ ') + '。新增注脚仍受这些条件限制。' : '';
        const models = A.project.value.models.length ? A.project.value.models : [...new Set(Array.from(A.state.filesMap.values()).flatMap(file => {
          try { return core.listFootnotes(file.current).flatMap(note => note.products); }
          catch { return []; } // An unrelated incomplete Source buffer is not a model registry.
        }))].sort();
        const list = get('newFootnoteModels'); list.replaceChildren();
        for (const model of models) {
          const label = document.createElement('label'), input = document.createElement('input');
          input.type = 'checkbox'; input.value = model; input.checked = model === get('footnoteModel').value;
          label.append(input, document.createTextNode(model)); list.append(label);
        }
        get('newFootnoteCustomModels').hidden = A.project.value.models.length > 0;
        scopeChanged(); get('newFootnoteDialog').showModal(); get('newFootnoteContent').focus();
      } catch (error) { A.setStatus(error.message, true); A.toast?.(error.message, 'error'); }
      finally { opening = false; }
    }
    function restore(target, marker) {
      if (!target?.surface.isConnected || target.activePath !== A.state.activePath || A.state.mode !== 'visual') return;
      target.surface.focus({ preventScroll: true });
      const range = marker ? document.createRange() : target.range;
      if (marker) { range.setStartAfter(marker); range.collapse(true); }
      if (!target.surface.contains(range.endContainer)) return;
      const selection = root.getSelection(); selection.removeAllRanges(); selection.addRange(range); remember();
    }
    get('newFootnoteForm').addEventListener('submit', event => {
      event.preventDefault();
      try {
        const target = pending;
        if (!connected(target) || target.file.current !== target.current || A.project.expectedContent !== target.project) throw new Error('正文或型号清单已变化，请关闭后重新插入');
        const scope = get('newFootnoteForm').elements.scope.value;
        const selected = Array.from(get('newFootnoteModels').querySelectorAll('input:checked'), input => input.value);
        if (!get('newFootnoteCustomModels').hidden) selected.push(...get('newFootnoteProductInput').value.trim().split(/\s+/).filter(Boolean));
        const products = scope === 'models' ? [...new Set(selected)] : [];
        if (scope === 'models' && !products.length) throw new Error('请选择至少一个型号，或选择通用／待确认');
        A.project.check(products);
        const result = core.completeInsertion(target.template, target.id, { content: get('newFootnoteContent').value, products: products.join(' '), common: scope === 'common' });
        A.applyAuthorEdit(target.file, result.content, target.surface);
        const marker = Array.from(target.surface.querySelectorAll('[data-dita-source="fn"]')).find(node => node.ditaSourcePath === result.note.xmlPath);
        pending = null; get('newFootnoteDialog').close();
        if (root.matchMedia('(max-width: 1050px)').matches) { A.dom.inspector.classList.remove('drawer-open'); get('inspectorToggleButton').setAttribute('aria-expanded', 'false'); }
        restore(target, marker);
        marker?.classList.add('fn-just-inserted'); marker?.scrollIntoView({ block: 'nearest' });
        A.setStatus('注脚已插入，可撤销 · 保存后写入工作区'); A.toast?.('已新增注脚，尚未保存', 'success');
      } catch (error) { get('newFootnoteError').textContent = error.message; }
    });
    get('newFootnoteForm').addEventListener('change', scopeChanged);
    function cancel() {
      const target = pending; pending = null; get('newFootnoteDialog').close();
      if (target && target.file.current === target.current && connected(target)) restore(target);
    }
    get('newFootnoteCancel').addEventListener('click', cancel);
    get('newFootnoteDialog').addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    get('newFootnoteDialog').addEventListener('close', () => { if (get('newFootnoteDialog').open) return; const target = pending; pending = null; if (target && target.file.current === target.current && connected(target)) restore(target); });
    for (const id of ['newFootnoteButton', 'panelNewFootnoteButton']) {
      get(id).addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault(); });
      get(id).addEventListener('click', show);
    }
    for (const id of ['authorUndoButton', 'authorRedoButton']) get(id).addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault(); });
    for (const id of ['newFootnoteForm', 'footnoteEditForm']) get(id).addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault(); event.currentTarget.requestSubmit();
      }
    });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'n' && !event.isComposing && event.keyCode !== 229 && A.dom.visualEditor.contains(event.target)) {
        event.preventDefault(); show();
      }
    });
    document.addEventListener('selectionchange', remember);
    A.dom.visualEditor.addEventListener('compositionstart', () => { composing = true; });
    A.dom.visualEditor.addEventListener('compositionend', () => { composing = false; remember(); });
    function editMarker(event) {
      const marker = event.target.closest?.('[data-dita-source="fn"]');
      if (!marker || A.state.mode !== 'visual' || !A.dom.visualEditor.contains(marker)) return;
      event.preventDefault(); A.footnotes.editAt(filePath(surfaceOf(marker)), marker.ditaSourcePath);
    }
    A.dom.visualEditor.addEventListener('dblclick', editMarker);
    A.dom.visualEditor.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.matches?.('[data-dita-source="fn"]')) editMarker(event); });
    A.events.on('workspace:willChange', () => { remembered = null; get('newFootnoteDialog').close(); syncMode(); });
    A.events.on('file:opened', syncMode); A.events.on('file:closed', syncMode);
    syncMode();
    return { show, syncMode, focusAfter(surface, xmlPath) {
      const marker = Array.from(surface.querySelectorAll('[data-dita-source="fn"]')).find(node => node.ditaSourcePath === xmlPath);
      if (marker) restore({ surface, activePath: A.state.activePath }, marker);
    } };
  }
  root.DitaAuthorNotes = { createController };
})(window);

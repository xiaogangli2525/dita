'use strict';
(function (root) {
  function createController(A) {
    const get = id => document.getElementById(id), core = root.DitaFootnotesCore;
    const selection = A.authorSelection, picker = root.DitaNoteScope.createPicker(A, 'newFootnote', 'newFootnoteForm', 'newFootnoteProductInput');
    let pending = null, opening = false;
    const surfaceOf = element => selection.surfaceOf(element);
    const filePath = surface => surface.dataset.mapTopicPath || A.state.activePath;
    function syncMode() {
      const writing = A.state.mode === 'visual' && Boolean(A.state.activePath);
      get('authoringToolbar').hidden = !writing;
      for (const id of ['newFootnoteButton', 'panelNewFootnoteButton']) get(id).disabled = !writing;
    }
    function connected(target) { try { selection.check(target); return true; } catch { return false; } }
    function remember() {
      if (get('newFootnoteDialog').open) return;
      try { const target = selection.capture(); get('authoringHint').textContent = (target.range.collapsed ? '插入到当前光标处' : '插入到所选文字之后') + ' · ' + target.path.split('/').pop(); }
      catch { get('authoringHint').textContent = '在正文放好光标，新增注脚'; }
    }
    async function show() {
      if (opening || get('newFootnoteDialog').open) return;
      opening = true;
      try {
        const target = selection.capture(), current = target.current, { copy, range } = selection.clone(target);
        range.collapse(false);
        const block = selection.validateRange(range, copy, { body: true });
        const element = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
        if (block.matches('pre,h2,h3,h4') || element.closest('[data-dita-source="xref"]')) throw new Error('请在普通正文、列表或表格文字后放置光标');
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
        const preferred = get('footnoteModel').value;
        picker.draw({ ...note, products: preferred ? [preferred] : [] }, 'models');
        get('newFootnoteDialog').showModal(); get('newFootnoteContent').focus();
      } catch (error) { A.setStatus(error.message, true); A.toast?.(error.message, 'error'); }
      finally { opening = false; }
    }
    function restore(target, marker) {
      if (!target?.surface.isConnected || target.activePath !== A.state.activePath || A.state.mode !== 'visual') return;
      if (marker) selection.restore(target.surface, selection.afterNode(marker.ditaSourcePath));
      else if (connected(target)) selection.restoreTarget(target);
      remember();
    }
    get('newFootnoteForm').addEventListener('submit', event => {
      event.preventDefault();
      try {
        const target = pending;
        if (!connected(target) || target.file.current !== target.current || A.project.expectedContent !== target.project) throw new Error('正文或型号清单已变化，请关闭后重新插入');
        const result = core.completeInsertion(target.template, target.id, { content: get('newFootnoteContent').value, ...picker.read() });
        A.applyAuthorEdit(target.file, result.content, target.surface, { selectionBefore: selection.bookmark(target.surface, target.range), selectionAfter: selection.afterNode(result.note.xmlPath) });
        const marker = Array.from(target.surface.querySelectorAll('[data-dita-source="fn"]')).find(node => node.ditaSourcePath === result.note.xmlPath);
        pending = null; get('newFootnoteDialog').close();
        if (root.matchMedia('(max-width: 1050px)').matches) { A.dom.inspector.classList.remove('drawer-open'); get('inspectorToggleButton').setAttribute('aria-expanded', 'false'); }
        restore(target, marker);
        marker?.classList.add('fn-just-inserted'); marker?.scrollIntoView({ block: 'nearest' });
        A.setStatus('注脚已插入，可撤销 · 保存后写入工作区'); A.toast?.('已新增注脚，尚未保存', 'success');
      } catch (error) { get('newFootnoteError').textContent = error.message; }
    });
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
    function editMarker(event) {
      const marker = event.target.closest?.('[data-dita-source="fn"]');
      if (!marker || A.state.mode !== 'visual' || !A.dom.visualEditor.contains(marker)) return;
      event.preventDefault(); A.footnotes.editAt(filePath(surfaceOf(marker)), marker.ditaSourcePath);
    }
    A.dom.visualEditor.addEventListener('dblclick', editMarker);
    A.dom.visualEditor.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.matches?.('[data-dita-source="fn"]')) editMarker(event); });
    A.events.on('workspace:willChange', () => { pending = null; get('newFootnoteDialog').close(); syncMode(); });
    A.events.on('file:opened', syncMode); A.events.on('file:closed', syncMode);
    syncMode();
    return { show, syncMode, focusAfter(surface, xmlPath) {
      const marker = Array.from(surface.querySelectorAll('[data-dita-source="fn"]')).find(node => node.ditaSourcePath === xmlPath);
      if (marker) restore({ surface, activePath: A.state.activePath }, marker);
    } };
  }
  root.DitaAuthorNotes = { createController };
})(window);

'use strict';
(function (root) {
  function createController(A, { resolve, capture, syncVisual, syncSource, undo, redo }) {
    const store = root.DitaDocumentStore;
    let pending = null, composition = null, ending = null, timer, serial = 0;
    const cursor = saved => saved ? JSON.stringify(saved.mode === 'editor' ? [saved.mode, saved.path, saved.start, saved.end] : [saved.mode, saved.path, saved.bookmark?.start, saved.bookmark?.end]) : null;
    function breakAll() { for (const file of A.state.filesMap.values()) store.breakHistoryGroup(file); pending = null; }
    function before(event) {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); breakAll(); (event.inputType === 'historyUndo' ? undo : redo)(); return; }
      const file = resolve(event.target); if (!file) return;
      const frame = composition || ending && /Composition/.test(event.inputType) && ending;
      pending = { file, before: file.current, selection: capture(file), type: event.inputType, composition: frame?.id };
    }
    function take(file, event) {
      const frame = pending?.file === file && pending.before === file.current ? pending : null; pending = null;
      const after = capture(file), compose = composition || ending;
      const kind = frame?.composition || compose?.file === file && compose.id;
      const eligible = frame && ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(frame.type);
      const group = kind ? { key: 'composition:' + kind, time: Date.now(), composition: true } : eligible ? { key: A.state.mode + ':' + file.path + ':' + frame.type, time: Date.now(), beforeCursor: cursor(frame.selection), afterCursor: cursor(after) } : null;
      return { group, historyMeta: { selectionBefore: (kind ? compose?.selection : frame?.selection) || after, selectionAfter: after } };
    }
    function start(event) {
      breakAll(); clearTimeout(timer); ending = null;
      const file = resolve(event.target); if (!file) return;
      composition = { id: ++serial, file, selection: capture(file), target: event.target };
    }
    function end(event) {
      ending = composition; composition = null;
      if (!ending) return;
      // Some IMEs deliver the final input immediately after compositionend.
      // Keep that tail in this group, then close it before ordinary typing.
      if (event.target === A.dom.editor) syncSource(event); else syncVisual(event);
      clearTimeout(timer); timer = setTimeout(() => { if (ending) store.breakHistoryGroup(ending.file); ending = null; pending = null; }, 0);
    }
    for (const element of [A.dom.editor, A.dom.visualEditor]) {
      element.addEventListener?.('beforeinput', before);
      element.addEventListener?.('compositionstart', start);
      element.addEventListener?.('compositionend', end);
      element.addEventListener?.('focusout', () => { if (!composition) breakAll(); });
      element.addEventListener?.('pointerdown', breakAll);
      element.addEventListener?.('keydown', event => { if (!event.isComposing && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Escape'].includes(event.key)) breakAll(); });
    }
    function reset() { clearTimeout(timer); composition = ending = null; breakAll(); }
    A.events.on('workspace:willChange', reset); A.events.on('file:opened', reset);
    return { take, breakAll, reset };
  }
  root.DitaInputHistory = { createController };
})(window);

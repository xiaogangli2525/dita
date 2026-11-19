// @ts-check
'use strict';
(function (root) {
  /** @typedef {import('../data-contracts').DocumentState} DocumentState */
  /** @typedef {{mode: 'editor', path: string, start: number, end: number} |
   * {mode: 'visual', path: string, bookmark: {start: object, end: object}}} Selection */
  /** @typedef {{file: DocumentState, id: number, before: string, selection: Selection | null}} Composition */
  /**
   * @param {{state: Pick<import('../data-contracts').WorkspaceState, 'mode' | 'filesMap'>,
   * dom: {editor: HTMLTextAreaElement, visualEditor: HTMLElement},
   * events: {on(name: string, handler: () => void): unknown}}} A
   * @param {{resolve(target: EventTarget | null): DocumentState | null | undefined,
   * capture(file: DocumentState): Selection | null,
   * syncVisual(event: CompositionEvent): void, syncSource(event: CompositionEvent): void,
   * restoreCancelled(file: DocumentState, selection: Selection | null, event: CompositionEvent): void,
   * undo(): void, redo(): void}} callbacks
   */
  function createController(A, { resolve, capture, syncVisual, syncSource, restoreCancelled, undo, redo }) {
    const store = root.DitaDocumentStore;
    /** @type {{file: DocumentState, before: string, selection: Selection | null, type: string, composition?: number} | null} */
    let pending = null;
    /** @type {Composition | null} */
    let composition = null;
    /** @type {Composition | null} */
    let ending = null;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let serial = 0;
    /** @param {Selection | null} saved */
    const cursor = saved => saved ? JSON.stringify(saved.mode === 'editor' ? [saved.mode, saved.path, saved.start, saved.end] : [saved.mode, saved.path, saved.bookmark.start, saved.bookmark.end]) : undefined;
    function breakAll() { for (const file of A.state.filesMap.values()) store.breakHistoryGroup(file); pending = null; }
    /** @param {InputEvent} event */
    function before(event) {
      if (event.defaultPrevented) return;
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); breakAll(); (event.inputType === 'historyUndo' ? undo : redo)(); return; }
      const file = resolve(event.target); if (!file) return;
      const frame = composition || (/Composition/.test(event.inputType) ? ending : null);
      pending = { file, before: file.current, selection: capture(file), type: event.inputType, composition: frame?.id };
    }
    /** @param {DocumentState} file
     * @returns {{group?: import('../data-contracts').HistoryGroup, historyMeta: import('../data-contracts').HistoryMeta}} */
    function take(file) {
      const frame = pending?.file === file && pending.before === file.current ? pending : null; pending = null;
      const after = capture(file), compose = composition || ending;
      const kind = frame?.composition || compose?.file === file && compose.id;
      const eligible = frame && ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(frame.type);
      const group = kind ? { key: 'composition:' + kind, time: Date.now(), composition: true } : eligible ? { key: A.state.mode + ':' + file.path + ':' + frame.type, time: Date.now(), beforeCursor: cursor(frame.selection), afterCursor: cursor(after) } : undefined;
      return { group, historyMeta: { selectionBefore: (kind ? compose?.selection : frame?.selection) || after, selectionAfter: after } };
    }
    /** @param {CompositionEvent} event */
    function start(event) {
      breakAll(); clearTimeout(timer); ending = null;
      const file = resolve(event.target); if (!file) return;
      composition = { id: ++serial, file, before: file.current, selection: capture(file) };
    }
    /** @param {CompositionEvent} event */
    function end(event) {
      ending = composition; composition = null;
      if (!ending) return;
      if (!event.data) {
        const { file, before, selection } = ending;
        ending = pending = null;
        // Chromium can remove the original selection when a candidate is cancelled.
        if (resolve(event.target) === file && file.current === before) restoreCancelled(file, selection, event);
        return;
      }
      // Some IMEs deliver the final input immediately after compositionend.
      // Keep that tail in this group, then close it before ordinary typing.
      if (event.target === A.dom.editor) syncSource(event);
      else syncVisual(event);
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
    // Native browsers can emit multiple input events for a single candidate.
    // The committed DOM is read at compositionend, never during those updates.
    /** @param {Event} [event] */
    function pendingComposition(event) {
      return event?.type === 'input' && (event instanceof InputEvent && event.isComposing || Boolean(composition));
    }
    return { take, breakAll, reset, pendingComposition };
  }
  const api = { createController };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DitaInputHistory = api;
})(window);

'use strict';
(function (root) {
  const documentStore = typeof module !== 'undefined' ? require('./document-store') : root.DitaDocumentStore;
  const review = typeof module !== 'undefined' ? require('./review') : root.DitaReview;
  const mapAuthor = typeof module !== 'undefined' ? require('./map-author-controller') : root.DitaMapAuthorController;
  const loader = typeof module !== 'undefined' ? require('./document-loader') : root.DitaDocumentLoader;

  // Coordinates Source/Author/Map surfaces around one document history. View
  // callbacks are injected; state and source rules remain in their own modules.
  function createEditorController(A, views) {
    const { state, session, dom, ditaCore, setStatus, validateXml, events, api: workspaceClient } = A;
    const { documentLabel = file => file.path, renderTabs, renderOutline, renderInspector, updateTree,
      refreshChrome: updateDocumentChrome, beforeModeChange, modeChanged } = views;
    let inputHistory = null;
    const documents = loader.createDocumentLoader({ state, session, api: workspaceClient, events });
    function surfaceFor(file) {
      if (state.activePath === file.path && /\.ditamap$/i.test(file.path)) return dom.visualEditor.querySelector('[data-map-title]');
      return state.activePath === file.path ? dom.visualEditor :
        Array.from(dom.visualEditor.querySelectorAll('.map-topic-surface')).find(node => node.dataset.mapTopicPath === file.path);
    }
    function captureSelection(file) {
      if (state.mode === 'editor' && state.activePath === file.path) return { mode: 'editor', path: file.path, start: dom.editor.selectionStart, end: dom.editor.selectionEnd, direction: dom.editor.selectionDirection, scrollTop: dom.editor.scrollTop, scrollLeft: dom.editor.scrollLeft };
      const surface = state.mode === 'visual' && surfaceFor(file), bookmark = surface && A.authorSelection?.bookmark(surface);
      return bookmark ? { mode: 'visual', path: file.path, bookmark } : null;
    }
    function restoreSelection(file, saved) {
      if (!saved || saved.mode !== state.mode || saved.path !== file.path) return;
      if (saved.mode === 'editor') { dom.editor.focus(); dom.editor.setSelectionRange(saved.start, saved.end, saved.direction); dom.editor.scrollTop = saved.scrollTop; dom.editor.scrollLeft = saved.scrollLeft; }
      else { const surface = surfaceFor(file); if (surface) A.authorSelection?.restore(surface, saved.bookmark); }
    }
    function ensureHistory(file) {
      return documentStore.historyOf(file);
    }

    function historyTargetFile() {
      const active = state.filesMap.get(state.activePath);
      if (!active) return null;
      const candidate = state.filesMap.get(state.historyTargetPath);
      if (candidate && candidate.path !== active.path && /\.ditamap$/i.test(active.path) && state.mapAuthorPaths?.has(candidate.path)) return candidate;
      return active;
    }

    function updateHistoryButtons() {
      const file = historyTargetFile();
      const history = file ? ensureHistory(file) : null;
      if (dom.undoButton) dom.undoButton.disabled = !history || history.undo.length === 0;
      if (dom.redoButton) dom.redoButton.disabled = !history || history.redo.length === 0;
      if (dom.authorUndoButton) dom.authorUndoButton.disabled = !history || history.undo.length === 0;
      if (dom.authorRedoButton) dom.authorRedoButton.disabled = !history || history.redo.length === 0;
    }

    function refreshFileViews(file, { updateEditor = true } = {}) {
      if (file) mapController.scheduleRefresh(file);
      if (!file) return;
      if (state.activePath !== file.path) {
        const active = state.filesMap.get(state.activePath);
        if (/\.ditamap$/i.test(active?.path || '') && ['visual', 'preview', 'review'].includes(state.mode) && state.mapAuthorPaths?.has(file.path)) {
          const surface = Array.from(dom.visualEditor.querySelectorAll('.map-topic-surface')).find(node => node.dataset.mapTopicPath === file.path);
          if (surface) renderAuthorSurface(file, surface);
          else updateVisual(active);
          if (state.mode === 'review') renderMapReview(active);
        }
        return;
      }
      if (updateEditor) dom.editor.value = file.current;
      if (state.mode === 'visual' || state.mode === 'preview' || state.mode === 'review') {
        state.suppressVisualInput = true;
        updateVisual(file, state.mode === 'review');
        state.suppressVisualInput = false;
      }
      if (state.mode === 'review') {
        if (/\.ditamap$/i.test(file.path)) renderMapReview(file);
        else renderDiff(file, false);
      }
      renderTabs();
      updateHistoryButtons();
    }

    function refreshHistoryTargetView(file, entry) {
      if (!file) return;
      if (state.mode === 'visual' && entry?.mapTitle && mapController.refreshTitle(file)) return;
      // Keep a long Map and its other Topics in place during Author undo/redo.
      const activeFile = state.filesMap.get(state.activePath);
      if (state.mode === 'visual') {
        const surface = activeFile === file && !/\.ditamap$/i.test(file.path) ? dom.visualEditor :
          Array.from(dom.visualEditor.querySelectorAll('.map-topic-surface')).find(node => node.dataset.mapTopicPath === file.path);
        if (surface) { renderAuthorSurface(file, surface); return; }
      }
      refreshFileViews(file);
    }

    function setFileContent(file, content, { record = true, updateEditor = true, historyMeta, group, render = true } = {}) {
      if (!file) return false;
      if (!documentStore.editDocument(file, content, { record, historyMeta, group })) return false;
      if (file.path === state.activePath || (/\.ditamap$/i.test(state.activePath) && state.mapAuthorPaths?.has(file.path))) {
        session.setHistoryTarget(file.path);
      }
      if (render) refreshFileViews(file, { updateEditor });
      events.emit('document:changed', file);
      return true;
    }

    function undoFile() {
      const file = historyTargetFile();
      if (!file) return;
      const entry = documentStore.travelHistory(file, 'undo');
      if (!entry) return;
      if (entry.reviewDecisionsBefore) state.reviewDecisions = new Map(entry.reviewDecisionsBefore);
      refreshHistoryTargetView(file, entry); restoreSelection(file, entry.selectionBefore); events.emit('document:changed', file);
      setStatus('已撤销');
    }

    function redoFile() {
      const file = historyTargetFile();
      if (!file) return;
      const entry = documentStore.travelHistory(file, 'redo');
      if (!entry) return;
      if (entry.reviewDecisionsAfter) state.reviewDecisions = new Map(entry.reviewDecisionsAfter);
      refreshHistoryTargetView(file, entry); restoreSelection(file, entry.selectionAfter); events.emit('document:changed', file);
      setStatus('已重做');
    }

    function updateActivePanes() {
      const file = state.filesMap.get(state.activePath);
      dom.editor.value = file?.current || '';
      dom.editor.disabled = !file;
      dom.visualEditor.contentEditable = file && state.mode === 'visual' && !/\.ditamap$/i.test(file.path) ? 'true' : 'false';
      state.suppressVisualInput = true;
      updateVisual(file);
      state.suppressVisualInput = false;
      if (state.mode === 'review') {
        if (file && /\.ditamap$/i.test(file.path)) renderMapReview(file);
        else renderDiff(file);
      }
      renderOutline();
      renderInspector(null);
      updateHistoryButtons();
      updateDocumentChrome();
    }


    function setMode(mode) {
      inputHistory?.breakAll();
      beforeModeChange?.();
      mapController.invalidate();
      session.setMode(mode);
      dom.editorPane.classList.toggle('active', mode === 'editor');
      // Review keeps the Author surface in the main column. The review pane is a
      // docked right sidebar, matching Oxygen Author's reading flow.
      dom.visualPane.classList.toggle('active', mode === 'visual' || mode === 'preview' || mode === 'review');
      // Reading reuses the Author rendering with all editing disabled.
      dom.reviewPane.classList.toggle('active', mode === 'review');
      dom.visualEditor?.classList.toggle('preview-editable', mode === 'preview');
      dom.htmlPreviewPane?.classList.remove('active');
      dom.mdPreviewPane?.classList.remove('active');
      for (const [button, buttonMode] of [[dom.sourceButton, 'editor'], [dom.visualButton, 'visual'], [dom.previewButton, 'preview']]) {
        button?.classList.toggle('active', mode === buttonMode);
      }
      dom.reviewButton?.classList.toggle('active', mode === 'review');
      for (const button of [dom.insertElementButton, dom.formatButton]) button.disabled = mode === 'preview' || mode === 'review';
      dom.contextToolbar.hidden = true;
      const file = state.filesMap.get(state.activePath);
      if (file && mode === 'editor') dom.editor.value = file.current;
      if (dom.visualEditor && (mode === 'review' || mode === 'preview')) {
        dom.visualEditor.contentEditable = 'false';
        for (const surface of dom.visualEditor.querySelectorAll('[contenteditable]')) surface.contentEditable = 'false';
      } else if (dom.visualEditor && mode === 'visual' && file && !/\.ditamap$/i.test(file.path)) {
        dom.visualEditor.contentEditable = 'true';
      }
      if (file && (mode === 'visual' || mode === 'preview' || mode === 'review')) {
        state.suppressVisualInput = true;
        updateVisual(file);
        state.suppressVisualInput = false;
      }
      if (file && mode === 'review') {
        if (/\.ditamap$/i.test(file.path)) renderMapReview(file);
        else renderDiff(file, false);
      }
      if (!file && mode === 'review') renderDiff(null);
      if (dom.contextToolbar) dom.contextToolbar.hidden = mode !== 'visual' || !state.selectedVisualElement;
      if (mode !== 'visual') renderInspector(null);
      if (mode === 'visual' || mode === 'preview') renderOutline();
      modeChanged?.();
    }


    const visualCore = ditaCore.createVisualApi(state, dom);

    async function ensureMapAuthorFile(path) {
      return documents.load(path);
    }

    function updateVisual(file, reviewMode = state.mode === 'review') {
      mapController.invalidate();
      if (state.selectedVisualElement?.classList) state.selectedVisualElement.classList.remove('author-selected');
      state.selectedVisualElement = null;
      if (!file) {
        dom.visualEditor.classList.remove('map-author-editor');
        dom.visualEditor.replaceChildren(document.createTextNode('\u672A\u6253\u5F00\u6587\u4EF6'));
        renderInspector(null);
        return;
      }
      if (/\.ditamap$/i.test(file.path)) {
        void mapController.render(file);
        return;
      }
      try {
        dom.visualEditor.classList.remove('map-author-editor');
        visualCore.updateVisualFromXml(file.current, reviewMode);
        events.emit('author:rendered');
        renderInspector(null);
      } catch (error) {
        dom.visualEditor.replaceChildren(document.createTextNode(`\u53EF\u89C6\u5316\u7F16\u8F91\u4E0D\u53EF\u7528\uFF1A${error.message}`));
        renderInspector(null);
      }
    }

    function syncVisualToModel(event) {
      if (state.suppressVisualInput) return;
      if (state.mode !== 'visual') return;
      const file = state.filesMap.get(state.activePath);
      if (!file) return;
      if (event?.inputType === 'insertParagraph') {
        const surface = event.target?.closest?.('.map-topic-surface') || dom.visualEditor;
        // Chromium clones XML IDs when Enter splits a paragraph or inline
        // element. Keep original source identities; only strip new duplicates.
        const groups = new Map();
        for (const node of surface.querySelectorAll('[id]')) {
          const id = node.getAttribute('id');
          if (!groups.has(id)) groups.set(id, []);
          groups.get(id).push(node);
        }
        for (const nodes of groups.values()) {
          const original = nodes.find(node => node.ditaSourcePath !== undefined) || nodes[0];
          for (const node of nodes) if (node !== original && node.ditaSourcePath === undefined) node.removeAttribute('id');
        }
      }
      if (/\.ditamap$/i.test(file.path)) {
        mapController.sync(event);
        return;
      }
      try {
        const previous = file.current;
        if (dom.visualEditor.ditaSourceContent !== previous) throw new Error('正文已由其他操作更新，请重新打开后继续编写');
        const next = visualCore.visualToXml();
        if (next !== previous) {
          setFileContent(file, next, { updateEditor: false, render: false, ...inputHistory?.take(file, event) });
        }
        dom.visualEditor.ditaSourceContent = file.current;
        // Keep the live Author DOM in place while the user is typing. Rebuilding
        // it on every input would move the caret and drop the current selection;
        // Oxygen updates the source model separately from the editor surface.
        dom.editor.value = file.current;
        renderTabs();
        updateHistoryButtons();
        const surfaceLabel = state.mode === 'preview' ? '\u9884\u89C8\u7F16\u8F91' : '\u53EF\u89C6\u5316\u7F16\u8F91';
        setStatus(`${surfaceLabel}\u5DF2\u540C\u6B65\uFF1A${file.dirty ? '\u6709\u672A\u4FDD\u5B58\u4FEE\u6539' : '\u65E0\u4FEE\u6539'}`);
      } catch (error) {
        renderAuthorSurface(file, dom.visualEditor);
        setStatus(`\u53EF\u89C6\u5316\u7F16\u8F91\u540C\u6B65\u5931\u8D25\uFF1A${error.message}`, true);
      }
    }


    const { resetReviewSnapshot, renderDiff, renderMapReview, reviewAll } = review.createReviewController({
      state, dom, ditaCore, setFileContent, updateVisual, renderTabs, updateHistoryButtons, setStatus
    });

    const mapController = mapAuthor.createController({ state, session, dom, ditaCore, api: workspaceClient, events, validateXml, setStatus }, {
      load: documents.load, documentLabel, setFileContent,
      takeHistory: (file, event) => inputHistory?.take(file, event),
      renderAuthorSurface, renderTabs, updateTree, renderInspector,
      updateHistoryButtons, renderMapReview
    });

    function markDirty(event) {
      const file = state.filesMap.get(state.activePath);
      if (!file || file.current === dom.editor.value) return;
      setFileContent(file, dom.editor.value, { updateEditor: false, ...inputHistory?.take(file, event) });
    }

    function renderAuthorSurface(file, surface, rendered) {
      const scrollTop = dom.visualEditor.scrollTop, scrollLeft = dom.visualEditor.scrollLeft;
      const selection = root.getSelection(), current = selection?.rangeCount ? selection.getRangeAt(0) : null;
      let bookmark;
      if (current && surface.contains(current.endContainer)) {
        const element = current.endContainer.nodeType === 1 ? current.endContainer : current.endContainer.parentElement;
        const block = element.closest('p,td,th,li,pre,h2,h3,h4') || surface;
        const prefix = current.cloneRange(); prefix.selectNodeContents(block); prefix.setEnd(current.endContainer, current.endOffset);
        bookmark = { path: block.ditaSourcePath, offset: prefix.toString().length };
      }
      rendered ||= ditaCore.createAuthorTopic(file.current, document, state.mode === 'review', file.path);
      surface.replaceChildren(...rendered.childNodes);
      surface.ditaSourceContent = file.current;
      events.emit('author:rendered');
      renderInspector(null); renderTabs(); updateHistoryButtons(); renderOutline();
      if (bookmark) {
        const block = bookmark.path === undefined ? surface : Array.from(surface.querySelectorAll('*')).find(node => node.ditaSourcePath === bookmark.path) || surface;
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let node, remaining = bookmark.offset, last;
        while ((node = walker.nextNode())) {
          last = node;
          if (remaining <= node.length) break;
          remaining -= node.length;
        }
        const range = document.createRange();
        node ||= last;
        const marker = node?.parentElement.closest('.fn-ref,[data-dita-source="fn"]');
        if (marker) range.setStartAfter(marker);
        else if (node) range.setStart(node, Math.min(remaining, node.length));
        else { range.selectNodeContents(block); range.collapse(false); }
        range.collapse(true); surface.focus({ preventScroll: true }); selection.removeAllRanges(); selection.addRange(range);
      }
      dom.visualEditor.scrollTop = scrollTop; dom.visualEditor.scrollLeft = scrollLeft;
      if (state.activePath === file.path) dom.editor.value = file.current;
    }

    function applyAuthorEdit(file, content, surface, { selectionBefore, selectionAfter } = {}) {
      const active = state.filesMap.get(state.activePath);
      const isTopic = active === file && surface === dom.visualEditor;
      const isMapTopic = /\.ditamap$/i.test(active?.path || '') && state.mapAuthorPaths.has(file?.path) &&
        dom.visualEditor.contains(surface) && surface.dataset.mapTopicPath === file.path;
      if (state.mode !== 'visual' || state.filesMap.get(file?.path) !== file || (!isTopic && !isMapTopic)) throw new Error('编写位置已变化，请重新选择正文位置');
      validateXml(content);
      const before = selectionBefore ? { mode: 'visual', path: file.path, bookmark: selectionBefore } : captureSelection(file);
      if (content === file.current) { if (selectionAfter) A.authorSelection?.restore(surface, selectionAfter); return; }
      const rendered = ditaCore.createAuthorTopic(content, document, false, file.path);
      if (!setFileContent(file, content, { render: false, historyMeta: { selectionBefore: before } })) return;
      renderAuthorSurface(file, surface, rendered);
      if (selectionAfter) A.authorSelection?.restore(surface, selectionAfter);
      ensureHistory(file).undo.at(-1).selectionAfter = captureSelection(file);
    }

    inputHistory = root.DitaInputHistory?.createController({ state, dom, events }, { capture: captureSelection, syncVisual: syncVisualToModel, syncSource: markDirty, undo: undoFile, redo: redoFile,
      resolve(target) {
        if (target === dom.editor && state.mode === 'editor') return state.filesMap.get(state.activePath);
        if (state.mode !== 'visual' || !dom.visualEditor.contains(target)) return null;
        if (target.closest?.('[data-map-title]')) return state.filesMap.get(state.activePath);
        const path = target.closest?.('.map-topic-surface')?.dataset.mapTopicPath || state.activePath;
        return /\.ditamap$/i.test(path) ? null : state.filesMap.get(path);
      } });

    function reset() {
      inputHistory?.reset();
      mapController.reset();
    }
    // Input history and Map lifecycle subscribe to workspace changes themselves.
    return { setFileContent, undoFile, redoFile, updateHistoryButtons, updateActivePanes,
      setMode, ensureMapAuthorFile, updateVisual, syncVisualToModel, markDirty,
      resetReviewSnapshot, renderDiff, renderMapReview, reviewAll, applyAuthorEdit, reset };
  }
  const api = { createEditorController };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaEditorController = api;
})(typeof window === 'undefined' ? globalThis : window);

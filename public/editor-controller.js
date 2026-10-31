'use strict';
(function (root) {
  const documentStore = typeof module !== 'undefined' ? require('./document-store') : root.DitaDocumentStore;
  const review = typeof module !== 'undefined' ? require('./review') : root.DitaReview;

  // Coordinates Source/Author/Map surfaces around one document history. View
  // callbacks are injected; state and source rules remain in their own modules.
  function createEditorController(A, views) {
    const { state, dom, ditaCore, setStatus, validateXml, events, api: workspaceClient } = A;
    const fetch = workspaceClient.request;
    const { renderTabs, renderOutline, renderInspector, updateTree,
      refreshChrome: updateDocumentChrome, beforeModeChange, modeChanged } = views;
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
    }

    const mapRefreshTimers = new Map();
    function scheduleMapRefresh(file) {
      if (!/\.ditamap$/i.test(file.path)) return;
      clearTimeout(mapRefreshTimers.get(file.path));
      const workspace = workspaceClient.token;
      mapRefreshTimers.set(file.path, setTimeout(async () => {
        mapRefreshTimers.delete(file.path);
        if (workspace !== workspaceClient.token || state.filesMap.get(file.path) !== file) return;
        const content = file.current;
        try {
          // Incomplete XML during typing is expected; retain the last valid tree.
          validateXml(content);
          const response = await fetch('/api/map/resolve', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: file.path, content })
          });
          if (!response.ok) return;
          const map = await response.json();
          if (file.current !== content || state.filesMap.get(file.path) !== file) return;
          const index = state.maps.findIndex(item => item.path === file.path);
          if (index < 0) state.maps.push(map); else state.maps[index] = map;
          if (state.selectedMap === file.path) updateTree();
          if (state.activePath === file.path && ['visual', 'preview', 'review'].includes(state.mode)) updateMapAuthor(file);
        } catch { /* An incomplete edit or superseded workspace keeps its buffer. */ }
      }, 180));
    }

    function refreshFileViews(file, { updateEditor = true } = {}) {
      if (file) scheduleMapRefresh(file);
      if (!file || state.activePath !== file.path) return;
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

    function refreshHistoryTargetView(file) {
      if (!file) return;
      if (state.activePath === file.path) {
        refreshFileViews(file);
        return;
      }
      const active = state.filesMap.get(state.activePath);
      if (active && /\.ditamap$/i.test(active.path) && state.mapAuthorPaths?.has(file.path)) {
        state.suppressVisualInput = true;
        updateVisual(active);
        state.suppressVisualInput = false;
        renderTabs();
        updateHistoryButtons();
        if (state.mode === 'review') renderMapReview(active);
      }
    }

    function setFileContent(file, content, { record = true, updateEditor = true, historyMeta, render = true } = {}) {
      if (!file) return false;
      if (!documentStore.editDocument(file, content, { record, historyMeta })) return false;
      if (file.path === state.activePath || (/\.ditamap$/i.test(state.activePath) && state.mapAuthorPaths?.has(file.path))) {
        state.historyTargetPath = file.path;
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
      refreshHistoryTargetView(file); events.emit('document:changed', file);
      setStatus('已撤销');
    }

    function redoFile() {
      const file = historyTargetFile();
      if (!file) return;
      const entry = documentStore.travelHistory(file, 'redo');
      if (!entry) return;
      if (entry.reviewDecisionsAfter) state.reviewDecisions = new Map(entry.reviewDecisionsAfter);
      refreshHistoryTargetView(file); events.emit('document:changed', file);
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
      renderOutline();
      renderInspector(null);
      updateHistoryButtons();
      updateDocumentChrome();
    }


    function setMode(mode) {
      beforeModeChange?.();
      state.mode = mode;
      dom.editorPane.classList.toggle('active', mode === 'editor');
      // Review keeps the Author surface in the main column. The review pane is a
      // docked right sidebar, matching Oxygen Author's reading flow.
      dom.visualPane.classList.toggle('active', mode === 'visual' || mode === 'preview' || mode === 'review');
      // Reading reuses the Author rendering with all editing disabled.
      dom.reviewPane.classList.toggle('active', mode === 'review');
      dom.visualEditor?.classList.toggle('preview-editable', mode === 'preview');
      dom.inspector?.classList.toggle('reviewing', mode === 'review');
      if (dom.inspectorTitle) dom.inspectorTitle.textContent = mode === 'review' ? '变更审阅' : '文档属性';
      dom.htmlPreviewPane?.classList.remove('active');
      dom.mdPreviewPane?.classList.remove('active');
      if (dom.inspectorElement) dom.inspectorElement.hidden = mode === 'review';
      if (dom.attributesPanel) dom.attributesPanel.hidden = mode === 'review';
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
      const cached = state.filesMap.get(path);
      if (cached) return cached;
      const [fileResponse, gitResponse] = await Promise.all([
        fetch(`/api/file?path=${encodeURIComponent(path)}`),
        fetch(`/api/git?path=${encodeURIComponent(path)}`)
      ]);
      if (!fileResponse.ok) throw new Error(`${path}: ${(await fileResponse.text()).trim()}`);
      const disk = await fileResponse.text();
      const git = await gitResponse.json().catch(() => ({}));
      const file = {
        path,
        disk,
        baseline: git.available ? git.content : disk,
        gitStatus: git.status || 'unknown',
        current: disk,
        dirty: false
      };
      state.filesMap.set(path, file);
      return file;
    }

    async function updateMapAuthor(file) {
      const token = ++state.mapAuthorRenderToken;
      const map = state.maps.find(item => item.path === file.path);
      if (!map) return;
      const entries = ditaCore.collectPreviewPaths(map.children || []);
      state.mapAuthorPaths = new Set(entries.map(entry => entry.path));
      dom.visualEditor.classList.add('map-author-editor');
      dom.visualEditor.contentEditable = 'false';
      dom.visualEditor.replaceChildren(document.createTextNode('正在加载 Map 全文…'));
      const loaded = await Promise.all(entries.map(async entry => {
        try {
          return { entry, file: await ensureMapAuthorFile(entry.path) };
        } catch (error) {
          return { entry, error };
        }
      }));
      if (token !== state.mapAuthorRenderToken || state.activePath !== file.path) return;
      const fragment = document.createDocumentFragment();
      const heading = document.createElement('h1');
      heading.className = 'map-author-title';
      heading.textContent = map.title || map.name || map.path;
      heading.dataset.mapTitle = 'true';
      heading.contentEditable = state.mode === 'visual' ? 'true' : 'false';
      fragment.append(heading);
      if (!loaded.length) {
        const empty = document.createElement('p');
        empty.className = 'map-author-empty';
        empty.textContent = '此 Map 没有可编辑的 topic 引用。';
        fragment.append(empty);
      }
      for (const item of loaded) {
        const topic = document.createElement('section');
        topic.className = 'map-topic';
        topic.dataset.mapTopicPath = item.entry.path;
        const header = document.createElement('div');
        header.className = 'map-topic-header';
        const name = document.createElement('strong');
        name.textContent = item.entry.title || item.entry.path;
        const path = document.createElement('small');
        path.textContent = item.entry.path;
        header.append(name, path);
        topic.append(header);
        if (item.error) {
          const error = document.createElement('p');
          error.className = 'preview-error';
          error.textContent = `无法打开 ${item.entry.path}：${item.error.message}`;
          topic.append(error);
        } else {
          try {
            const surface = ditaCore.createAuthorTopic(item.file.current, document, state.mode === 'review', item.entry.path);
            surface.className = 'map-topic-surface';
            surface.dataset.mapTopicPath = item.entry.path;
            surface.contentEditable = state.mode === 'visual' ? 'true' : 'false';
            topic.append(surface);
          } catch (error) {
            const message = document.createElement('p');
            message.className = 'preview-error';
            message.textContent = `无法解析 ${item.entry.path}：${error.message}`;
            topic.append(message);
          }
        }
        fragment.append(topic);
      }
      dom.visualEditor.replaceChildren(fragment);
      renderInspector(null);
      // setMode('review') starts the async Map Author load and can render the
      // review dock before topic files finish loading. Refresh it once the
      // complete surface and mapAuthorPaths are ready.
      if (state.mode === 'review') renderMapReview(file);
    }

    function syncMapAuthorToModel(event) {
      const file = state.filesMap.get(state.activePath);
      if (!file || !/\.ditamap$/i.test(file.path)) return false;
      const target = event?.target?.closest?.('[data-map-topic-path]');
      const mapTitle = event?.target?.closest?.('[data-map-title]');
      if (mapTitle) {
        try {
          const doc = ditaCore.parseXml(file.current);
          const root = doc.documentElement;
          let title = Array.from(root.childNodes).find(node => node.localName === 'title');
          if (!title) {
            title = doc.createElement('title');
            root.insertBefore(title, root.firstChild);
          }
          title.textContent = mapTitle.textContent.trim();
          const map = state.maps.find(item => item.path === file.path);
          if (map) map.title = title.textContent;
          const declaration = file.current.match(/^\s*<\?xml[^?]*\?>/i)?.[0] || '<?xml version="1.0" encoding="UTF-8"?>';
          const doctype = file.current.match(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?[^>]*>/i)?.[0] || '';
          const next = `${declaration}\n${doctype ? `${doctype}\n` : ''}${ditaCore.serializeXmlNode(root)}\n`;
          setFileContent(file, next, { updateEditor: false });
          renderTabs();
          setStatus(`Map Author：已修改 Map 标题${file.dirty ? '（待保存）' : ''}`);
        } catch (error) {
          setStatus(`Map 标题同步失败：${error.message}`, true);
        }
        return true;
      }
      const path = target?.dataset.mapTopicPath;
      const topicFile = path ? state.filesMap.get(path) : null;
      const surface = target?.classList.contains('map-topic-surface') ? target : target?.querySelector('.map-topic-surface');
      if (!topicFile || !surface) return true;
      try {
        const next = ditaCore.updateCurrentFromVisual(null, { visualEditor: surface }, topicFile.current);
        if (next !== topicFile.current) {
          setFileContent(topicFile, next, { updateEditor: false });
          topicFile.gitStatus = topicFile.gitStatus === 'unknown' ? 'modified' : topicFile.gitStatus;
          renderTabs();
          updateHistoryButtons();
        }
        setStatus(`Map Author：已修改 ${path}${topicFile.dirty ? '（待保存）' : ''}`);
      } catch (error) {
        setStatus(`Map Author 同步失败：${error.message}`, true);
      }
      return true;
    }

    function updateVisual(file, reviewMode = false) {
      if (state.selectedVisualElement?.classList) state.selectedVisualElement.classList.remove('author-selected');
      state.selectedVisualElement = null;
      if (!file) {
        dom.visualEditor.classList.remove('map-author-editor');
        dom.visualEditor.replaceChildren(document.createTextNode('\u672A\u6253\u5F00\u6587\u4EF6'));
        renderInspector(null);
        return;
      }
      if (/\.ditamap$/i.test(file.path)) {
        updateMapAuthor(file).catch(error => {
          dom.visualEditor.replaceChildren(document.createTextNode(`Map Author 加载失败：${error.message}`));
          setStatus(`Map Author 加载失败：${error.message}`, true);
        });
        return;
      }
      try {
        dom.visualEditor.classList.remove('map-author-editor');
        visualCore.updateVisualFromXml(file.current, reviewMode);
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
      if (/\.ditamap$/i.test(file.path)) {
        syncMapAuthorToModel(event);
        return;
      }
      try {
        const previous = file.current;
        const next = visualCore.visualToXml();
        if (next !== previous) {
          setFileContent(file, next, { updateEditor: false, render: false });
        }
        // Keep the live Author DOM in place while the user is typing. Rebuilding
        // it on every input would move the caret and drop the current selection;
        // Oxygen updates the source model separately from the editor surface.
        dom.editor.value = file.current;
        renderTabs();
        updateHistoryButtons();
        const surfaceLabel = state.mode === 'preview' ? '\u9884\u89C8\u7F16\u8F91' : '\u53EF\u89C6\u5316\u7F16\u8F91';
        setStatus(`${surfaceLabel}\u5DF2\u540C\u6B65\uFF1A${file.dirty ? '\u6709\u672A\u4FDD\u5B58\u4FEE\u6539' : '\u65E0\u4FEE\u6539'}`);
      } catch (error) {
        setStatus(`\u53EF\u89C6\u5316\u7F16\u8F91\u540C\u6B65\u5931\u8D25\uFF1A${error.message}`, true);
      }
    }


    const { resetReviewSnapshot, renderDiff, renderMapReview, reviewAll } = review.createReviewController({
      state, dom, ditaCore, setFileContent, updateVisual, renderTabs, updateHistoryButtons, setStatus
    });

    function markDirty() {
      const file = state.filesMap.get(state.activePath);
      if (!file) return;
      setFileContent(file, dom.editor.value, { updateEditor: false });
    }

    function reset() {
      for (const timer of mapRefreshTimers.values()) clearTimeout(timer);
      mapRefreshTimers.clear();
      state.mapAuthorRenderToken += 1;
    }
    events.on('workspace:willChange', reset);
    return { setFileContent, undoFile, redoFile, updateHistoryButtons, updateActivePanes,
      setMode, ensureMapAuthorFile, updateVisual, syncVisualToModel, markDirty,
      resetReviewSnapshot, renderDiff, renderMapReview, reviewAll, reset };
  }
  const api = { createEditorController };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaEditorController = api;
})(typeof window === 'undefined' ? globalThis : window);

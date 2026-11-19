// @ts-check
'use strict';
(function (root) {
  /** @typedef {import('../data-contracts').DocumentState} DocumentState */
  /** @typedef {import('../data-contracts').MapEntry} MapEntry */
  /** @typedef {import('../data-contracts').WorkspaceState} WorkspaceState */
  /** @typedef {import('../data-contracts').CapturePorts['api']} WorkspaceApi */
  /** @typedef {ReturnType<ReturnType<typeof import('./input-history').createController>['take']>} InputHistoryEdit */
  const mapSource = typeof module !== 'undefined' ? require('./map-source') : root.DitaMapSource;
  /** @param {unknown} error */
  const messageOf = error => error instanceof Error ? error.message : String(error);

  // The editor owns history/modes; this controller owns the asynchronous Map
  // surface and its refresh jobs. No render tokens or timers escape to app state.
  /**
   * @param {{state: Pick<WorkspaceState, 'activePath' | 'selectedMap' | 'mode' | 'filesMap' | 'maps'>,
   * session: {upsertMap(map: MapEntry): void, updateMapTitle(path: string, title: string): void, setAuthorPaths(paths: string[]): void},
   * dom: {visualEditor: HTMLElement, editor: HTMLTextAreaElement},
   * ditaCore: {collectPreviewPaths(entries: readonly MapEntry[]): readonly MapEntry[],
   * createAuthorTopic(source: string, document: Document, review: boolean, path: string): HTMLElement,
   * updateCurrentFromVisual(state: null, dom: {visualEditor: HTMLElement}, source: string, tracking?: boolean): string},
   * api: Pick<WorkspaceApi, 'token' | 'request'> & Partial<Pick<WorkspaceApi, 'error'>>,
   * events: {on(name: string, handler: () => void): unknown, emit(name: string): void},
   * validateXml(source: string): unknown, setStatus(message: string, error?: boolean): void}} ports
   * @param {{load(path: string): Promise<DocumentState>, documentLabel(file: DocumentState): string,
   * setFileContent(file: DocumentState, content: string, options: Partial<InputHistoryEdit> & {updateEditor: boolean, render: boolean}): unknown,
   * takeHistory(file: DocumentState, event?: Event): InputHistoryEdit | undefined,
   * renderAuthorSurface(file: DocumentState, surface: HTMLElement): void, trackingActive?(file: DocumentState): boolean | undefined,
   * renderTabs(): void, updateTree(): void, renderInspector(target: null): void,
   * updateHistoryButtons(): void, renderMapReview(file: DocumentState): void}} views
   */
  function createController({ state, session, dom, ditaCore, api, events, validateXml, setStatus }, {
    load, documentLabel, setFileContent, takeHistory, renderAuthorSurface, trackingActive,
    renderTabs, updateTree, renderInspector, updateHistoryButtons, renderMapReview
  }) {
    const document = dom.visualEditor.ownerDocument;
    let renderRevision = 0, workspaceRevision = 0;
    /** @type {Map<string, {timer?: ReturnType<typeof setTimeout>}>} */
    const refreshJobs = new Map();
    function invalidate() { renderRevision++; }
    function reset() {
      invalidate(); workspaceRevision++;
      for (const job of refreshJobs.values()) clearTimeout(job.timer);
      refreshJobs.clear();
    }
    events.on('workspace:willChange', reset);

    /** @param {DocumentState} file */
    function scheduleRefresh(file) {
      if (!/\.ditamap$/i.test(file.path)) return;
      clearTimeout(refreshJobs.get(file.path)?.timer);
      /** @type {{timer?: ReturnType<typeof setTimeout>}} */
      const job = {};
      const workspace = api.token, revision = workspaceRevision;
      refreshJobs.set(file.path, job);
      const current = () => refreshJobs.get(file.path) === job && workspace === api.token &&
        revision === workspaceRevision && state.filesMap.get(file.path) === file;
      job.timer = setTimeout(async () => {
        if (!current()) return;
        const content = file.current;
        try { validateXml(content); }
        catch { refreshJobs.delete(file.path); return; /* Typing may leave XML incomplete. */ }
        try {
          const response = await api.request('/api/map/resolve', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: file.path, content })
          });
          if (!response.ok) throw new Error(api.error ? await api.error(response) : `HTTP ${response.status}`);
          /** @type {MapEntry} */
          const map = await response.json();
          if (!current() || file.current !== content) return;
          session.upsertMap(map);
          if (state.selectedMap === file.path) updateTree();
          if (state.activePath === file.path && ['visual', 'preview', 'review'].includes(state.mode)) await updateMapAuthor(file);
        } catch (error) {
          if (current() && file.current === content) setStatus(`Map 目录刷新失败：${messageOf(error)}，修改仍保留在编辑器中`, true);
        } finally {
          if (refreshJobs.get(file.path) === job) refreshJobs.delete(file.path);
        }
      }, 180);
    }

    /** @param {HTMLElement} heading @param {DocumentState} file */
    function configureTitle(heading, file) {
      const title = mapSource.readTitle(file.current);
      const map = state.maps.find(item => item.path === file.path);
      heading.textContent = title.present ? title.text : map?.title || map?.name || file.path;
      heading.contentEditable = state.mode === 'visual' && title.editable ? 'plaintext-only' : 'false';
      heading.title = title.reason || '手册标题';
      heading.setAttribute('aria-label', '手册标题');
      heading.ditaSourceContent = file.current;
      return title;
    }

    /** @param {DocumentState} file */
    function updateTitleViews(file) {
      session.updateMapTitle(file.path, mapSource.readTitle(file.current).text);
      dom.editor.value = file.current;
      renderTabs(); updateTree(); updateHistoryButtons();
    }

    /** @param {DocumentState} file */
    function refreshTitle(file) {
      const heading = /** @type {HTMLElement | null} */ (dom.visualEditor.querySelector('[data-map-title]'));
      if (state.activePath !== file.path || !heading) return false;
      configureTitle(heading, file);
      updateTitleViews(file);
      return true;
    }

    /** @param {DocumentState} file */
    async function updateMapAuthor(file) {
      const token = ++renderRevision;
      const workspace = api.token, source = file.current, mode = state.mode;
      const current = () => token === renderRevision && workspace === api.token &&
        state.activePath === file.path && state.filesMap.get(file.path) === file &&
        state.mode === mode && file.current === source;
      if (!current() || !['visual', 'preview', 'review'].includes(mode)) return;
      const map = state.maps.find(item => item.path === file.path);
      if (!map) return;
      try {
        const entries = ditaCore.collectPreviewPaths(map.children || []);
        session.setAuthorPaths(entries.map(entry => entry.path));
        dom.visualEditor.classList.add('map-author-editor');
        dom.visualEditor.contentEditable = 'false';
        dom.visualEditor.replaceChildren(document.createTextNode('正在加载 Map 全文…'));
        const loaded = await Promise.all(entries.map(async entry => {
          try {
            return { entry, file: await load(entry.path) };
          } catch (error) {
            return { entry, error };
          }
        }));
        if (!current()) return;
        const fragment = document.createDocumentFragment();
        const heading = document.createElement('h1');
        heading.className = 'map-author-title';
        heading.dataset.mapTitle = 'true';
        const title = configureTitle(heading, file);
        fragment.append(heading);
        if (title.reason) {
          const hint = document.createElement('p');
          hint.className = 'map-author-empty';
          hint.textContent = title.reason;
          fragment.append(hint);
        }
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
          name.textContent = item.file ? documentLabel(item.file) : item.entry.title || item.entry.path;
          const path = document.createElement('small');
          path.textContent = item.entry.path;
          header.append(name, path);
          topic.append(header);
          if (!item.file) {
            const error = document.createElement('p');
            error.className = 'preview-error';
            error.textContent = `无法打开 ${item.entry.path}：${messageOf(item.error)}`;
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
              message.textContent = `无法解析 ${item.entry.path}：${messageOf(error)}`;
              topic.append(message);
            }
          }
          fragment.append(topic);
        }
        dom.visualEditor.replaceChildren(fragment);
        events.emit('author:rendered');
        renderTabs(); updateTree();
        renderInspector(null);
        // setMode('review') starts the async Map Author load and can render the
        // review dock before topic files finish loading. Refresh it once the
        // complete surface and mapAuthorPaths are ready.
        if (state.mode === 'review') renderMapReview(file);
      } catch (error) {
        if (!current()) return;
        dom.visualEditor.replaceChildren(document.createTextNode(`Map Author 加载失败：${messageOf(error)}`));
        setStatus(`Map Author 加载失败：${messageOf(error)}`, true);
      }
    }

    /** @param {Event} [event] */
    function syncMapAuthorToModel(event) {
      const file = state.filesMap.get(state.activePath);
      if (!file || !/\.ditamap$/i.test(file.path)) return false;
      const element = /** @type {HTMLElement | null | undefined} */ (event?.target);
      const target = /** @type {HTMLElement | null | undefined} */ (element?.closest?.('[data-map-topic-path]'));
      const mapTitle = /** @type {HTMLElement | null | undefined} */ (element?.closest?.('[data-map-title]'));
      if (mapTitle) {
        try {
          if (mapTitle.ditaSourceContent !== file.current) throw new Error('标题已由其他操作更新，请重新放置光标后修改');
          const next = mapSource.replaceTitle(file.current, mapTitle.textContent ?? '');
          if (next !== file.current) {
            const history = takeHistory(file, event);
            setFileContent(file, next, { updateEditor: false, render: false, ...history,
              historyMeta: { ...history?.historyMeta, mapTitle: true } });
            // Keep the live title and chapter DOM mounted while typing.
            mapTitle.ditaSourceContent = file.current;
            updateTitleViews(file);
          }
          setStatus(`Map Author：已修改 Map 标题${file.dirty ? '（待保存）' : ''}`);
        } catch (error) {
          refreshTitle(file);
          setStatus(`Map 标题同步失败：${messageOf(error)}`, true);
        }
        return true;
      }
      const path = target?.dataset.mapTopicPath;
      const topicFile = path ? state.filesMap.get(path) : null;
      const surface = target?.classList.contains('map-topic-surface') ? target :
        /** @type {HTMLElement | null | undefined} */ (target?.querySelector('.map-topic-surface'));
      if (!topicFile || !surface) return true;
      try {
        if (surface.ditaSourceContent !== topicFile.current) throw new Error('正文已由其他操作更新，请重新打开此 Topic 后继续编写');
        const next = ditaCore.updateCurrentFromVisual(null, { visualEditor: surface }, topicFile.current, trackingActive?.(topicFile));
        if (next !== topicFile.current) {
          setFileContent(topicFile, next, { updateEditor: false, render: false, ...takeHistory(topicFile, event) });
          renderTabs();
          updateHistoryButtons();
        }
        surface.ditaSourceContent = topicFile.current;
        setStatus(`Map Author：已修改 ${path}${topicFile.dirty ? '（待保存）' : ''}`);
      } catch (error) {
        renderAuthorSurface(topicFile, surface);
        setStatus(`Map Author 同步失败：${messageOf(error)}`, true);
      }
      return true;
    }

    return { render: updateMapAuthor, sync: syncMapAuthorToModel, scheduleRefresh, refreshTitle, invalidate, reset };
  }
  const api = { createController };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaMapAuthorController = api;
})(typeof window === 'undefined' ? globalThis : window);

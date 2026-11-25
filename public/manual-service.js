// @ts-check
'use strict';
(function (root) {
  const snapshots = typeof module !== 'undefined' ? require('./snapshot-data') : root.DitaSnapshotData;
  const resolver = typeof module !== 'undefined' ? require('./publication-resolver') : root.DitaPublicationResolver;
  const domain = typeof module !== 'undefined' ? require('./manual-domain') : root.DitaManualDomain;
  const { collectPreviewPaths } = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const store = typeof module !== 'undefined' ? require('./document-store') : root.DitaDocumentStore;
  const profiling = typeof module !== 'undefined' ? require('./profiling-core') : root.DitaProfiling;
  const browserFiles = typeof module !== 'undefined' ? require('./browser-files') : root.DitaBrowserFiles;

  /** Workspace IO and snapshot freshness only; document rules live in manual-domain.
   * @param {import('./data-contracts').CapturePorts} A */
  function createManualService(A) {
    /** @returns {import('./data-contracts').ProjectConfig} */
    const projectValue = () => A.project?.value || { schema: 1, models: [] };

    /** @param {import('./data-contracts').CaptureContext} snapshot */
    function sameContext(snapshot) {
      if (!snapshot || snapshot.workspace !== A.api.token || snapshot.root !== A.state.root ||
          snapshot.branch !== A.state.currentBranch || snapshot.projectContent !== A.project?.expectedContent ||
          snapshot.projectError !== A.project?.error) return false;
      const project = projectValue();
      return snapshot.project.schema === project.schema && snapshot.project.models.length === project.models.length &&
        snapshot.project.models.every((model, index) => model === project.models[index]);
    }

    /** @param {import('./data-contracts').ManualSnapshot} snapshot */
    function contextCurrent(snapshot) {
      return sameContext(snapshot) && (!A.noteRuleStore || A.noteRuleStore.current(snapshot.noteRules));
    }

    /** @param {import('./data-contracts').ManualSnapshot} snapshot */
    function current(snapshot) {
      if (!contextCurrent(snapshot)) return false;
      /** @type {[string,string][]} */
      const entries = [[snapshot.path, snapshot.content], ...Array.from(snapshot.files, /** @returns {[string,string]} */ ([path, file]) => [path, file.current])];
      if (snapshot.filter) entries.push([snapshot.filter.path, snapshot.filter.current]);
      return entries.every(([path, content]) => {
        const file = A.state.filesMap.get(path), captured = snapshot.buffers.get(path);
        return file ? file.current === content && (!captured || file.disk === captured.disk) : !captured;
      });
    }

    /** Check what was actually on disk while preserving edits from open buffers.
     * @param {import('./data-contracts').ManualSnapshot} snapshot @param {AbortSignal} [signal] */
    async function verifyDeliverySources(snapshot, signal) {
      /** @type {Map<string, string | null>} */
      const sources = new Map([[snapshot.path, snapshot.content], ...Array.from(snapshot.files, ([path, file]) => /** @type {[string,string]} */ ([path, file.current]))]);
      if (snapshot.filter) sources.set(snapshot.filter.path, snapshot.filter.current);
      for (const path of snapshot.missingSources || []) if (!sources.has(path)) sources.set(path, null);
      const entries = [...sources];
      for (let start = 0; start < entries.length; start += 6) {
        await Promise.all(entries.slice(start, start + 6).map(async ([path, content]) => {
          const buffer = snapshot.buffers.get(path);
          const expected = buffer?.disk ?? content;
          const response = await A.api.request('/api/file?path=' + encodeURIComponent(path), { signal });
          if (expected === null && response.status === 404) return;
          if (!response.ok || expected === null || await browserFiles.readXmlResponse(response) !== expected) {
            throw new Error(path + '：磁盘来源已变化或无法读取。' +
              (buffer ? '请保留未保存修改，重新打开该文档后再做交付检查。' : '请重新打开交付设置后检查。'));
          }
        }));
      }
    }

    /** @param {string} [path]
     * @param {{resources?:boolean,filterPath?:string,model?:string,deferMissingTopics?:boolean,includeTopic?:(path:string)=>boolean}} [options]
     * @returns {Promise<import('./data-contracts').ManualSnapshot>} */
    async function capture(path = A.state.activePath, { resources = false, filterPath = '', model = '', deferMissingTopics = false, includeTopic } = {}) {
      if (!path) throw new Error('请先打开文档或功能手册');
      const workspace = A.api.token;
      await A.project?.ready?.();
      if (workspace !== A.api.token) throw new Error('工作区已切换，请重新打开');
      // Pin model settings before the first document read. Taking them after
      // asynchronous IO could silently combine old documents with new settings.
      const project = projectValue();
      /** @type {import('./data-contracts').CaptureContext} */
      const context = {
        workspace, root: A.state.root, branch: A.state.currentBranch,
        project: Object.freeze({ ...project, models: Object.freeze([...project.models]) }),
        projectError: A.project?.error, projectContent: A.project?.expectedContent,
        buffers: new Map(Array.from(A.state.filesMap, ([key, file]) => [key, store.snapshotDocument(file)]))
      };
      function assertContext() {
        if (!sameContext(context)) throw new Error('工作区或型号设置已变化，请重新打开以更新快照');
      }
      /** @param {string} filePath */
      async function read(filePath) {
        assertContext();
        const buffered = context.buffers.get(filePath); if (buffered) return buffered.current;
        const response = await A.api.request('/api/file?path=' + encodeURIComponent(filePath));
        if (!response.ok) throw Object.assign(new Error(filePath + '：' + await A.api.error(response)), { status: response.status });
        const content = await browserFiles.readXmlResponse(response);
        assertContext();
        return content;
      }

      const missingSources = new Set();
      /** @param {string} filePath */
      async function readTopic(filePath) {
        try { return await read(filePath); }
        catch (error) {
          if (!(deferMissingTopics && error instanceof Error && 'status' in error && error.status === 404)) throw error;
          assertContext();
          // The entry stays in the Map. Preparation will reject it if the
          // selected model or an active reuse reference actually needs it.
          missingSources.add(filePath);
          return null;
        }
      }

      if (includeTopic && !includeTopic(path)) throw new Error('所选主题不在本次发布范围内：' + path);
      const content = await read(path);
      if (filterPath && !/\.ditaval$/i.test(filterPath)) throw new Error('请选择工作区内的 DITAVAL 文件');
      const filter = filterPath ? Object.freeze({ path: filterPath, current: await read(filterPath) }) : null;
      let profile;
      try { profile = filter && profiling.compile(filter.current); }
      catch (error) { throw new Error(filterPath + '：' + (error instanceof Error ? error.message : String(error)), { cause: error }); }
      let map;
      if (/\.ditamap$/i.test(path)) {
        const mapSource = profile ? profile.filterSource(content) : content;
        if (!mapSource) throw new Error('DITAVAL 排除了整个手册，请检查过滤规则');
        const response = await A.api.request('/api/map/resolve', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, content: mapSource })
        });
        if (!response.ok) throw new Error(await A.api.error(response));
        map = { ...await response.json(), path, source: mapSource };
        assertContext();
      } else map = { title: path.split('/').pop(), path, children: [{ type: 'file', path }] };

      if (includeTopic) {
        /** @param {readonly import('./data-contracts').MapEntry[]} nodes
         * @returns {import('./data-contracts').MapEntry[]} */
        function includedEntries(nodes) {
          return nodes.flatMap(node => {
            const children = includedEntries(node.children || []);
            if (node.type === 'file' && !includeTopic?.(node.path)) return children;
            return [{ ...node, children }];
          });
        }
        map = { ...map, children: includedEntries(map.children || []) };
        if (!collectPreviewPaths(map.children).length) throw new Error('筛选后没有可发布的正文：' + path);
      }
      const files = new Map();
      const children = model ? resolver.planMap(map, model, profile).children : map.children || [];
      for (const entry of collectPreviewPaths(children)) {
        const current = await readTopic(entry.path);
        if (current != null) files.set(entry.path, { path: entry.path, current });
      }
      if (resources) {
        /** @param {readonly import('./data-contracts').MapEntry[]} nodes */
        async function include(nodes) {
          for (const node of nodes) {
            if (node.type === 'file' && /\.(dita|xml)$/i.test(node.path) && !files.has(node.path)) {
              files.set(node.path, { path: node.path, current: await read(node.path) });
            }
            if (node.children) await include(node.children);
          }
        }
        await include(children);
      }
      const loaded = await resolver.loadDependencies(files, readTopic, profile, { deferInvalidConrefs: deferMissingTopics });
      const noteRules = A.noteRuleStore ? await A.noteRuleStore.read() : null;
      const snapshot = snapshots.createSnapshot({
        ...context, noteRules, capturedAt: new Date().toISOString(), path, content, map, filter, missingSources: [...missingSources],
        files: loaded
      });
      if (!current(snapshot)) throw new Error('内容已变化，请重新打开以更新快照');
      return snapshot;
    }

    async function listFilters() {
      const response = await A.api.request('/api/filters');
      if (response.status === 404) return { files: [] };
      if (!response.ok) throw new Error(await A.api.error(response));
      return response.json();
    }

    return Object.freeze({
      ...domain, capture, current, contextCurrent, listFilters, verifyDeliverySources,
      /** @param {import('./data-contracts').ManualSnapshot} snapshot */
      verifyRules: snapshot => A.noteRuleStore?.verify(snapshot.noteRules),
      scopePath() {
        const { activePath, selectedMap } = A.state;
        if (!activePath || /\.ditamap$/i.test(activePath)) return activePath || selectedMap;
        const map = A.state.maps?.find(item => item.path === selectedMap);
        return map && collectPreviewPaths(map.children || []).some(item => item.path === activePath) ? selectedMap : activePath;
      }
    });
  }
  const api = { createManualService };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaManualService = api;
})(typeof window === 'undefined' ? globalThis : window);

'use strict';
(function (root) {
  const resolver = typeof module !== 'undefined' ? require('./publication-resolver') : root.DitaPublicationResolver;
  const publication = typeof module !== 'undefined' ? require('./publication-core') : root.DitaPublication;
  const notesCore = typeof module !== 'undefined' ? require('./footnotes-core') : root.DitaFootnotesCore;
  const domain = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const store = typeof module !== 'undefined' ? require('./document-store') : root.DitaDocumentStore;
  const profiling = typeof module !== 'undefined' ? require('./profiling-core') : root.DitaProfiling;
  const discovery = typeof module !== 'undefined' ? require('./model-discovery') : root.DitaModelDiscovery;
  const rulesCore = typeof module !== 'undefined' ? require('./note-rules-core') : root.DitaNoteRulesCore;
  /** @param {import('./contracts').ManualPorts} A */
  function createManualService(A) {
    async function capture(path = A.state.activePath, { resources = false, filterPath = '' } = {}) {
      if (!path) throw new Error('请先打开文档或功能手册');
      const workspace = A.api.token;
      await A.project?.ready?.();
      if (workspace !== A.api.token) throw new Error('工作区已切换，请重新打开');
      const buffers = new Map(Array.from(A.state.filesMap, ([key, file]) => [key, store.snapshotDocument(file)]));
      async function read(filePath) {
        if (workspace !== A.api.token) throw new Error('工作区已切换，请重新打开');
        if (buffers.has(filePath)) return buffers.get(filePath).current;
        const response = await A.api.request('/api/file?path=' + encodeURIComponent(filePath));
        if (!response.ok) throw new Error(filePath + '：' + await A.api.error(response));
        return response.text();
      }
      const content = await read(path);
      if (filterPath && !/\.ditaval$/i.test(filterPath)) throw new Error('请选择工作区内的 DITAVAL 文件');
      const filter = filterPath ? { path: filterPath, current: await read(filterPath) } : null;
      let profile;
      try { profile = filter && profiling.compile(filter.current); }
      catch (error) { throw new Error(filterPath + '：' + error.message); }
      let map;
      if (/\.ditamap$/i.test(path)) {
        const mapSource = profile ? profile.filterSource(content) : content;
        if (!mapSource) throw new Error('DITAVAL 排除了整个手册，请检查过滤规则');
        const response = await A.api.request('/api/map/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, content: mapSource }) });
        if (!response.ok) throw new Error(await A.api.error(response));
        map = await response.json(); map.source = mapSource;
      } else map = { title: path.split('/').pop(), path, children: [{ type: 'file', path }] };
      const files = new Map();
      for (const entry of A.ditaCore.collectPreviewPaths(map.children || [])) files.set(entry.path, { path: entry.path, current: await read(entry.path) });
      if (resources) {
        async function include(nodes) { for (const node of nodes) { if (node.type === 'file' && /\.(dita|xml)$/i.test(node.path) && !files.has(node.path)) files.set(node.path, { path: node.path, current: await read(node.path) }); if (node.children) await include(node.children); } }
        await include(map.children || []);
      }
      const loaded = await resolver.loadDependencies(files, read, profile);
      const noteRules = A.noteRuleStore ? await A.noteRuleStore.read() : null;
      const snapshot = { noteRules, capturedAt: new Date().toISOString(), path, content, map, files: loaded, filter, workspace, buffers, project: A.project?.value || { schema: 1, models: [] }, projectError: A.project?.error, projectContent: A.project?.expectedContent, root: A.state.root, branch: A.state.currentBranch };
      if (!current(snapshot)) throw new Error('内容已变化，请重新打开以更新快照');
      return snapshot;
    }
    function current(snapshot) {
      if (A.noteRuleStore && !A.noteRuleStore.current(snapshot?.noteRules)) return false;
      if (!snapshot || snapshot.workspace !== A.api.token || snapshot.root !== A.state.root || snapshot.branch !== A.state.currentBranch || snapshot.projectContent !== A.project?.expectedContent) return false;
      const entries = [[snapshot.path, snapshot.content], ...Array.from(snapshot.files, ([path, file]) => [path, file.current])];
      if (snapshot.filter) entries.push([snapshot.filter.path, snapshot.filter.current]);
      return entries.every(([path, content]) => {
        const file = A.state.filesMap.get(path);
        return file ? file.current === content && (!snapshot.buffers.has(path) || file.disk === snapshot.buffers.get(path).disk) : !snapshot.buffers.has(path);
      });
    }
    function prepare(snapshot, model = '', validateProject = true, {useRules=true,prefixes=false} = {}) {
      const errors = [];
      if (validateProject && snapshot.noteRules?.error) errors.push({path:'.dita-note-rules.json',message:snapshot.noteRules.error});
      const profile = snapshot.filter ? profiling.compile(snapshot.filter.current) : null;
      if (snapshot.projectError) errors.push({ path: '.dita-project.json', message: snapshot.projectError });
      if (model && snapshot.project.models.length && !snapshot.project.models.includes(model)) errors.push({ path: snapshot.path, message: '型号不在项目清单中：' + model });
      for (const [path, file] of snapshot.files) {
        try {
          resolver.walk(xml.inspectSource(file.current), (node, ancestors) => {
            if (profile && [...ancestors, node].some(parent => !profile.keep(parent))) return;
            const value = domain.decode(node.attrs.product);
            if (/[()]/.test(value)) return;
            const unknown = domain.checkModels(value.split(/\s+/).filter(Boolean), snapshot.project);
            if (unknown.length) errors.push({ path, message: '未登记型号：' + unknown.join('、') });
          });
        } catch (error) { errors.push({ path, message: error.message }); }
      }
      if (validateProject && errors.length) throw Object.assign(new Error(errors.map(item => item.path + '：' + item.message).join('\n')), { issues: errors });
      const projection = useRules ? rulesCore.project(snapshot.files, snapshot.noteRules?.config, model, {prefixes,profile,knownModels:[...(snapshot.project.models||[]),...discoverModels(snapshot).models]}) : {files:snapshot.files};
      if (projection.issues?.length) throw Object.assign(new Error(projection.issues.some(item=>item.kind==='model-scope')?'有注脚的型号范围需要核对，请使用独立规则后再导出':'注脚规则已过期，请重新核对后导出'), {issues:projection.issues});
      const result = publication.preparePublication({ map:snapshot.map, files:projection.files, model, profile, ruleConfirmed:projection.confirmed, ruleExclusions:projection.excluded }, A.ditaCore.collectPreviewPaths);
      result.report.ruleApplied=projection.applied||0; result.report.ruleFilteredParts=projection.filteredParts||0;
      result.report.prefixCandidates=projection.prefixCandidates||0;result.report.prefixApplied=projection.prefixApplied||0;result.report.prefixExcluded=projection.prefixExcluded||0;
      if(profile)result.report.filteredElements+=(projection.prefixProfileFiltered||0);return result;
    }
    function listNotes(snapshot, model = '') {
      const data = prepare(snapshot, model, false, {useRules:false}), originals = new Map();
      const notes = data.notes.map((published, index) => {
        const origin = published.origin;
        if (!originals.has(origin.path)) originals.set(origin.path, notesCore.listFootnotes(snapshot.files.get(origin.path).current, origin.path));
        const source = originals.get(origin.path).find(note => note.start === origin.start);
        if (!source) throw new Error('无法定位引用源：' + origin.path);
        const rendered = notesCore.listFootnotes(published.xml)[0];
        return { ...source, sourceNote: source, index, number: published.number, label: published.label, text: rendered.text, conditions: published.conditions, common: published.common,
          unmarked: published.unmarked, reused: Boolean(published.key) || published.path !== origin.path || source.referenced, publicationPath: published.path };
      });
      const locations = new Map();
      for (const [path, file] of snapshot.files) {
        const nodes = new Map();
        const visit = (node, indexes) => { nodes.set(node.start, { xmlPath: indexes.join('/'), name: node.name }); node.children.filter(child => child.kind === 'element').forEach((child, index) => visit(child, [...indexes, index])); };
        visit(xml.inspectSource(file.current), []); locations.set(path, nodes);
      }
      const calls = data.calls.flatMap(call => {
        const location = locations.get(call.site.path)?.get(call.site.start), note = notes[call.number - 1];
        return location && location.name === call.site.name && ['fn', 'xref'].includes(location.name) ? [{ ...call, path: call.site.path, xmlPath: location.xmlPath, note }] : [];
      });
      // Count actual uses, including block-level reuse whose individual fn
      // markers are not directly editable. Definitions are not extra uses.
      const bySource = new Map();
      for (const call of data.calls) {
        if (call.origin || call.definition) continue;
        const note = notes[call.number - 1], location = locations.get(call.site.path)?.get(call.site.start);
        if (!note || !location || location.name !== call.site.name) continue;
        const sourceKey = note.path + '\n' + note.xmlPath, uses = bySource.get(sourceKey) || new Map();
        const id = call.site.path + '\n' + location.xmlPath;
        if (!uses.has(id)) uses.set(id, { path: call.site.path, xmlPath: location.xmlPath, label: note.label, conditions: call.conditions || note.conditions });
        bySource.set(sourceKey, uses);
      }
      for (const note of notes) note.usages = [...(bySource.get(note.path + '\n' + note.xmlPath)?.values() || [])];
      return { notes, calls, models: publication.listModels(snapshot.files, snapshot.filter && profiling.compile(snapshot.filter.current)), report: data.report };
    }
    function saveCandidates(snapshot) {
      return [...new Set([snapshot.path, ...snapshot.files.keys(), ...(snapshot.filter ? [snapshot.filter.path] : [])])].map(path => snapshot.buffers.get(path)).filter(file => file?.dirty);
    }
    async function listFilters() {
      const response = await A.api.request('/api/filters');
      if (response.status === 404) return { files: [] };
      if (!response.ok) throw new Error(await A.api.error(response));
      return response.json();
    }
    function discoverModels(snapshot) {
      const profile = snapshot.filter ? profiling.compile(snapshot.filter.current) : null;
      return discovery.discover(resolver.resolveConrefsDetailed(snapshot.files, profile).files, profile);
    }
    return { capture, current, prepare, verifyRules: snapshot => A.noteRuleStore?.verify(snapshot.noteRules), listNotes, saveCandidates, listFilters, discoverModels, listModels: snapshot => [...new Set([...discoverModels(snapshot).models, ...(snapshot.noteRules?.config.rules || []).filter(rule => snapshot.files.has(rule.path)).flatMap(rule => rule.decisions.flatMap(part => part.models))])].sort(),
      scopePath: () => /\.ditamap$/i.test(A.state.activePath) ? A.state.activePath : A.state.selectedMap || A.state.activePath };
  }
  const api = { createManualService };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaManualService = api;
})(typeof window === 'undefined' ? globalThis : window);

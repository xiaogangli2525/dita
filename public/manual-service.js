'use strict';
(function (root) {
  const resolver = typeof module !== 'undefined' ? require('./publication-resolver') : root.DitaPublicationResolver;
  const publication = typeof module !== 'undefined' ? require('./publication-core') : root.DitaPublication;
  const notesCore = typeof module !== 'undefined' ? require('./footnotes-core') : root.DitaFootnotesCore;
  const domain = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  function createManualService(A) {
    async function capture(path = A.state.activePath) {
      if (!path) throw new Error('请先打开文档或功能手册');
      const workspace = A.api.token;
      await A.project?.ready?.();
      if (workspace !== A.api.token) throw new Error('工作区已切换，请重新打开');
      const buffers = new Map(Array.from(A.state.filesMap, ([key, file]) => [key, { ...file, history: undefined }]));
      async function read(filePath) {
        if (workspace !== A.api.token) throw new Error('工作区已切换，请重新打开');
        if (buffers.has(filePath)) return buffers.get(filePath).current;
        const response = await A.api.request('/api/file?path=' + encodeURIComponent(filePath));
        if (!response.ok) throw new Error(filePath + '：' + await A.api.error(response));
        return response.text();
      }
      const content = await read(path);
      let map;
      if (/\.ditamap$/i.test(path)) {
        const response = await A.api.request('/api/map/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, content }) });
        if (!response.ok) throw new Error(await A.api.error(response));
        map = await response.json(); map.source = content;
      } else map = { title: path.split('/').pop(), path, children: [{ type: 'file', path }] };
      const files = new Map();
      for (const entry of A.ditaCore.collectPreviewPaths(map.children || [])) files.set(entry.path, { path: entry.path, current: await read(entry.path) });
      const loaded = await resolver.loadDependencies(files, read);
      const snapshot = { capturedAt: new Date().toISOString(), path, content, map, files: loaded, workspace, buffers, project: A.project?.value || { schema: 1, models: [] }, projectError: A.project?.error, projectContent: A.project?.expectedContent, root: A.state.root, branch: A.state.currentBranch };
      if (!current(snapshot)) throw new Error('内容已变化，请重新打开以更新快照');
      return snapshot;
    }
    function current(snapshot) {
      if (!snapshot || snapshot.workspace !== A.api.token || snapshot.root !== A.state.root || snapshot.branch !== A.state.currentBranch || snapshot.projectContent !== A.project?.expectedContent) return false;
      const entries = [[snapshot.path, snapshot.content], ...Array.from(snapshot.files, ([path, file]) => [path, file.current])];
      return entries.every(([path, content]) => {
        const file = A.state.filesMap.get(path);
        return file ? file.current === content && (!snapshot.buffers.has(path) || file.disk === snapshot.buffers.get(path).disk) : !snapshot.buffers.has(path);
      });
    }
    function prepare(snapshot, model = '', validateProject = true) {
      const errors = [];
      if (snapshot.projectError) errors.push({ path: '.dita-project.json', message: snapshot.projectError });
      if (model && snapshot.project.models.length && !snapshot.project.models.includes(model)) errors.push({ path: snapshot.path, message: '型号不在项目清单中：' + model });
      for (const [path, file] of snapshot.files) {
        try {
          resolver.walk(xml.inspectSource(file.current), node => {
            const value = domain.decode(node.attrs.product);
            if (/[()]/.test(value)) return;
            const unknown = domain.checkModels(value.split(/\s+/).filter(Boolean), snapshot.project);
            if (unknown.length) errors.push({ path, message: '未登记型号：' + unknown.join('、') });
          });
        } catch (error) { errors.push({ path, message: error.message }); }
      }
      if (validateProject && errors.length) throw Object.assign(new Error(errors.map(item => item.path + '：' + item.message).join('\n')), { issues: errors });
      return publication.preparePublication({ map: snapshot.map, files: snapshot.files, model }, A.ditaCore.collectPreviewPaths);
    }
    function listNotes(snapshot, model = '') {
      const data = prepare(snapshot, model, false), originals = new Map();
      const notes = data.notes.map((published, index) => {
        const origin = published.origin;
        if (!originals.has(origin.path)) originals.set(origin.path, notesCore.listFootnotes(snapshot.files.get(origin.path).current, origin.path));
        const source = originals.get(origin.path).find(note => note.start === origin.start);
        if (!source) throw new Error('无法定位引用源：' + origin.path);
        const rendered = notesCore.listFootnotes(published.xml)[0];
        return { ...source, sourceNote: source, index, text: rendered.text, conditions: published.conditions, common: published.common,
          unmarked: published.unmarked, reused: Boolean(published.key) || published.path !== origin.path || source.referenced, publicationPath: published.path };
      });
      return { notes, report: data.report };
    }
    function saveCandidates(snapshot) {
      return [...new Set([snapshot.path, ...snapshot.files.keys()])].map(path => snapshot.buffers.get(path)).filter(file => file?.dirty);
    }
    return { capture, current, prepare, listNotes, saveCandidates, listModels: snapshot => publication.listModels(snapshot.files),
      scopePath: () => /\.ditamap$/i.test(A.state.activePath) ? A.state.activePath : A.state.selectedMap || A.state.activePath };
  }
  const api = { createManualService };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaManualService = api;
})(typeof window === 'undefined' ? globalThis : window);

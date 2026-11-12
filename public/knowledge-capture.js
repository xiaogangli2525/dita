'use strict';
(function (root) {
  function createCapture(A) {
    async function collect(path, { model, version = '', filterPath = '', prefixes = false }, signal) {
      const workspace = A.api.token;
      const snapshot = await A.manual.capture(path, { filterPath });
      function check() {
        if (signal?.aborted) throw new Error('已取消加入手册');
        if (workspace !== A.api.token || !A.manual.current(snapshot)) throw new Error('文档或工作区已变化，请重新加入手册');
      }
      check();
      const unsaved = A.manual.saveCandidates(snapshot);
      if (unsaved.length) throw new Error('请先保存手册中的修改：' + unsaved.map(file => file.path).join('、'));
      const prepared = A.manual.prepare(snapshot, model, true, { prefixes });
      if (prepared.noteReview?.length) throw new Error(prepared.noteReview.some(item => item.kind === 'prefix') ? '有型号注脚需核对：请启用明确型号前缀筛选，或先在“交付手册”中确认独立规则。' : '有型号注脚范围需逐段确认，请先在“交付手册”中处理独立规则。');
      // Model selection scopes footnotes; DITAVAL scopes the body. Refuse a
      // remaining explicitly different model instead of indexing hidden text.
      function checkProducts(path, content) {
        const doc = A.ditaCore.parseXml(content);
        for (const node of doc.querySelectorAll('[product]')) {
          const values = node.getAttribute('product').trim().split(/\s+/), models = values.filter(root.DitaModelDiscovery.isModel);
          if (models.length && !values.includes(model)) throw new Error(path + '：仍有明确属于其它型号的正文，请选择能排除这些内容的 DITAVAL 后重新加入。');
        }
      }
      for (const entry of A.ditaCore.collectPreviewPaths(snapshot.map.children || [])) {
        const file = prepared.files.get(entry.path);
        if (file && !file.excluded) checkProducts(entry.path, file.current);
      }
      for (const note of prepared.noteDefinitions.values()) checkProducts(note.path, note.xml);
      await A.manual.verifyRules(snapshot); check();
      async function loadImageBytes(imagePath) {
        check();
        const response = await A.api.request('/api/asset?path=' + encodeURIComponent(imagePath), { signal });
        if (!response.ok) throw new Error('图片加载失败：' + imagePath);
        const blob = await response.blob();
        if (blob.size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB：' + imagePath);
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('图片读取失败：' + imagePath)); reader.readAsDataURL(blob); });
        const image = new Image(); image.src = data; let timer;
        try { await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('图片解码超时：' + imagePath)), 10000); })]); }
        finally { clearTimeout(timer); }
        check(); return data;
      }
      const topicTitle = !/\.ditamap$/i.test(snapshot.path) && [...A.ditaCore.parseXml(snapshot.content).documentElement.childNodes].find(node => node.localName === 'title')?.textContent?.trim();
      const title = topicTitle || snapshot.map.title || snapshot.path;
      const html = await A.ditaCore.exportMapToHtml({ map: snapshot.map, files: snapshot.files, title, model, version, publicationData: prepared, loadImageBytes });
      await A.manual.verifyRules(snapshot); check();
      // Catch disk changes to closed Topics too, before sealing the capture.
      const sources = new Map([[snapshot.path, snapshot.content], ...[...snapshot.files].map(([name, file]) => [name, file.current])]);
      if (snapshot.filter) sources.set(snapshot.filter.path, snapshot.filter.current);
      for (const [name, content] of sources) {
        const response = await A.api.request('/api/file?path=' + encodeURIComponent(name), { signal });
        if (!response.ok || await response.text() !== content) throw new Error('源文件已变化或无法读取，请刷新后重新加入：' + name);
        check();
      }
      const hash = root.DitaBrowserFiles.sha256;
      let provenance = { commit: null, branch: snapshot.branch, dirty: null };
      try {
        const response = await A.api.request('/api/provenance', { signal });
        if (!response.ok) throw Error(await A.api.error(response));
        provenance = await response.json();
      } catch (error) { check(); console.warn('知识库来源信息不可用：', error.name); }
      const id = 'm-' + (await hash(snapshot.root + '\n' + snapshot.path)).slice(0, 16);
      const extracted = root.DitaKnowledgeDocument.extractManual(html, id);
      const visible = A.ditaCore.collectPreviewPaths(snapshot.map.children || []).filter(entry => !prepared.files.get(entry.path)?.excluded);
      if (visible.length !== extracted.entries.length) throw new Error('发布章节与来源映射不一致');
      const engine = root.DitaKnowledgeSearch.createSearchEngine();
      for (const [index, entry] of extracted.entries.entries()) {
        entry.sourcePath = visible[index].path; entry.fingerprint = await hash(entry.title + '\n' + entry.text);
        entry.kind = /示例|example/i.test(entry.title) ? 'example' : /AT\+|参数|命令|接口/i.test(entry.title) ? 'reference' : 'guide';
        Object.assign(entry, engine.metadata({ ...entry, manualId: id }));
      }
      const documents = await Promise.all([...sources].map(async ([name, content]) => ({ path: name, sha256: await hash(content) })));
      check();
      const source = { repository: snapshot.root.split(/[\\/]/).filter(Boolean).pop(), branch: snapshot.branch, commit: provenance.commit || null, dirty: provenance.dirty,
        manualPath: snapshot.path, documents, filterPath, filterSha256: snapshot.filter ? await hash(snapshot.filter.current) : null,
        projectSha256: snapshot.projectContent ? await hash(snapshot.projectContent) : null,
        noteRulesSha256: snapshot.noteRules?.expectedContent ? await hash(snapshot.noteRules.expectedContent) : null,
        modelNotePolicy: prefixes ? 'explicit-prefix-v1' : 'sidecar-only' };
      const oxygenRevisions = [...snapshot.files.values()].reduce((count, file) => count + (A.ditaCore.collectOxyTrackedChanges?.(file.current).length || 0), 0);
      const part = { id, model, version, title, html, ...extracted, source, report: { ...prepared.report, oxygenRevisions },
        htmlSha256: await hash(html), capturedAt: new Date().toISOString() };
      check();
      return { part, current: () => workspace === A.api.token && A.manual.current(snapshot) };
    }
    return { collect };
  }
  const api = { createCapture };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeCapture = api;
})(typeof window === 'undefined' ? globalThis : window);

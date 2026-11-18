// @ts-check
'use strict';
(function (root) {
  const reader = typeof module !== 'undefined' ? require('./knowledge-reader') : root.DitaKnowledgeReader;
  const search = typeof module !== 'undefined' ? require('./knowledge-search') : root.DitaKnowledgeSearch;
  const zip = typeof module !== 'undefined' ? require('./knowledge-zip') : root.DitaKnowledgeZip;
  const limits = typeof module !== 'undefined' ? require('./knowledge-limits') : root.DitaKnowledgeLimits;
  const semanticData = typeof module !== 'undefined' ? require('./knowledge-semantic') : root.DitaKnowledgeSemantic;
  /** @param {import('./knowledge-contracts').KnowledgeRequest} request
   * @param {(progress:import('./knowledge-contracts').PublishProgress)=>void} [onProgress]
   * @param {{takeOwnership?:boolean}} [options] The Worker already owns a structured clone. */
  function preparePackage({ title, model, sdkVersion, manuals, generatedAt = new Date().toISOString() }, onProgress = () => {}, { takeOwnership = false } = {}) {
    onProgress({ stage: 'validate' });
    title = String(title || '').trim(); model = String(model || '').trim(); sdkVersion = String(sdkVersion || '').trim();
    if (!title || title.length > 160 || !sdkVersion || sdkVersion.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(model)) throw new Error('请填写标题、有效型号和 SDK 版本');
    if (!manuals?.length || manuals.length > 30) throw new Error('请加入 1～30 份手册');
    const ids = new Set(); let size = 0;
    for (const manual of manuals) {
      if (!/^m-[a-f0-9]{12,64}$/.test(manual.id) || ids.has(manual.id) || manual.model !== model || !manual.entries?.length || !manual.body || !manual.html) throw new Error('手册型号、内容或标识不一致，请重新加入');
      if (manual.staleMetadata?.length) throw new Error('检索属性已过期，请在集合中核对：' + manual.title);
      ids.add(manual.id); size += zip.textBytes(manual.html) + zip.textBytes(manual.body) + zip.textBytes(JSON.stringify(manual.entries));
    }
    if (size > limits.SOURCE_BYTES) throw new Error('本版知识库内容超过 40 MB，请减少手册后重试');
    if (!takeOwnership) manuals = structuredClone(manuals);
    /** @template T @param {T} value @returns {T} */
    function freeze(value) {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
      return value;
    }
    const manifest = { schema: 1, title, model, sdkVersion, generatedAt, renderer: 'offline-knowledge-v1', search: { schema: 2, engine: 'sdk-search-1.2.2' },
      manuals: manuals.map(manual => ({ id: manual.id, title: manual.title, version: manual.version, model, capturedAt: manual.capturedAt,
        mode: manual.mode || 'other', module: manual.module || manual.title, searchEntries: manual.entries.map(entry => ({ sourcePath: entry.sourcePath || '', fingerprint: entry.fingerprint || '', kind: entry.kind || 'guide', aliases: entry.aliases || [], definedSymbols: entry.definedSymbols || [] })),
        file: 'manuals/' + manual.id + '.html', chapters: manual.entries.length, source: manual.source, report: manual.report, htmlSha256: manual.htmlSha256 })) };
    /** @type {import('./knowledge-contracts').KnowledgeBook} */
    const book = { schema: 1, title, model, sdkVersion, generatedAt, index: { schema: 2, compiled: {} }, manuals: manuals.map(manual => ({ id: manual.id, title: manual.title,
      version: manual.version, mode: manual.mode || 'other', module: manual.module || manual.title, body: manual.body, toc: manual.toc, entries: manual.entries,
      source: { repository: manual.source.repository, commit: manual.source.commit, dirty: manual.source.dirty } })) };
    const records = book.manuals.flatMap(manual => manual.entries.map(entry => ({ ...entry, manualId: manual.id, manualTitle: manual.title, mode: manual.mode, module: manual.module })));
    onProgress({ stage: 'index' });
    book.index = search.createSearchEngine().build(records);
    freeze(book); freeze(manifest); freeze(manuals);
    onProgress({ stage: 'render' });
    const html = reader.renderPage(book);
    /** @param {import('./knowledge-semantic').SemanticIndex} [semantic] */
    function filesFor(semantic) {
      const finalManifest = semantic ? freeze({ ...manifest, semantic: { profile: structuredClone(semantic.profile), chunks: semantic.chunks.length } }) : manifest;
      // CLI data contains chapter text and provenance; its index is built at query time.
      const cliBook = { schema: book.schema, title: book.title, model: book.model, sdkVersion: book.sdkVersion,
        generatedAt: book.generatedAt, ...(semantic ? { semantic } : {}), manuals: book.manuals.map(manual => ({
          id: manual.id, title: manual.title, version: manual.version, mode: manual.mode, module: manual.module,
          entries: manual.entries, source: manual.source
        })) };
      const files = [{ name: 'docs/index.html', content: html }, { name: 'docs/manifest.json', content: JSON.stringify(finalManifest, null, 2) },
        { name: 'docs/knowledge.json', content: JSON.stringify(cliBook) },
        { name: 'docs/README.txt', content: '打开 index.html 即可离线阅读和搜索。CLI 可直接读取本包 ZIP 或解压目录。请整体移动 docs 文件夹。\n型号：' + model + '\nSDK：' + sdkVersion + '\n本包不自动更新。来源和版本见 manifest.json。\n' },
        ...manuals.map(manual => ({ name: 'docs/manuals/' + manual.id + '.html', content: manual.html }))];
      return { files, manifest: finalManifest };
    }
    const baseline = filesFor();
    const baselineBytes = zip.measureFiles(baseline.files);
    // The uncompressed budget excludes semantic JSON and the decimal chunk count.
    // The server adds these from its prepared chunks before starting inference.
    function archiveOverhead() {
      const nextManifest = { ...manifest, semantic: { profile: semanticData.PROFILE, chunks: 0 } };
      return baselineBytes + zip.textBytes(JSON.stringify(nextManifest, null, 2)) - zip.textBytes(baseline.files[1].content) + zip.textBytes(',"semantic":') - 1;
    }
    /** @param {{profile:import('./knowledge-semantic').SemanticIndex['profile'],chunks:number,bytes:number}} [estimate] */
    function measure(estimate) {
      let bytes = baselineBytes;
      if (estimate) {
        if (JSON.stringify(estimate.profile) !== JSON.stringify(semanticData.PROFILE) || !Number.isSafeInteger(estimate.chunks) || estimate.chunks < 0 || estimate.chunks > 12000 || !Number.isSafeInteger(estimate.bytes) || estimate.bytes < 0) throw Error('语义容量核算结果无效');
        bytes = archiveOverhead() + String(estimate.chunks).length + estimate.bytes;
      }
      onProgress({ stage: 'capacity', bytes, limit: limits.ARCHIVE_BYTES });
      limits.assertReadable(bytes, '知识库 ZIP');
      return { bytes, limit: limits.ARCHIVE_BYTES, sourceBytes: size };
    }
    /** @param {import('./knowledge-semantic').SemanticIndex} [semantic] */
    function build(semantic) {
      onProgress({ stage: 'verify' });
      if (semantic) semanticData.validate(records, semantic);
      const result = semantic ? filesFor(semantic) : baseline;
      const bytes = zip.measureFiles(result.files);
      onProgress({ stage: 'capacity', bytes, limit: limits.ARCHIVE_BYTES });
      limits.assertReadable(bytes, '知识库 ZIP');
      onProgress({ stage: 'archive', done: 0, total: result.files.length });
      const archive = zip.createZip(result.files, (done, total) => onProgress({ stage: 'archive', done, total }));
      const safe = (/** @type {string} */ value) => value.replace(/[^\p{L}\p{N}._-]/gu, '-');
      return { html, manifest: result.manifest, book, zip: archive, filename: safe(model) + '-SDK-' + safe(sdkVersion) + '-knowledge-base.zip' };
    }
    return { html, book, manuals, build, measure, archiveOverhead };
  }

  /** @param {import('./knowledge-contracts').KnowledgeRequest} request */
  function buildPackage(request) { return preparePackage(request).build(request.semantic); }
  const api = { preparePackage, buildPackage };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgePackage = api;
})(typeof window === 'undefined' ? globalThis : window);


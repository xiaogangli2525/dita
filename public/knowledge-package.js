// @ts-check
'use strict';
(function (root) {
  const reader = typeof module !== 'undefined' ? require('./knowledge-reader') : root.DitaKnowledgeReader;
  const search = typeof module !== 'undefined' ? require('./knowledge-search') : root.DitaKnowledgeSearch;
  const zip = typeof module !== 'undefined' ? require('./knowledge-zip') : root.DitaKnowledgeZip;
  /** @param {import('./knowledge-contracts').KnowledgeRequest} request */
  function buildPackage({ title, model, sdkVersion, manuals, generatedAt = new Date().toISOString() }) {
    title = String(title || '').trim(); model = String(model || '').trim(); sdkVersion = String(sdkVersion || '').trim();
    if (!title || title.length > 160 || !sdkVersion || sdkVersion.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(model)) throw new Error('请填写标题、有效型号和 SDK 版本');
    if (!manuals?.length || manuals.length > 30) throw new Error('请加入 1～30 份手册');
    const ids = new Set(); let size = 0;
    for (const manual of manuals) {
      if (!/^m-[a-f0-9]{12,64}$/.test(manual.id) || ids.has(manual.id) || manual.model !== model || !manual.entries?.length || !manual.body || !manual.html) throw new Error('手册型号、内容或标识不一致，请重新加入');
      if (manual.staleMetadata?.length) throw new Error('检索属性已过期，请在集合中核对：' + manual.title);
      ids.add(manual.id); size += new TextEncoder().encode(manual.html + manual.body + JSON.stringify(manual.entries)).length;
    }
    if (size > 40 * 1024 * 1024) throw new Error('本版知识库内容超过 40 MB，请减少手册后重试');
    manuals = structuredClone(manuals);
    /** @template T @param {T} value @returns {T} */
    function freeze(value) {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
      return value;
    }
    const manifest = { schema: 1, title, model, sdkVersion, generatedAt, renderer: 'offline-knowledge-v1', search: { schema: 2, engine: 'sdk-search-1.2.0' },
      manuals: manuals.map(manual => ({ id: manual.id, title: manual.title, version: manual.version, model, capturedAt: manual.capturedAt,
        mode: manual.mode || 'other', module: manual.module || manual.title, searchEntries: manual.entries.map(entry => ({ sourcePath: entry.sourcePath || '', fingerprint: entry.fingerprint || '', kind: entry.kind || 'guide', aliases: entry.aliases || [], definedSymbols: entry.definedSymbols || [] })),
        file: 'manuals/' + manual.id + '.html', chapters: manual.entries.length, source: manual.source, report: manual.report, htmlSha256: manual.htmlSha256 })) };
    /** @type {import('./knowledge-contracts').KnowledgeBook} */
    const book = { schema: 1, title, model, sdkVersion, generatedAt, index: { schema: 2, compiled: {} }, manuals: manuals.map(manual => ({ id: manual.id, title: manual.title,
      version: manual.version, mode: manual.mode || 'other', module: manual.module || manual.title, body: manual.body, toc: manual.toc, entries: manual.entries,
      source: { repository: manual.source.repository, commit: manual.source.commit, dirty: manual.source.dirty } })) };
    const records = book.manuals.flatMap(manual => manual.entries.map(entry => ({ ...entry, manualId: manual.id, manualTitle: manual.title, mode: manual.mode, module: manual.module })));
    book.index = search.createSearchEngine().build(records);
    freeze(book); freeze(manifest);
    const html = reader.renderPage(book);
    const files = [{ name: 'docs/index.html', content: html }, { name: 'docs/manifest.json', content: JSON.stringify(manifest, null, 2) },
      { name: 'docs/README.txt', content: '打开 index.html 即可离线阅读和搜索。请整体移动 docs 文件夹。\n型号：' + model + '\nSDK：' + sdkVersion + '\n本包不自动更新。来源和版本见 manifest.json。\n' },
      ...manuals.map(manual => ({ name: 'docs/manuals/' + manual.id + '.html', content: manual.html }))];
    /** @param {string} value */
    const safe = value => value.replace(/[^\p{L}\p{N}._-]/gu, '-');
    return { html, manifest, book, zip: zip.createZip(files), filename: safe(model) + '-SDK-' + safe(sdkVersion) + '-knowledge-base.zip' };
  }
  const api = { buildPackage };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgePackage = api;
})(typeof window === 'undefined' ? globalThis : window);

'use strict';
const semantic = require('./knowledge-semantic');
const data = require('../public/knowledge-semantic');
const { ASSETS } = require('./semantic-encoder');
const { flatten } = require('./knowledge-book');
const { createVectorCache, aborted } = require('./knowledge-vector-cache');
const { ARCHIVE_BYTES, assertReadable } = require('../public/knowledge-limits');
const encoding = JSON.stringify([require('../package.json').dependencies['@huggingface/transformers'], ASSETS]);
function createIndexBuilder({ cache = createVectorCache({ encoding }), generate = semantic.build, generateChunks = semantic.buildChunks, chunksFor = semantic.encoder.chunksFor } = {}) {
  const jobs = new Map();
  function recordsFor(manual) {
    if (!manual || typeof manual.id !== 'string' || !manual.id || typeof manual.title !== 'string' || !Array.isArray(manual.entries) || !manual.entries.length) throw Error('手册向量来源无效');
    return flatten({ manuals: [manual] });
  }
  function subscribe(key, records, model, profile, options, chunks) {
    let job = jobs.get(key);
    if (!job || job.controller.signal.aborted) {
      job = { controller: new AbortController(), listeners: new Set() }; jobs.set(key, job);
      const current = job;
      current.promise = Promise.resolve().then(async () => {
        const index = await (chunks ? generateChunks : generate)(chunks || records, (done, total) => { for (const listener of current.listeners) listener.progress?.({ done, total }); }, { legacy: profile.id === data.LEGACY_PROFILE.id, signal: current.controller.signal });
        aborted(current.controller.signal); data.validate(records, index);
        if (index.profile.id !== profile.id) throw Error('向量生成配置不一致');
        const saved = await cache.put(records, model, profile, index, { signal: current.controller.signal });
        return { index, warnings: saved.warnings };
      }).then(value => ({ value }), error => ({ error })).finally(() => { if (jobs.get(key) === current) jobs.delete(key); });
    }
    return new Promise((resolve, reject) => {
      const listener = { progress: options.onProgress }; job.listeners.add(listener);
      function leave() { options.signal?.removeEventListener('abort', cancel); job.listeners.delete(listener); }
      function cancel() { leave(); if (!job.listeners.size) job.controller.abort(); reject(Object.assign(Error('已取消向量生成'), { name: 'AbortError' })); }
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) { cancel(); return; }
      job.promise.then(result => { leave(); if (options.signal?.aborted) return; if (result.error) reject(result.error); else resolve(result.value); });
    });
  }
  async function manual(manual, options = {}) {
    const { model = '', legacy = false, force = false, seed } = options, profile = legacy ? data.LEGACY_PROFILE : data.PROFILE;
    aborted(options.signal); const records = recordsFor(manual), key = cache.key(records, model, profile);
    let warnings = [];
    if (!force && seed) {
      try {
        data.validate(records, seed); if (seed.profile.id !== profile.id) throw Error('分片配置已更新');
        const saved = await cache.put(records, model, profile, seed, { signal: options.signal });
        return { index: seed, source: 'embedded', warnings: saved.warnings };
      } catch (cause) { if (cause.name === 'AbortError') throw cause; warnings.push('已有向量与当前手册不一致，已检查缓存或重新生成。'); }
    }
    if (!force) {
      const cached = await cache.get(records, model, profile); aborted(options.signal); warnings.push(...cached.warnings);
      if (cached.index) return { index: cached.index, source: 'cache', warnings };
    }
    aborted(options.signal);
    const result = await subscribe(key, records, model, profile, options);
    aborted(options.signal); return { ...result, source: 'generated', warnings: [...warnings, ...result.warnings] };
  }
  function seedsFrom(books, profile, warnings) {
    const seeds = new Map();
    for (const book of books) {
      if (!book.semantic || book.semantic.profile?.id !== profile.id) continue;
      try {
        const rows = data.validate(flatten(book), book.semantic); let offset = 0;
        for (const source of book.manuals) {
          const selected = book.semantic.chunks.flatMap((chunk, i) => chunk.position >= offset && chunk.position < offset + source.entries.length ? [{ chunk, i }] : []);
          const index = data.createIndex(selected.map(({ chunk }) => ({ ...chunk, position: chunk.position - offset })), selected.map(({ i }) => Array.from(rows.subarray(i * profile.dimensions, (i + 1) * profile.dimensions))), profile);
          seeds.set(cache.key(recordsFor(source), book.model, profile), index); offset += source.entries.length;
        }
      } catch (cause) { warnings.push('已有向量校验失败，改用当前正文重新检查或生成：' + cause.message); }
    }
    return seeds;
  }
  async function book(book, options = {}) {
    if (!book?.manuals?.length || book.manuals.length > 30 || new Set(book.manuals.map(item => item.id)).size !== book.manuals.length) throw Error('知识库手册数量或标识无效');
    const warnings = [], profile = options.legacy ? data.LEGACY_PROFILE : data.PROFILE, seeds = options.force ? new Map() : seedsFrom(options.seeds || [book], profile, warnings);
    const indexes = [], stats = { reusedManuals: 0, rebuiltManuals: 0, totalManuals: book.manuals.length, totalChunks: 0 };
    for (const [i, source] of book.manuals.entries()) {
      const result = await manual(source, { ...options, model: book.model, seed: seeds.get(cache.key(recordsFor(source), book.model, profile)),
        onProgress: progress => options.onProgress?.({ ...progress, manual: source.title, position: i + 1, totalManuals: book.manuals.length }) });
      indexes.push(result.index); warnings.push(...result.warnings); stats[result.source === 'generated' ? 'rebuiltManuals' : 'reusedManuals']++;
      options.onProgress?.({ manual: source.title, position: i + 1, totalManuals: book.manuals.length, source: result.source });
    }
    const index = data.combineIndexes(book.manuals.map(recordsFor), indexes); stats.totalChunks = index.chunks.length;
    return { index, stats, warnings: [...new Set(warnings)] };
  }
  async function prepare(book, options, retain) {
    if (!book?.manuals?.length || book.manuals.length > 30 || new Set(book.manuals.map(item => item.id)).size !== book.manuals.length) throw Error('知识库手册数量或标识无效');
    const profile = data.PROFILE, plan = []; let offset = 0, count = 0;
    let bytes = Buffer.byteLength(JSON.stringify({ schema: 1, profile, chunks: [], vectors: '' }));
    for (const [i, manual] of book.manuals.entries()) {
      aborted(options.signal);
      options.onProgress?.({ manual: manual.title, position: i + 1, totalManuals: book.manuals.length });
      const records = recordsFor(manual);
      const cached = options.force ? { index: null, warnings: [] } : await cache.get(records, book.model, profile);
      aborted(options.signal);
      const selected = cached.index?.chunks || await chunksFor(records, { signal: options.signal });
      aborted(options.signal);
      if (count + selected.length > 12000) throw Error('语义索引超过 12000 个片段，请减少手册后重试');
      for (const chunk of selected) bytes += Buffer.byteLength(JSON.stringify({ ...chunk, position: chunk.position + offset })) + (count++ ? 1 : 0);
      if (retain) plan.push({ manual, records, chunks: selected, cached });
      offset += records.length;
    }
    // Float32 vectors are encoded as one base64 matrix after rebasing positions.
    // Tokenization is sufficient for this exact byte budget; no inference runs.
    bytes += 4 * Math.ceil(count * profile.dimensions * 4 / 3);
    return { estimate: { profile, chunks: count, bytes }, plan };
  }
  async function estimate(book, options = {}) { return (await prepare(book, options, false)).estimate; }
  async function publish(book, options = {}) {
    const { archiveOverhead, onEstimate = () => {}, onManual = () => {} } = options;
    if (!Number.isSafeInteger(archiveOverhead) || archiveOverhead < 0 || archiveOverhead > ARCHIVE_BYTES) throw Error('知识库容量预算无效');
    // The plan lives only for this request: no cross-request token/session cache.
    const { estimate, plan } = await prepare(book, { ...options, onProgress: info => options.onProgress?.({ stage: 'estimate', ...info }) }, true);
    const bytes = archiveOverhead + String(estimate.chunks).length + estimate.bytes;
    await onEstimate(estimate); aborted(options.signal);
    assertReadable(bytes, '知识库 ZIP');
    const stats = { reusedManuals: 0, rebuiltManuals: 0, totalManuals: plan.length, totalChunks: 0 }, warnings = [];
    for (let i = 0; i < plan.length; i++) {
      aborted(options.signal);
      const item = plan[i], progress = info => options.onProgress?.({ ...stats, stage: 'vectors', manual: item.manual.title, position: i + 1, ...info });
      progress({});
      const result = item.cached.index ? { index: item.cached.index, warnings: [], source: 'cache' } : {
        ...await subscribe(cache.key(item.records, book.model, data.PROFILE), item.records, book.model, data.PROFILE,
          { signal: options.signal, onProgress: progress }, item.chunks), source: 'generated'
      };
      aborted(options.signal);
      stats[result.source === 'generated' ? 'rebuiltManuals' : 'reusedManuals']++; stats.totalChunks += result.index.chunks.length;
      warnings.push(...item.cached.warnings, ...result.warnings);
      await onManual({ manualId: item.manual.id, index: result.index, source: result.source });
      progress({ source: result.source });
      plan[i] = null; // Release each manual's vectors/chunks after streaming it.
    }
    aborted(options.signal);
    return { stats, warnings: [...new Set(warnings)] };
  }
  return { manual, book, recordsFor, estimate, publish };
}
let shared;
const defaultBuilder = () => shared || (shared = createIndexBuilder());
module.exports = { createIndexBuilder, defaultBuilder };

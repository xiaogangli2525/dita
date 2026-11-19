'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { createIndexBuilder } = require('../lib/knowledge-index');
const { createVectorCache } = require('../lib/knowledge-vector-cache');
const data = require('../public/knowledge/knowledge-semantic'), { flatten } = require('../lib/knowledge-book');
const manual = id => ({ id, title: '手册' + id, entries: [{ title: '参数说明', anchor: id + '-topic', text: '参数定义与设置示例。' }] });
const book = (...manuals) => ({ schema: 1, title: '开发者知识库', model: 'ML307G', sdkVersion: 'v1', manuals });
async function generate(records, progress, { legacy = false, signal } = {}) {
  if (signal?.aborted) throw Object.assign(Error('cancelled'), { name: 'AbortError' });
  const chunks = await (legacy ? data.legacyChunksFor : data.chunksFor)(records, text => text.length + 2);
  progress(chunks.length, chunks.length);
  return data.createIndex(chunks, chunks.map(() => [1, ...Array(511).fill(0)]), legacy ? data.LEGACY_PROFILE : data.PROFILE);
}
async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-vector-cache-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const logs = [], cache = createVectorCache({ directory, encoding: 'test-runtime-v1', logger: { warn: (...values) => logs.push(values) }, ...options });
  let calls = 0;
  const builder = createIndexBuilder({ cache, generate: async (...args) => { calls++; return generate(...args); } });
  return { cache, builder, directory, logs, calls: () => calls };
}
test('manual vectors persist across builders and changing one manual rebuilds only that manual', async t => {
  const ctx = await setup(t), a = manual('a'), b = manual('b'), first = await ctx.builder.book(book(a, b));
  assert.deepEqual(first.stats, { reusedManuals: 0, rebuiltManuals: 2, totalManuals: 2, totalChunks: 2 });
  const second = await createIndexBuilder({ cache: ctx.cache, generate: () => { throw Error('must not infer'); } }).book(book(a, b));
  assert.equal(second.stats.reusedManuals, 2); assert.deepEqual(second.index, first.index);
  b.entries[0].text += '修改参数。';
  const third = await ctx.builder.book(book(a, b)); assert.equal(third.stats.reusedManuals, 1); assert.equal(third.stats.rebuiltManuals, 1); assert.equal(ctx.calls(), 3);
  data.validate(flatten(book(a, b)), third.index);
});
test('cache keys bind model, profile, encoder, notes and locations but ignore delivery metadata', async t => {
  const { builder, cache, directory, calls } = await setup(t), a = manual('a'), current = book(a);
  await builder.book(current);
  Object.assign(a, { version: 'new', capturedAt: 'today', mode: 'AT', module: 'HTTP', source: { commit: 'new', dirty: true } });
  a.entries[0].aliases = ['新别名']; current.sdkVersion = 'v2'; current.generatedAt = 'new';
  assert.equal((await builder.book(current)).stats.reusedManuals, 1); assert.equal(calls(), 1);
  const changedModel = { ...current, model: 'ML307N' }; assert.equal((await builder.book(changedModel)).stats.rebuiltManuals, 1);
  assert.equal((await builder.book(current, { legacy: true })).stats.rebuiltManuals, 1);
  const runtime = createVectorCache({ directory, encoding: 'test-runtime-v2' });
  assert.notEqual(runtime.key(flatten(current), current.model, data.PROFILE), cache.key(flatten(current), current.model, data.PROFILE));
  for (const field of ['anchor', 'sourcePath', 'title']) { const clone = structuredClone(current); clone.manuals[0].entries[0][field] = 'changed'; assert.notEqual(cache.key(flatten(clone), current.model, data.PROFILE), cache.key(flatten(current), current.model, data.PROFILE)); }
  const structure = { schema: 1, units: [{ id: 'u', kind: 'paragraph', text: '说明', notes: [{ id: 'n', text: '适用范围' }] }] };
  const records = flatten(current); records[0].structure = structure;
  const before = cache.key(records, current.model, data.PROFILE); records[0].structure.units[0].notes[0].text += '变化';
  assert.notEqual(cache.key(records, current.model, data.PROFILE), before);
});
test('adding, removing and reordering manuals rebases positions without carrying stale metadata', async t => {
  const ctx = await setup(t), a = manual('a'), b = manual('b'), c = manual('c');
  await ctx.builder.book(book(a, b));
  const fresh = book(b, c, a); fresh.sdkVersion = 'new'; a.source = { commit: 'new' };
  const result = await ctx.builder.book(fresh); assert.equal(result.stats.reusedManuals, 2); assert.equal(result.stats.rebuiltManuals, 1);
  assert.deepEqual(result.index.chunks.map(chunk => [chunk.position, chunk.manualId]), [[0, 'b'], [1, 'c'], [2, 'a']]);
  assert.equal(fresh.manuals[2].source.commit, 'new'); assert.equal(fresh.sdkVersion, 'new');
  data.validate(flatten(fresh), result.index);
  const removed = await ctx.builder.book(book(c)); assert.equal(removed.index.chunks.length, 1); assert.equal(removed.index.chunks[0].manualId, 'c');
});
test('complete compatible manual packs combine with zero model inference and refresh cache', async t => {
  const ctx = await setup(t), a = book(manual('a')), b = book(manual('b'));
  a.semantic = await generate(flatten(a), () => {}); b.semantic = await generate(flatten(b), () => {});
  const combined = book(b.manuals[0], a.manuals[0]);
  const result = await ctx.builder.book(combined, { seeds: [a, b] });
  assert.equal(result.stats.reusedManuals, 2); assert.equal(ctx.calls(), 0); data.validate(flatten(combined), result.index);
  const cached = await ctx.builder.book(combined); assert.equal(cached.stats.reusedManuals, 2); assert.equal(ctx.calls(), 0);
  const forced = await ctx.builder.book(combined, { seeds: [a, b], force: true }); assert.equal(forced.stats.rebuiltManuals, 2); assert.equal(ctx.calls(), 2);
});
test('compact archives are searchable inputs but do not seed the exact Float32 build cache', async t => {
  const ctx = await setup(t), source = book(manual('a')), records = flatten(source);
  const original = await generate(records, () => {});
  source.semantic = data.compactIndex(records, original);
  assert.ok(data.validate(records, source.semantic).length);
  await assert.rejects(ctx.cache.put(records, source.model, data.PROFILE, source.semantic), /Float32/);
  const build = await ctx.builder.book(source);
  assert.equal(build.stats.rebuiltManuals, 1);
  assert.equal(ctx.calls(), 1);
  assert.deepEqual(build.index, original);
  const repeat = await ctx.builder.book(source);
  assert.equal(repeat.stats.reusedManuals, 1);
  assert.equal(ctx.calls(), 1);
});
test('corrupt, truncated and symlink cache files are rebuilt, with no partial files left behind', async t => {
  const ctx = await setup(t), current = book(manual('a')), records = flatten(current);
  const file = path.join(ctx.directory, 'manual-' + ctx.cache.key(records, current.model, data.PROFILE) + '.json');
  await ctx.builder.book(current);
  for (const corrupt of ['{', JSON.stringify({ schema: 1, key: 'wrong', index: {} })]) {
    await fs.writeFile(file, corrupt); const result = await ctx.builder.book(current);
    assert.equal(result.stats.rebuiltManuals, 1); assert.ok(result.warnings.length); data.validate(records, result.index);
  }
  const unrelated = path.join(ctx.directory, 'unrelated.txt'); await fs.writeFile(unrelated, 'never change'); await fs.rm(file);
  try { await fs.symlink(unrelated, file); } catch (cause) { if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(cause.code)) throw cause; return; }
  assert.equal((await ctx.builder.book(current)).stats.rebuiltManuals, 1); assert.equal(await fs.readFile(unrelated, 'utf8'), 'never change');
  assert.ok((await fs.lstat(file)).isFile()); assert.equal((await fs.readdir(ctx.directory)).some(name => name.endsWith('.tmp')), false);
});
test('unwritable cache and oversized entries still produce a valid export with visible warnings', async t => {
  const ctx = await setup(t), blocker = path.join(ctx.directory, 'blocker'); await fs.writeFile(blocker, 'file');
  const cache = createVectorCache({ directory: blocker, logger: { warn() {} } });
  const value = await createIndexBuilder({ cache, generate }).book(book(manual('a')));
  assert.equal(value.stats.rebuiltManuals, 1); assert.ok(value.warnings.length);
  const tiny = createVectorCache({ directory: ctx.directory, maxEntryBytes: 10 });
  assert.ok((await createIndexBuilder({ cache: tiny, generate }).book(book(manual('a')))).warnings.length);
});
test('bounded cache evicts its own oldest entries and leaves unrelated files alone', async t => {
  const ctx = await setup(t, { maxEntries: 1 }), a = book(manual('a')), b = book(manual('b'));
  await fs.writeFile(path.join(ctx.directory, 'notes.json'), 'keep');
  await ctx.builder.book(a); await ctx.builder.book(b);
  assert.equal((await fs.readdir(ctx.directory)).filter(name => name.startsWith('manual-')).length, 1);
  assert.equal(await fs.readFile(path.join(ctx.directory, 'notes.json'), 'utf8'), 'keep');
  assert.equal((await ctx.builder.book(b)).stats.reusedManuals, 1); assert.equal((await ctx.builder.book(a)).stats.rebuiltManuals, 1);
});
test('a cache hit refreshes LRU time and protects the recently read manual from eviction', async t => {
  const ctx = await setup(t, { maxEntries: 2 }), a = book(manual('a')), b = book(manual('b')), c = book(manual('c'));
  const file = value => path.join(ctx.directory, 'manual-' + ctx.cache.key(flatten(value), value.model, data.PROFILE) + '.json');
  await ctx.builder.book(a); await ctx.builder.book(b);
  const oldest = new Date(Date.now() - 30000), middle = new Date(Date.now() - 20000);
  await fs.utimes(file(a), oldest, oldest); await fs.utimes(file(b), middle, middle);
  assert.equal((await ctx.builder.book(a)).stats.reusedManuals, 1);
  assert.ok((await fs.stat(file(a))).mtimeMs > middle.getTime());
  assert.equal(ctx.logs.length, 0, 'a writable cache hit must not fail to refresh its access time');
  await ctx.builder.book(c);
  assert.ok((await ctx.cache.get(flatten(a), a.model, data.PROFILE)).index);
  assert.equal((await ctx.cache.get(flatten(b), b.model, data.PROFILE)).index, null);
});
test('a deliberately read-only cache remains readable without requiring inference', async t => {
  const ctx = await setup(t), value = book(manual('readonly'));
  await ctx.builder.book(value);
  const file = path.join(ctx.directory, 'manual-' + ctx.cache.key(flatten(value), value.model, data.PROFILE) + '.json');
  await fs.chmod(file, 0o400);
  try { assert.equal((await ctx.builder.book(value)).stats.reusedManuals, 1); assert.equal(ctx.calls(), 1); }
  finally { await fs.chmod(file, 0o600); }
});
test('concurrent same-manual exports share inference; one cancellation does not stop the other', async t => {
  const ctx = await setup(t); let calls = 0, release; const gate = new Promise(resolve => { release = resolve; });
  const builder = createIndexBuilder({ cache: ctx.cache, generate: async (...args) => { calls++; await gate; return generate(...args); } });
  const controller = new AbortController(), first = builder.book(book(manual('a')), { force: true, signal: controller.signal });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = builder.book(book(manual('a')), { force: true });
  controller.abort(); release(); await rejected;
  assert.equal((await second).stats.rebuiltManuals, 1); assert.equal(calls, 1);
});
test('cancelling all subscribers never caches partial vectors and permits a later rebuild', async t => {
  const ctx = await setup(t); let release; const gate = new Promise(resolve => { release = resolve; });
  const builder = createIndexBuilder({ cache: ctx.cache, generate: async (...args) => { await gate; return generate(...args); } });
  const controller = new AbortController(), result = builder.book(book(manual('a')), { force: true, signal: controller.signal });
  const rejected = assert.rejects(result, { name: 'AbortError' }); controller.abort(); release(); await rejected;
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(await fs.readdir(ctx.directory), []);
  assert.equal((await builder.book(book(manual('a')))).stats.rebuiltManuals, 1);
});

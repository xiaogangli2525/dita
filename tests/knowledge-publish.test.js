'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs/promises'), os = require('node:os');
const { Worker } = require('node:worker_threads');
const { preparePackage } = require('../public/knowledge-package');
const { createPublisher } = require('../public/knowledge-publisher');
const { createZip, measureFiles, textBytes } = require('../public/knowledge-zip');
const data = require('../public/knowledge-semantic');
const { createVectorCache } = require('../lib/knowledge-vector-cache'), { createIndexBuilder } = require('../lib/knowledge-index');
const { unzipSync, strFromU8 } = require('fflate');
function request(text = 'HTTP 超时参数。', id = 'm-0123456789abcdef') {
  return { title: '发布验收', model: 'ML307G', sdkVersion: 'v1', generatedAt: '2026-11-16T00:00:00Z', manuals: [{
    id, model: 'ML307G', title: 'HTTP手册', version: 'v1', capturedAt: '2026-11-16T00:00:00Z',
    html: '<html><body><p>' + text + '</p></body></html>', body: '<h2 id="a">HTTP</h2><p>' + text + '</p>',
    toc: [{ anchor: 'a', title: 'HTTP' }], entries: [{ anchor: 'a', title: 'HTTP', text }],
    source: { repository: 'http', commit: 'a'.repeat(40), dirty: false, documents: [] }, report: { included: 0 }
  }] };
}
const vector = () => { const values = Array(512).fill(0); values[0] = 1; return values; };
function publisher(t, workerData) {
  const workers = [], requests = [], value = createPublisher({ createWorker() {
    const thread = new Worker(path.join(__dirname, 'helpers/knowledge-worker-thread.js'), { workerData });
    const handle = { postMessage: message => thread.postMessage(message), terminate: () => thread.terminate() };
    thread.on('message', data => { if (data.type === 'test-request') requests.push(data.url); else handle.onmessage?.({ data }); });
    thread.on('error', error => handle.onerror?.({ message: error.message }));
    workers.push(thread); return handle;
  } });
  t.after(async () => { value.dispose(); await Promise.all(workers.map(worker => worker.terminate())); });
  return { value, requests, workers };
}

test('ZIP measurement matches bytes including Chinese, surrogate replacements and headers', () => {
  const texts = ['中文😀', '\ud800', '\udfff', 'a\ud800b\udc00', 'quotes"\\\n'];
  for (const text of texts) assert.equal(textBytes(text), Buffer.byteLength(text));
  const files = texts.map((content, i) => ({ name: 'docs/' + i + '.txt', content }));
  assert.equal(measureFiles(files), createZip(files).size);
});

test('preflight rebases chunk positions and predicts the exact semantic ZIP without inference', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-estimate-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = request('带有中文与emoji😀的 HTTP 参数'), second = request('HTTP response 200', 'm-fedcba9876543210').manuals[0];
  input.manuals[0].entries = Array.from({ length: 12 }, (_, i) => ({ anchor: 'a' + i, title: 'HTTP ' + i, text: 'HTTP 参数😀' + i }));
  input.manuals.push(second);
  let tokenizations = 0;
  const chunksFor = async records => { tokenizations++; return data.chunksFor(records, text => text.length + 2); };
  const cache = createVectorCache({ directory }), builder = createIndexBuilder({ cache, chunksFor, generate: () => assert.fail('preflight must not infer') });
  const estimate = await builder.estimate(input), groups = input.manuals.map(builder.recordsFor), indices = [];
  for (const records of groups) { const chunks = await chunksFor(records); indices.push(data.createIndex(chunks, chunks.map(vector))); }
  const combined = data.combineIndexes(groups, indices);
  assert.equal(estimate.bytes, Buffer.byteLength(JSON.stringify(combined))); assert.equal(estimate.chunks, 13);
  const prepared = preparePackage(input), measured = prepared.measure(estimate), output = prepared.build(combined);
  assert.equal(measured.bytes, output.zip.size);
  for (const [i, records] of groups.entries()) await cache.put(records, input.model, data.PROFILE, indices[i]);
  tokenizations = 0;
  assert.deepEqual(await builder.estimate(input), estimate); assert.equal(tokenizations, 0, 'warm preflight must work without model assets');
  await builder.estimate(input, { force: true }); assert.equal(tokenizations, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(builder.estimate(input, { signal: controller.signal }), { name: 'AbortError' });
});

test('production Worker reuses its sealed preview and produces a readable identical archive', async t => {
  const { value, workers } = publisher(t), input = request();
  const phases = [], summary = await value.prepare(input, { onProgress: progress => phases.push(progress.stage) });
  input.manuals[0].entries[0].text = 'later edit';
  const preview = await value.preview(), output = await value.download({ semantic: false });
  assert.equal(workers.length, 1); assert.equal(output.zip.size, summary.bytes);
  const archive = unzipSync(new Uint8Array(await output.zip.arrayBuffer()));
  assert.equal(strFromU8(archive['docs/index.html']), preview.html);
  assert.equal(JSON.parse(strFromU8(archive['docs/knowledge.json'])).manuals[0].entries[0].text, 'HTTP 超时参数。');
  assert.ok(phases.includes('index') && phases.includes('render'));
  assert.ok(output.metrics.some(phase => phase.stage === 'archive'));
  assert.ok(!output.metrics.some(phase => phase.stage === 'index' || phase.stage === 'render'));
});

test('Worker rejects oversized preflight in the publication stream and allows a plain retry', async t => {
  const { value, requests } = publisher(t, { oversize: true });
  await value.prepare(request());
  await assert.rejects(value.download({ semantic: true, token: 'test-token' }), /64 MiB/);
  assert.deepEqual(requests, ['/api/knowledge/publish']);
  const plain = await value.download({ semantic: false }); assert.ok(plain.zip.size > 0);
});

test('production Worker streams semantic results over HTTP with the pinned workspace token', async t => {
  const input = request();
  input.manuals[0].entries = Array.from({ length: 24 }, (_, i) => ({ anchor: 'a' + i, title: 'HTTP ' + i, text: 'HTTP 超时参数 ' + i }));
  const records = input.manuals[0].entries.map(entry => ({ ...entry, manualId: input.manuals[0].id, manualTitle: input.manuals[0].title }));
  const chunks = await data.chunksFor(records, text => text.length + 2), index = data.createIndex(chunks, chunks.map(vector)), received = [];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-http-publish-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cache = createVectorCache({ directory }); await cache.put(records, input.model, data.PROFILE, index);
  const builder = createIndexBuilder({ cache, chunksFor: () => assert.fail('warm preflight must not tokenize'), generateChunks: () => assert.fail('warm publish must not infer') });
  const handle = require('../lib/knowledge-routes').createKnowledgeHandler({ workspace: { root: directory }, git: {}, indexBuilder: () => builder });
  const server = require('node:http').createServer(async (req, res) => {
    received.push({ path: req.url, token: req.headers['x-workspace-token'] });
    try { await handle(req, res, req.url); } catch (cause) { res.writeHead(500); res.end(cause.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const { value } = publisher(t, { origin: 'http://127.0.0.1:' + server.address().port });
  await value.prepare(input); const phases = [];
  const result = await value.download({ semantic: true, token: 'workspace-version-123' }, { onProgress: info => phases.push(info) });
  const book = JSON.parse(strFromU8(unzipSync(new Uint8Array(await result.zip.arrayBuffer()))['docs/knowledge.json']));
  assert.deepEqual(book.semantic, index); assert.equal(data.validate(records, book.semantic).length, chunks.length * 512);
  assert.equal(result.stats.reusedManuals, 1); assert.equal(result.stats.rebuiltManuals, 0);
  assert.deepEqual(received.map(item => item.path), ['/api/knowledge/publish']);
  assert.ok(received.every(item => item.token === 'workspace-version-123'));
  assert.ok(phases.some(info => info.stage === 'estimate') && phases.some(info => info.stage === 'vectors'));
  assert.ok(phases.some(info => info.stage === 'capacity' && info.bytes === result.zip.size));
});

test('publication prepares every cold manual once, checks capacity before inference and reuses warm indices', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-single-pass-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const input = request(); input.manuals.push(request('HTTP timeout 408', 'm-fedcba9876543210').manuals[0]);
  let tokenizations = 0, generations = 0;
  const builder = createIndexBuilder({ cache: createVectorCache({ directory }),
    chunksFor: records => { tokenizations++; return data.chunksFor(records, text => text.length + 2); },
    generate: () => assert.fail('prepared publication must not re-enter record tokenization'),
    generateChunks: async (chunks, progress) => { generations++; progress(chunks.length, chunks.length); return data.createIndex(chunks, chunks.map(vector)); }
  });
  const prepared = preparePackage(input), outputs = []; let estimate;
  const options = { archiveOverhead: prepared.archiveOverhead(), onManual: async manual => { outputs.push(manual.index); } };
  const first = await builder.publish(input, { ...options, onEstimate: value => {
    estimate = value; assert.equal(tokenizations, 2); assert.equal(generations, 0);
  } });
  assert.equal(tokenizations, 2); assert.equal(generations, 2); assert.equal(first.stats.rebuiltManuals, 2);
  const combined = data.combineIndexes(input.manuals.map(builder.recordsFor), outputs);
  assert.equal(prepared.measure(estimate).bytes, prepared.build(combined).zip.size);
  const warm = await builder.publish(input, options);
  assert.equal(tokenizations, 2); assert.equal(generations, 2); assert.equal(warm.stats.reusedManuals, 2);
  input.manuals[1].entries[0].text += ' changed';
  const changed = await builder.publish(input, options);
  assert.equal(tokenizations, 3); assert.equal(generations, 3); assert.equal(changed.stats.reusedManuals, 1);
  await assert.rejects(builder.publish(input, { ...options, force: true, archiveOverhead: 64 * 1024 * 1024 - 1 }), /64 MiB/);
  assert.equal(generations, 3, 'all manuals must fit before any inference begins');
  const controller = new AbortController();
  await assert.rejects(builder.publish(input, { ...options, force: true, signal: controller.signal, onEstimate: () => controller.abort() }), { name: 'AbortError' });
  assert.equal(generations, 3, 'cancelled preflight must not start inference');
  const retry = await builder.publish(input, options); assert.equal(retry.stats.reusedManuals, 2);
});

test('publication rejects partial, out-of-order and duplicate streamed results', async () => {
  const input = request(), manual = input.manuals[0], records = manual.entries.map(entry => ({ ...entry, manualId: manual.id, manualTitle: manual.title }));
  const chunks = await data.chunksFor(records, text => text.length + 2), index = data.createIndex(chunks, chunks.map(vector));
  const estimate = { type: 'estimate', profile: data.PROFILE, chunks: chunks.length, bytes: Buffer.byteLength(JSON.stringify(index)) };
  const item = { type: 'manual', manualId: manual.id, source: 'cache', index };
  const result = { type: 'result', stats: { reusedManuals: 1, rebuiltManuals: 0, totalManuals: 1, totalChunks: chunks.length }, warnings: [] };
  const publish = require('../public/knowledge-index').publish;
  for (const messages of [[item, result], [estimate, result], [estimate, item, item, result], [estimate, { ...item, manualId: 'wrong' }, result], [estimate, estimate, item, result], [estimate, item]]) {
    await assert.rejects(publish({ manuals: input.manuals, model: input.model, archiveOverhead: 0,
      api: { request: async () => new Response(messages.map(message => JSON.stringify(message) + '\n').join('')) }
    }));
  }
});

test('single-manual vector reuse normalizes legacy base64 before exact capacity accounting', async () => {
  const records = [{ manualId: 'legacy', manualTitle: 'HTTP', anchor: 'a', title: 'HTTP', text: 'HTTP timeout' }];
  const chunks = await data.chunksFor(records, text => text.length + 2), index = data.createIndex(chunks, chunks.map(vector));
  for (const vectors of [index.vectors.replace(/=/g, ''), index.vectors.replace(/(.{100})/g, '$1\n')]) {
    const normalized = data.combineIndexes([records], [{ ...index, vectors }]);
    assert.deepEqual(normalized, index);
  }
});

test('cancelling a live publication aborts server inference and never caches a partial result', { timeout: 10000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-publish-abort-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let started, stopped;
  const beginning = new Promise(resolve => { started = resolve; }), stopping = new Promise(resolve => { stopped = resolve; });
  const builder = createIndexBuilder({ cache: createVectorCache({ directory }), chunksFor: records => data.chunksFor(records, text => text.length + 2),
    generateChunks: (chunks, progress, { signal }) => new Promise((resolve, reject) => {
      const stop = () => { stopped(); reject(Object.assign(Error('cancelled'), { name: 'AbortError' })); };
      signal.addEventListener('abort', stop, { once: true }); started(); if (signal.aborted) stop();
    })
  });
  const handle = require('../lib/knowledge-routes').createKnowledgeHandler({ workspace: { root: directory }, git: {}, indexBuilder: () => builder });
  const server = require('node:http').createServer(async (req, res) => {
    try { await handle(req, res, req.url); } catch (cause) { res.writeHead(500); res.end(cause.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const { value } = publisher(t, { origin: 'http://127.0.0.1:' + server.address().port });
  await value.prepare(request()); const controller = new AbortController();
  const downloading = value.download({ semantic: true, token: 'cancel-test' }, { signal: controller.signal });
  const rejected = assert.rejects(downloading, { name: 'AbortError' });
  await beginning; controller.abort(); await rejected; await stopping;
  assert.deepEqual(await fs.readdir(directory), []);
  await value.prepare(request()); assert.ok((await value.download({ semantic: false })).zip.size > 0);
});

test('cancelling CPU work leaves the main thread responsive and permits a fresh publication', { timeout: 20000 }, async t => {
  const { value, workers } = publisher(t), controller = new AbortController();
  const large = request('HTTP client sends request data. '.repeat(100000));
  let ticks = 0; const timer = setInterval(() => ticks++, 5); t.after(() => clearInterval(timer));
  await assert.rejects(value.prepare(large, { signal: controller.signal, onProgress: progress => {
    if (progress.stage === 'index') controller.abort();
  } }), { name: 'AbortError' });
  assert.ok(ticks > 0);
  await value.prepare(request('fresh publication'));
  const output = await value.download({ semantic: false });
  assert.equal(workers.length, 2);
  assert.match(strFromU8(unzipSync(new Uint8Array(await output.zip.arrayBuffer()))['docs/knowledge.json']), /fresh publication/);
});

test('stale worker replies cannot complete a later job and worker errors are retryable', async t => {
  const created = [], value = createPublisher({ createWorker() {
    const fake = { postMessage() {}, terminate() {} }; created.push(fake); return fake;
  } });
  t.after(() => value.dispose());
  const controller = new AbortController(), old = value.prepare(request(), { signal: controller.signal });
  const rejection = assert.rejects(old, { name: 'AbortError' }); controller.abort(); await rejection;
  const next = value.prepare(request());
  created[0].onmessage({ data: { id: 2, type: 'result', value: { bytes: -1 } } });
  created[1].onmessage({ data: { id: 2, type: 'result', value: { bytes: 42 } } });
  assert.equal((await next).bytes, 42);
  const failed = value.preview(); const rejected = assert.rejects(failed, /后台发布失败/);
  created[1].onerror({ message: 'worker crashed' }); await rejected;
  const retry = value.prepare(request());
  created[2].onmessage({ data: { id: 4, type: 'result', value: { bytes: 43 } } });
  assert.equal((await retry).bytes, 43);
});

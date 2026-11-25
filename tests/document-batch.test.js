'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const iconv = require('iconv-lite');
const { createDocumentBatch } = require('../lib/document-batch');

async function fixture(t) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dita-batch-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'docs'), directory = path.join(base, 'journal');
  await fs.mkdir(path.join(root, 'topics'), { recursive: true });
  const map = path.join(root, 'manual.ditamap'), topic = path.join(root, 'topics', 'a.dita');
  const original = '<?xml version="1.0" encoding="GBK"?>\r\n<map><title>原始文档</title><topicref href="topics/a.dita"/></map>\r\n';
  const previous = '<topic><title>Previous</title></topic>';
  const requests = [{ path: 'manual.ditamap', expectedContent: original, content: original.replace('原始', '更新') },
    { path: 'topics/a.dita', expectedContent: previous, content: previous.replace('Previous', 'Revised') }];
  const originals = [iconv.encode(original, 'gbk'), Buffer.from(previous)];
  await Promise.all([fs.writeFile(map, originals[0]), fs.writeFile(topic, originals[1])]);
  const disk = () => Promise.all([fs.readFile(map), fs.readFile(topic)]);
  const clean = async () => {
    assert.deepEqual((await fs.readdir(root)).sort(), ['manual.ditamap', 'topics']);
    assert.deepEqual(await fs.readdir(path.dirname(topic)), ['a.dita']);
    assert.deepEqual(await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; }), []);
  };
  return { root, directory, map, topic, originals, requests, disk, clean };
}

test('batch preflight refuses a stale buffer, lossy encoding or duplicate resolved path before any write', async t => {
  const f = await fixture(t), service = createDocumentBatch(f);
  const [map, topic] = f.requests;
  for (const [requests, error] of [
    [[map, { ...topic, expectedContent: '<topic/>' }], /a\.dita.*已在磁盘上变化/],
    [[map, { ...topic, content: '<?xml version="1.0" encoding="GBK"?><topic>😀</topic>' }], /a\.dita.*无损保存/],
    [[map, { ...map, path: 'topics/../manual.ditamap' }], /重复文件/]
  ]) {
    await assert.rejects(service.save(f.root, requests), error);
    assert.deepEqual(await f.disk(), f.originals);
    await f.clean();
  }
});

test('a failure replacing the second file restores the exact first-file bytes and permits retry', async t => {
  const f = await fixture(t);
  let failureInjected = false;
  const service = createDocumentBatch({ directory: f.directory, io: { ...fs, async rename(from, to) {
    if (to === f.topic && from.endsWith('.next') && !failureInjected) {
      failureInjected = true;
      assert.deepEqual((await f.disk())[0], iconv.encode(f.requests[0].content, 'gbk'));
      throw Object.assign(Error('locked'), { code: 'EPERM' });
    }
    await fs.rename(from, to);
  } } });
  await assert.rejects(service.save(f.root, f.requests), /a\.dita.*EPERM/);
  assert.ok(failureInjected);
  assert.deepEqual(await f.disk(), f.originals);
  await f.clean();
  await service.save(f.root, f.requests);
  assert.deepEqual(await f.disk(), [iconv.encode(f.requests[0].content, 'gbk'), Buffer.from(f.requests[1].content)]);
  await f.clean();
});

test('restart rolls back incomplete batches and preserves batches committed before cleanup', async t => {
  for (const phase of ['prepared', 'committed']) await t.test(phase, async sub => {
    const f = await fixture(sub);
    const script = [
      'const fs = require("node:fs/promises"), { createDocumentBatch } = require(process.argv[1]);',
      'const { root, directory, topic, requests, phase } = JSON.parse(process.argv[2]);',
      'const io = { ...fs, async rename(from, to) {',
      '  if (phase === "prepared" && from.endsWith(".next") && to === topic) process.exit(79);',
      '  await fs.rename(from, to);',
      '}, async rm(file, options) {',
      '  if (phase === "committed" && file.endsWith(".previous")) process.exit(79);',
      '  await fs.rm(file, options);',
      '} };',
      'createDocumentBatch({ directory, io }).save(root, requests).catch(error => { console.error(error); process.exitCode = 1; });'
    ].join('\n');
    const child = spawnSync(process.execPath, ['-e', script, require.resolve('../lib/document-batch'), JSON.stringify({ ...f, phase })], { encoding: 'utf8' });
    assert.equal(child.status, 79, child.stderr);
    const committed = [iconv.encode(f.requests[0].content, 'gbk'), Buffer.from(f.requests[1].content)];
    assert.deepEqual(await f.disk(), [committed[0], phase === 'committed' ? committed[1] : f.originals[1]]);
    await createDocumentBatch(f).recover(f.root);
    assert.deepEqual(await f.disk(), phase === 'committed' ? committed : f.originals);
    await f.clean();
  });
});

test('rollback retains the original backup when an outside edit supersedes a replacement', async t => {
  const f = await fixture(t), external = '<map><title>External</title></map>';
  const service = createDocumentBatch({ directory: f.directory, io: { ...fs, async rename(from, to) {
    if (to === f.topic && from.endsWith('.next')) {
      await fs.writeFile(f.map, external);
      throw Error('second write failed');
    }
    await fs.rename(from, to);
  } } });
  await assert.rejects(service.save(f.root, f.requests), /恢复未完成.*manual\.ditamap/);
  await assert.rejects(service.recover(f.root), /恢复未完成.*manual\.ditamap/);
  assert.deepEqual(await f.disk(), [Buffer.from(external), f.originals[1]]);
  const backup = (await fs.readdir(f.root)).find(file => file.endsWith('.previous'));
  assert.deepEqual(await fs.readFile(path.join(f.root, backup)), f.originals[0]);
  await fs.writeFile(f.map, f.originals[0]);
  await service.recover(f.root);
  await f.clean();
});

test('recovery preserves a pending journal when probing its owner is denied', async t => {
  const f = await fixture(t);
  const key = createHash('sha256').update(f.root).digest('hex');
  const journal = path.join(f.directory, key + '.json');
  const owner = process.pid + 1;
  const plan = JSON.stringify({ root: f.root, pid: owner, host: os.hostname(), id: randomUUID(), phase: 'prepared', entries: [] });
  await fs.mkdir(f.directory);
  await fs.writeFile(journal, plan);
  let code = 'EPERM';
  const kill = process.kill;
  t.mock.method(process, 'kill', (pid, signal) => {
    if (pid !== owner || signal !== 0) return kill(pid, signal);
    throw Object.assign(Error(code), { code });
  });
  const service = createDocumentBatch(f);
  await assert.rejects(service.recover(f.root), { status: 409, message: /另一个工作台操作在保存/ });
  assert.equal(await fs.readFile(journal, 'utf8'), plan);
  assert.deepEqual(await f.disk(), f.originals);
  code = 'EIO';
  await assert.rejects(service.recover(f.root), { code: 'EIO' });
  assert.equal(await fs.readFile(journal, 'utf8'), plan);
  code = 'ESRCH';
  await service.recover(f.root);
  await f.clean();
});

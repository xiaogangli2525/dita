'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { unzipSync, zipSync, Zip, ZipDeflate } = require('fflate');
const { createZip } = require('../public/knowledge-zip');
const { buildPackage } = require('../public/knowledge-package');

function fixture() {
  return buildPackage({
    title: 'CLI 测试知识库', model: 'ML307G', sdkVersion: 'V1',
    manuals: [{
      id: 'm-0123456789abcdef', model: 'ML307G', title: 'HTTP 用户手册', version: 'V1',
      capturedAt: '2026-11-12T00:00:00.000Z',
      html: '<!doctype html><html><body>HTTP 手册</body></html>', htmlSha256: 'html-hash',
      body: '<h2>HTTP连接配置</h2>', toc: [{ title: 'HTTP连接配置', anchor: 'm-0123456789abcdef--sec-0' }],
      entries: [{ title: 'HTTP连接配置', anchor: 'm-0123456789abcdef--sec-0',
        text: 'HTTP连接失败时，检查服务器地址、网络状态和超时参数。',
        sourcePath: 'topics/http_connection.dita', fingerprint: 'topic-hash', kind: 'guide' }],
      report: { included: 1 },
      source: { repository: 'http-docs', commit: 'abc123', dirty: false, documents: [{ path: 'topics/http_connection.dita', sha256: 'topic-hash' }] }
    }]
  });
}

function run(args, cwd) {
  return spawnSync(process.execPath, [path.resolve(__dirname, '../bin/blink-cli.js'), ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, BLINK_KB: '' }
  });
}

test('blink-cli searches an exported ZIP and returns traceable JSON', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = fixture(), zipPath = path.join(dir, 'knowledge.zip');
  fs.writeFileSync(zipPath, Buffer.from(await value.zip.arrayBuffer()));
  const archive = unzipSync(new Uint8Array(await value.zip.arrayBuffer()));
  assert.ok(archive['docs/knowledge.json']);
  const result = run(['--kb', zipPath, '服务器连不上怎么办', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 1);
  assert.equal(output.results[0].title, 'HTTP连接配置');
  assert.equal(output.results[0].source.repository, 'http-docs');
  assert.equal(output.results[0].source.commit, 'abc123');
  assert.equal(output.results[0].id, 'm-0123456789abcdef#m-0123456789abcdef--sec-0');
  const kbPrefix = run(['--kb', zipPath, 'KB', '服务器连不上怎么办', '--json']);
  assert.equal(kbPrefix.status, 0, kbPrefix.stderr);
  assert.equal(JSON.parse(kbPrefix.stdout).results[0].title, 'HTTP连接配置');
});

test('blink-cli reads full chapter text and lists manuals', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = fixture(), zipPath = path.join(dir, 'knowledge.zip');
  fs.writeFileSync(zipPath, Buffer.from(await value.zip.arrayBuffer()));
  const ref = 'm-0123456789abcdef#m-0123456789abcdef--sec-0';
  const get = run(['--kb', zipPath, '--get', ref, '--json']);
  assert.equal(get.status, 0, get.stderr);
  assert.match(JSON.parse(get.stdout).text, /超时参数/);
  const list = run(['--kb', zipPath, '--list', '--json']);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).manuals[0].title, 'HTTP 用户手册');
});

test('blink-cli can read legacy ZIP packages without knowledge.json or re-export', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = fixture(), legacyZip = createZip([{ name: 'docs/index.html', content: value.html }]);
  const zipPath = path.join(dir, 'legacy.zip');
  fs.writeFileSync(zipPath, Buffer.from(await legacyZip.arrayBuffer()));
  const result = run(['--kb', zipPath, 'HTTP连接失败', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).results[0].title, 'HTTP连接配置');
});

test('blink-cli auto-detects the only knowledge ZIP in the current directory', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-cli-auto-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = fixture();
  fs.writeFileSync(path.join(dir, 'ML307G-knowledge-base.zip'), Buffer.from(await value.zip.arrayBuffer()));
  const result = run(['HTTP连接失败', '--json'], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).results[0].title, 'HTTP连接配置');
});

test('blink-cli reports a clear error when no knowledge base is configured', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-cli-empty-'));
  try {
    const result = run(['HTTP连接失败'], dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /没有找到知识库/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('search-to-chapter handoff stays bound to the selected knowledge base', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blink-cli-' $(literal) "));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = fixture(), zipPath = path.join(dir, 'selected knowledge.zip');
  fs.writeFileSync(zipPath, Buffer.from(await value.zip.arrayBuffer()));
  const other = structuredClone(value.book);
  other.model = 'MR380R'; other.manuals[0].entries[0].text = 'WRONG_BOOK_CONTENT';
  fs.writeFileSync(path.join(dir, 'knowledge.json'), JSON.stringify(other));
  const searched = run(['--kb', zipPath, 'HTTP连接失败', '--json'], dir);
  assert.equal(searched.status, 0, searched.stderr);
  const output = JSON.parse(searched.stdout);
  assert.equal(output.knowledgeBase.path, zipPath);
  const get = run(['--kb', output.knowledgeBase.path, '--get', output.results[0].id, '--json'], dir);
  assert.equal(get.status, 0, get.stderr);
  const chapter = JSON.parse(get.stdout);
  assert.equal(chapter.knowledgeBase.model, 'ML307G');
  assert.equal(chapter.knowledgeBase.path, zipPath);
  assert.match(chapter.text, /超时参数/);
  const plain = run(['--kb', zipPath, 'HTTP连接失败'], dir);
  assert.equal(plain.status, 0, plain.stderr);
  const command = plain.stdout.split('\n').find(line => line.includes('读取：')).trim().slice(3);
  assert.ok(command.includes('--kb'));
  if (process.platform !== 'win32') {
    const executable = "'" + process.execPath.replace(/'/g, "'\\''") + "' '" + path.resolve(__dirname, '../bin/blink-cli.js').replace(/'/g, "'\\''") + "'";
    const copied = spawnSync('sh', ['-c', command.replace(/^blink-cli/, executable) + ' --json'], { cwd: dir, encoding: 'utf8' });
    assert.equal(copied.status, 0, copied.stderr);
    assert.equal(JSON.parse(copied.stdout).knowledgeBase.model, 'ML307G');
  }
});

test('CLI skips unrelated ZIP assets before decompression', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-cli-selective-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const data = Buffer.from(JSON.stringify(fixture().book));
  const bytes = Buffer.from(zipSync({ 'unrelated.bin': new Uint8Array([1]), 'docs/knowledge.json': data }));
  // An unsupported, oversized unrelated asset must never be decompressed.
  bytes.writeUInt16LE(99, 8); bytes.writeUInt32LE(129 * 1024 * 1024, 22);
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt16LE(99, central + 10); bytes.writeUInt32LE(129 * 1024 * 1024, central + 24);
  const zipPath = path.join(dir, 'knowledge.zip'); fs.writeFileSync(zipPath, bytes);
  const result = run(['--kb', zipPath, '--info', '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).model, 'ML307G');
});

test('CLI bounds actual decompressed data even when ZIP size metadata is inaccurate', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-cli-bounded-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const parts = [], archive = new Zip((error, chunk) => { if (error) throw error; parts.push(Buffer.from(chunk)); });
  const entry = new ZipDeflate('docs/knowledge.json', { level: 1 }); archive.add(entry);
  const chunk = new Uint8Array(1024 * 1024);
  for (let i = 0; i < 129; i++) entry.push(chunk);
  entry.push(new Uint8Array(), true); archive.end();
  const bytes = Buffer.concat(parts), central = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(1, central + 24);
  const zipPath = path.join(dir, 'knowledge.zip'); fs.writeFileSync(zipPath, bytes);
  const result = run(['--kb', zipPath, '--info']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /解压后超过 128 MiB/);
});

test('CLI merges compatible manual packs and keeps chapter reads bound to every source', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-cli-merge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = structuredClone(fixture().book), second = structuredClone(first);
  second.manuals[0].id = 'm-fedcba9876543210'; second.manuals[0].title = '独立功能';
  second.manuals[0].entries[0].text = 'SECOND_MANUAL_CONTENT';
  const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json');
  fs.writeFileSync(a, JSON.stringify(first)); fs.writeFileSync(b, JSON.stringify(second));
  const info = run(['--kb', a, '--merge', b, '--info', '--json']);
  assert.equal(info.status, 0, info.stderr);
  assert.equal(JSON.parse(info.stdout).manualCount, 2);
  const ref = second.manuals[0].id + '#' + second.manuals[0].entries[0].anchor;
  const get = run(['--kb', a, '--merge', b, '--get', ref, '--json']);
  assert.equal(get.status, 0, get.stderr);
  assert.match(JSON.parse(get.stdout).text, /SECOND_MANUAL_CONTENT/);
  assert.deepEqual(JSON.parse(get.stdout).knowledgeBase.paths, [a, b]);
  const duplicate = run(['--kb', a, '--merge', a, '--info']);
  assert.equal(duplicate.status, 1); assert.match(duplicate.stderr, /重复手册/);
});


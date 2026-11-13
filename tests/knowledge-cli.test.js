'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { unzipSync } = require('fflate');
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
  const archive = unzipSync(value.zip);
  assert.ok(archive['docs/knowledge.json']);
  const result = run(['--kb', zipPath, '服务器连不上怎么办', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.count, 1);
  assert.equal(output.results[0].title, 'HTTP连接配置');
  assert.equal(output.results[0].source.repository, 'http-docs');
  assert.equal(output.results[0].source.commit, 'abc123');
  assert.equal(output.results[0].id, 'm-0123456789abcdef#m-0123456789abcdef--sec-0');
});

test('blink-cli reads full chapter text and lists manuals', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = fixture(), zipPath = path.join(dir, 'knowledge.zip');
  fs.writeFileSync(zipPath, value.zip);
  const ref = 'm-0123456789abcdef#m-0123456789abcdef--sec-0';
  const get = run(['--kb', zipPath, '--get', ref, '--json']);
  assert.equal(get.status, 0, get.stderr);
  assert.match(JSON.parse(get.stdout).text, /超时参数/);
  const list = run(['--kb', zipPath, '--list', '--json']);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).manuals[0].title, 'HTTP 用户手册');
});

test('blink-cli can read legacy offline HTML packages without re-export', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = fixture(), htmlPath = path.join(dir, 'index.html');
  fs.writeFileSync(htmlPath, value.html);
  const result = run(['--kb', htmlPath, 'HTTP连接失败', '--json']);
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

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const net = require('node:net');
const iconv = require('iconv-lite');
test('workspace foundation routes preserve boundaries and optimistic writes', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-tools-')), repo = path.join(temporary, 'docs'); await fs.mkdir(repo);
  const source = '<?xml version="1.0" encoding="GBK"?><topic id="t"><body><p>TCP <b>connection</b> &amp; MQTT 中文参数</p></body></topic>';
  await fs.writeFile(path.join(repo, 'a.dita'), iconv.encode(source, 'gbk'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, DOCS_ROOT: repo, REPOSITORIES_ROOT: temporary, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode == null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); } await fs.rm(temporary, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server timeout')), 10000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('error', reject); });
  const base = 'http://127.0.0.1:' + port, workspace = await (await fetch(base + '/api/workspace')).json();
  const request = (url, method = 'GET', body, headers = {}) => fetch(base + url, { method, headers: { 'x-workspace-token': workspace.workspaceToken, 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  await t.test('provenance reports a real commit and clean worktree', async () => { const result = await (await request('/api/provenance')).json(); assert.match(result.commit, /^[a-f0-9]{40}$/); assert.equal(result.dirty, false); });
  await t.test('project config is versioned JSON with conflicts, validation and repair support', async () => {
    const initial = await (await request('/api/project')).json(); assert.equal(initial.expectedContent, null);
    const saved = await request('/api/project', 'PUT', { expectedContent: null, config: { schema: 1, models: ['M100', 'M200'] } }); assert.equal(saved.status, 200);
    const result = await saved.json(); assert.match(await fs.readFile(path.join(repo, '.dita-project.json'), 'utf8'), /M100/);
    assert.equal((await request('/api/project', 'PUT', { expectedContent: null, config: { schema: 1, models: [] } })).status, 409);
    assert.equal((await request('/api/project', 'PUT', { expectedContent: result.expectedContent, config: { schema: 1, models: ['bad name'] } })).status, 400);
    await fs.writeFile(path.join(repo, '.dita-project.json'), '{broken');
    const broken = await (await request('/api/project')).json(); assert.match(broken.error, /配置无效/); assert.equal(broken.expectedContent, '{broken');
    assert.equal((await request('/api/project', 'PUT', { expectedContent: broken.expectedContent, config: { schema: 1, models: ['M100'] } })).status, 200);
  });
  await t.test('GBK full text and inline/entity matches have exact source ranges and bounded scope', async () => {
    const result = await (await request('/api/search', 'POST', { query: 'TCP connection' })).json(); assert.equal(result.matches.length, 1);
    assert.equal(source.slice(result.matches[0].start, result.matches[0].end), 'TCP <b>connection');
    const chinese = await (await request('/api/search', 'POST', { query: '中文参数', paths: ['a.dita'] })).json(); assert.equal(chinese.matches.length, 1);
    assert.equal((await request('/api/search', 'POST', { query: '' })).status, 400);
    const outside = await (await request('/api/search', 'POST', { query: 'private', paths: ['../outside.dita'] })).json(); assert.equal(outside.matches.length, 0);
  });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await t.test('image uploads create once, validate formats and are served with isolated content headers', async () => {
    assert.equal((await request('/api/assets', 'POST', { name: 'test.png', base64: png })).status, 201);
    assert.equal((await request('/api/assets', 'POST', { name: 'test.png', base64: png })).status, 409);
    assert.equal((await request('/api/assets', 'POST', { name: '../bad.png', base64: png })).status, 400);
    assert.equal((await request('/api/assets', 'POST', { name: 'fake.png', base64: Buffer.from('fake').toString('base64') })).status, 400);
    assert.equal((await request('/api/assets', 'POST', { name: 'active.svg', base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64') })).status, 400);
    assert.deepEqual((await (await request('/api/assets')).json()).files, ['assets/test.png']);
    const asset = await request('/api/asset?path=assets/test.png'); assert.equal(asset.status, 200); assert.match(asset.headers.get('content-security-policy'), /sandbox/); assert.equal(asset.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()), Buffer.from(png, 'base64'));
  });
  await t.test('new mutating routes reject missing identity, cross origins and symlink escapes', async () => {
    assert.equal((await fetch(base + '/api/assets', { method: 'POST', body: JSON.stringify({ name: 'missing.png', base64: png }) })).status, 409);
    assert.equal((await request('/api/assets', 'POST', { name: 'forbidden.png', base64: png }, { origin: 'https://example.invalid' })).status, 403);
    const outside = path.join(temporary, 'outside'); await fs.mkdir(outside); await fs.rename(path.join(repo, 'assets'), path.join(repo, 'old-assets')); await fs.symlink(outside, path.join(repo, 'assets'));
    assert.equal((await request('/api/assets', 'POST', { name: 'escape.png', base64: png })).status, 403);
    await assert.rejects(fs.stat(path.join(outside, 'escape.png')), { code: 'ENOENT' });
  });
});

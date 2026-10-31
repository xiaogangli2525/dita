'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');
const net = require('node:net');

test('HTTP workflow protects edits, Git baselines, repository boundaries and workspace identity', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-api-'));
  const repo = path.join(temporary, 'docs');
  await fs.mkdir(path.join(repo, 'topics'), { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  const initial = '<topic id="a"><title>Initial</title><body><p>Original</p></body></topic>';
  const file = path.join(repo, 'topics/a.dita');
  await fs.writeFile(file, initial);
  await fs.writeFile(path.join(repo, 'main.ditamap'), '<map><title>Guide</title><topicref href="topics/a.dita"/></map>');
  git('add', '.'); git('commit', '-m', 'fixture'); git('branch', 'other');
  const port = await new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DOCS_ROOT: repo, REPOSITORIES_ROOT: temporary },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    if (child.exitCode == null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    await fs.rm(temporary, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 10000);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  const base = 'http://127.0.0.1:' + port;
  const workspace = await (await fetch(base + '/api/workspace')).json();
  let token = workspace.workspaceToken;
  const request = (url, method = 'GET', body) => fetch(base + url, {
    method, headers: { 'x-workspace-token': token, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  await t.test('nested files use the committed Git baseline', async () => {
    const info = await (await request('/api/git?path=topics/a.dita')).json();
    assert.equal(info.available, true);
    assert.equal(info.content, initial);
  });
  await t.test('dirty branch switches are refused even if force is supplied', async () => {
    await fs.writeFile(file, initial.replace('Original', 'Saved edit'));
    const result = await request('/api/branch', 'POST', { branch: 'other', force: true });
    assert.equal(result.status, 409);
    assert.match(await fs.readFile(file, 'utf8'), /Saved edit/);
  });
  await t.test('invalid XML cannot be saved, created or used for Map operations', async () => {
    const disk = await fs.readFile(file, 'utf8');
    for (const content of ['<topic id=bad/>', '<topic id="a" id="b"/>', '<topic>A & B</topic>']) {
      assert.equal((await request('/api/file', 'PUT', { path: 'topics/a.dita', content, expectedContent: disk })).status, 400);
      assert.equal((await request('/api/file', 'POST', { path: 'topics/invalid.dita', content })).status, 400);
      assert.equal((await request('/api/map/resolve', 'POST', { path: 'main.ditamap', content })).status, 400);
    }
    assert.equal(await fs.readFile(file, 'utf8'), disk);
    await assert.rejects(fs.stat(path.join(repo, 'topics/invalid.dita')), { code: 'ENOENT' });
  });
  await t.test('stale writes are refused and matching writes succeed', async () => {
    const stale = await request('/api/file', 'PUT', { path: 'topics/a.dita', content: '<topic/>', expectedContent: initial });
    assert.equal(stale.status, 409);
    const disk = await fs.readFile(file, 'utf8');
    const good = await request('/api/file', 'PUT', { path: 'topics/a.dita', content: initial, expectedContent: disk });
    assert.equal(good.status, 200);
    assert.equal(await fs.readFile(file, 'utf8'), initial);
  });
  await t.test('symbolic links cannot read or overwrite documents outside the root', async () => {
    await fs.writeFile(path.join(temporary, 'outside.xml'), '<private/>');
    await fs.symlink(path.join(temporary, 'outside.xml'), path.join(repo, 'link.xml'));
    assert.equal((await request('/api/file?path=link.xml')).status, 403);
    assert.equal((await request('/api/file', 'PUT', { path: 'link.xml', content: '<changed/>', expectedContent: '<private/>' })).status, 403);
    assert.equal(await fs.readFile(path.join(temporary, 'outside.xml'), 'utf8'), '<private/>');
    await fs.rm(path.join(repo, 'link.xml'));
  });
  await t.test('Map resolution uses the supplied buffer without saving it', async () => {
    const map = await (await request('/api/map/resolve', 'POST', { path: 'main.ditamap', content: '<map><title>Unsaved title</title><topicref href="topics/a.dita"/></map>' })).json();
    assert.equal(map.title, 'Unsaved title');
    assert.match(await fs.readFile(path.join(repo, 'main.ditamap'), 'utf8'), /Guide/);
  });
  await t.test('clean switch rotates identity and rejects stale-tab writes', async () => {
    const switched = await request('/api/branch', 'POST', { branch: 'other' });
    assert.equal(switched.status, 200);
    const next = await switched.json();
    assert.notEqual(next.workspaceToken, token);
    assert.equal((await request('/api/file', 'PUT', { path: 'topics/a.dita', content: '<topic/>', expectedContent: initial })).status, 409);
    token = next.workspaceToken;
    assert.equal((await request('/api/file?path=topics/a.dita')).status, 200);
  });
  await t.test('new files cannot overwrite existing paths without a matching baseline', async () => {
    assert.equal((await request('/api/file', 'POST', { path: 'new.dita', content: '<topic/>' })).status, 201);
    assert.equal((await request('/api/file', 'POST', { path: 'new.dita', content: '<topic id="new"/>' })).status, 409);
    assert.equal((await request('/api/file', 'POST', { path: 'new.dita', content: '<topic id="new"/>', overwrite: true })).status, 409);
  });
});

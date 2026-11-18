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
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DOCS_ROOT: repo, REPOSITORIES_ROOT: temporary, DITA_SAVE_JOURNAL_DIR: path.join(temporary, 'save-journal'), PUBLIC_ORIGIN: 'https://docs.example.invalid' },
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
  await t.test('foreign Host cannot bootstrap a workspace or read documents without an Origin header', async () => {
    const http = require('node:http');
    const probe = (url, host = 'attacker.example:' + port) => new Promise((resolve, reject) => {
      const req = http.get(base + url, { headers: { host, 'x-workspace-token': token } }, res => {
        let content = ''; res.on('data', chunk => { content += chunk; }); res.on('end', () => resolve({ status: res.statusCode, content }));
      }); req.on('error', reject);
    });
    for (const url of ['/api/workspace', '/api/file?path=topics/a.dita', '/api/asset?path=private.png']) {
      const response = await probe(url); assert.equal(response.status, 403); assert.doesNotMatch(response.content, /workspaceToken|Original/);
    }
    assert.equal((await fetch(base + '/api/workspace')).status, 200);
    assert.equal((await probe('/api/workspace', 'docs.example.invalid')).status, 200);
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
  await t.test('one batch validates all documents before disk writes and acknowledges only complete saves', async () => {
    const map = path.join(repo, 'main.ditamap'), mapBefore = await fs.readFile(map, 'utf8');
    const mapEdit = { path: 'main.ditamap', content: mapBefore.replace('Guide', 'Batch guide'), expectedContent: mapBefore };
    const topicEdit = { path: 'topics/a.dita', content: initial.replace('Original', 'Batch edit'), expectedContent: initial };
    for (const [second, status] of [
      [{ ...topicEdit, expectedContent: '<topic/>' }, 409],
      [{ ...topicEdit, content: '<topic>A & B</topic>' }, 400]
    ]) {
      const failed = await request('/api/file/batch', 'PUT', { files: [mapEdit, second] });
      assert.equal(failed.status, status);
      const result = await failed.json();
      assert.equal(result.saved, false);
      assert.match(result.error, /topics\/a\.dita/);
      assert.deepEqual(result.files[0], { path: mapEdit.path, status: 'notWritten' });
      assert.equal(result.files[1].path, topicEdit.path);
      assert.equal(result.files[1].status, status === 409 ? 'conflict' : 'failed');
      assert.equal(await fs.readFile(map, 'utf8'), mapBefore);
      assert.equal(await fs.readFile(file, 'utf8'), initial);
    }
    const rejected = await request('/api/file/batch', 'PUT', { files: [
      { ...mapEdit, expectedContent: '<map/>' }, { ...topicEdit, content: '<topic' }
    ] });
    assert.deepEqual((await rejected.json()).files.map(file => [file.path, file.status]), [
      [mapEdit.path, 'conflict'], [topicEdit.path, 'failed']
    ]);
    assert.equal(await fs.readFile(map, 'utf8'), mapBefore);
    assert.equal(await fs.readFile(file, 'utf8'), initial);
    const saved = await request('/api/file/batch', 'PUT', { files: [mapEdit, topicEdit] });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { saved: true, files: [mapEdit, topicEdit].map(file => ({ path: file.path, status: 'saved' })) });
    assert.equal(await fs.readFile(map, 'utf8'), mapEdit.content);
    assert.equal(await fs.readFile(file, 'utf8'), topicEdit.content);
    await Promise.all([fs.writeFile(map, mapBefore), fs.writeFile(file, initial)]);
  });
  await t.test('encoding failures leave existing bytes intact and cannot create a damaged document', async () => {
    const disk = await fs.readFile(file, 'utf8');
    const content = '<?xml version="1.0" encoding="ISO-8859-1"?><topic><title>中文</title></topic>';
    for (const [method, body] of [
      ['PUT', { path: 'topics/a.dita', content, expectedContent: disk }],
      ['POST', { path: 'topics/a.dita', content, overwrite: true, expectedContent: disk }],
      ['POST', { path: 'topics/unencodable.dita', content }]
    ]) {
      const response = await request('/api/file', method, body);
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /无损保存/);
      assert.equal(await fs.readFile(file, 'utf8'), disk);
    }
    await assert.rejects(fs.stat(path.join(repo, 'topics/unencodable.dita')), { code: 'ENOENT' });
    const safe = '<topic><title>中文</title><body><p>encoding="latin1"</p></body></topic>';
    const saved = await request('/api/file', 'POST', { path: 'topics/encoding-text.dita', content: safe });
    assert.equal(saved.status, 201); assert.equal((await saved.json()).content, safe);
    assert.equal(await fs.readFile(path.join(repo, 'topics/encoding-text.dita'), 'utf8'), safe);
    await fs.unlink(path.join(repo, 'topics/encoding-text.dita'));
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
  await t.test('Save As validates Map metadata before creating or replacing a file', async () => {
    const target = 'copy.ditamap', original = Buffer.from("<map title='Keep original'><topicref href='topics/a.dita'/></map>\r\n");
    const destination = path.join(repo, target), newFile = path.join(repo, 'invalid-copy.ditamap');
    await fs.writeFile(destination, original);
    try {
      for (const href of ['/absolute.dita', '../outside.dita', 'topics/%invalid.dita']) {
        const content = '<map><title>Rejected</title><topicref href="' + href + '"/></map>';
        for (const body of [
          { path: 'invalid-copy.ditamap', content },
          { path: target, content, overwrite: true, expectedContent: original.toString('utf8') }
        ]) {
          const response = await request('/api/file', 'POST', body);
          assert.equal(response.status, 400);
          assert.deepEqual(await fs.readFile(destination), original);
          await assert.rejects(fs.stat(newFile), { code: 'ENOENT' });
        }
      }
      const content = '<map><title>Valid copy</title><topicref href="topics/a.dita"/></map>';
      const response = await request('/api/file', 'POST', { path: target, content, overwrite: true, expectedContent: original.toString('utf8') });
      assert.equal(response.status, 201);
      const saved = await response.json();
      assert.equal(saved.saved, true); assert.equal(saved.created, false); assert.equal(saved.content, content);
      assert.equal(saved.map.title, 'Valid copy'); assert.equal(saved.map.children[0].path, 'topics/a.dita');
      assert.equal(await fs.readFile(destination, 'utf8'), content);
    } finally {
      await fs.rm(destination, { force: true }); await fs.rm(newFile, { force: true });
    }
  });
  await t.test('external Map references do not block local navigation or a successful Save As acknowledgement', async () => {
    const content = '<map><title>Mixed</title><topicref scope="external" href="https://example.invalid/manual#part"/><topicref href="topics/a.dita"/></map>';
    const resolved = await request('/api/map/resolve', 'POST', { path: 'main.ditamap', content });
    assert.equal(resolved.status, 200);
    const map = await resolved.json();
    assert.deepEqual(map.children.map(node => [node.path, node.sourcePath]), [['topics/a.dita', '2']]);
    const destination = path.join(repo, 'external-copy.ditamap');
    try {
      const response = await request('/api/file', 'POST', { path: 'external-copy.ditamap', sourcePath: 'main.ditamap', content });
      assert.equal(response.status, 201);
      const saved = await response.json();
      assert.equal(saved.saved, true); assert.equal(saved.created, true); assert.equal(saved.content, content);
      assert.deepEqual(saved.map.children, map.children);
      assert.equal(await fs.readFile(destination, 'utf8'), content);
    } finally { await fs.rm(destination, { force: true }); }
  });
  await t.test('nested Map Save As rejects unsupported bases and decoded absolute references before changing files', async () => {
    const target = 'topics/guard.ditamap', newPath = 'topics/new-guard.ditamap';
    const original = '<map><topicref href="a.dita"/></map>';
    await fs.writeFile(path.join(repo, target), original);
    try {
      for (const content of [
        '<map xml:base="other/"><topicref href="a.dita"/></map>',
        '<map><topichead xml:base="other/"><topicref href="a.dita"/></topichead></map>',
        '<map><topicref href="%2Ftmp/a.dita"/></map>',
        '<map><topicref href="%43%3A%5Cprivate.dita"/></map>',
        '<map><topicref scope="peer" href="a.dita"/></map>'
      ]) {
        for (const body of [
          { path: newPath, content },
          { path: target, content, overwrite: true, expectedContent: original }
        ]) assert.equal((await request('/api/file', 'POST', body)).status, 400);
        assert.equal(await fs.readFile(path.join(repo, target), 'utf8'), original);
        await assert.rejects(fs.stat(path.join(repo, newPath)), { code: 'ENOENT' });
      }
    } finally { await fs.rm(path.join(repo, target), { force: true }); await fs.rm(path.join(repo, newPath), { force: true }); }
  });
  await t.test('Map structure operations cannot move a local chapter into hidden or inherited resource scope', async () => {
    const disk = await fs.readFile(path.join(repo, 'main.ditamap'), 'utf8');
    for (const content of [
      '<map><topicref scope="external" href="https://example.invalid/manual"/><topicref href="topics/a.dita"/></map>',
      '<map><topichead processing-role="resource-only"/><topicref href="topics/a.dita"/></map>'
    ]) {
      const response = await request('/api/map/operation', 'POST', { path: 'main.ditamap', content, sourcePath: '1', operation: 'demote' });
      assert.equal(response.status, 409);
    }
    const content = '<map><topichead navtitle="Local"/><topicref scope="external" href="https://example.invalid/manual"/><topicref href="topics/a.dita"/></map>';
    const response = await request('/api/map/operation', 'POST', { path: 'main.ditamap', content, sourcePath: '2', operation: 'demote' });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.selectedSourcePath, '0.0'); assert.equal(result.map.children[0].children[0].path, 'topics/a.dita');
    assert.equal(await fs.readFile(path.join(repo, 'main.ditamap'), 'utf8'), disk);
  });
  await t.test('missing Map targets never resolve to archived same-name Topics', async () => {
    const archive = path.join(repo, 'topics/archive'); await fs.mkdir(archive);
    await fs.writeFile(path.join(archive, 'missing.dita'), '<topic><title>Wrong version</title></topic>');
    const response = await request('/api/map/resolve', 'POST', { path: 'main.ditamap', content: '<map><topicref href="topics/missing.dita"/></map>' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).children[0].path, 'topics/missing.dita');
    assert.equal((await request('/api/file?path=topics/missing.dita')).status, 404);
    await fs.rm(archive, { recursive: true });
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
  await t.test('repository switches update file and Git roots together and retain stale-tab protection', async () => {
    const second = path.join(temporary, 'second'); await fs.mkdir(second);
    await fs.writeFile(path.join(second, 'second.dita'), '<topic>Second repository</topic>');
    const git = (...args) => execFileSync('git', args, { cwd: second, stdio: 'ignore' });
    git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'second');
    const switched = await request('/api/repository', 'POST', { repository: second }); assert.equal(switched.status, 200);
    const next = await switched.json(); assert.equal(next.root, second); assert.notEqual(next.workspaceToken, token);
    assert.equal((await request('/api/file?path=second.dita')).status, 409);
    token = next.workspaceToken;
    assert.equal(await (await request('/api/file?path=second.dita')).text(), '<topic>Second repository</topic>');
    assert.equal((await (await request('/api/git?path=second.dita')).json()).content, '<topic>Second repository</topic>');
    const rejected = await request('/api/repository', 'POST', { repository: path.join(repo, 'topics') }); assert.equal(rejected.status, 403);
    assert.equal((await (await request('/api/workspace')).json()).root, second);
  });
  await t.test('new files cannot overwrite existing paths without a matching baseline', async () => {
    assert.equal((await request('/api/file', 'POST', { path: 'new.dita', content: '<topic/>' })).status, 201);
    assert.equal((await request('/api/file', 'POST', { path: 'new.dita', content: '<topic id="new"/>' })).status, 409);
    assert.equal((await request('/api/file', 'POST', { path: 'new.dita', content: '<topic id="new"/>', overwrite: true })).status, 409);
  });
});

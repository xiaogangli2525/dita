'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createApiHandler } = require('../lib/api-router');

function requestWorkspace(options) {
  const handler = createApiHandler({
    workspace: { snapshot: async () => ({ ready: true }) },
    git: {}, documents: {}, maps: {}, ...options
  });
  return async (host, origin) => {
    let status;
    const res = { writeHead(value) { status = value; }, end() {} };
    try {
      await handler({ method: 'GET', headers: { host, origin } }, res, '/api/workspace', new URLSearchParams());
    } catch (error) { status = error.status; }
    return status;
  };
}

test('Host and Origin share trusted IPv4, IPv6 and reverse-proxy addresses, including default ports', async () => {
  const local = requestWorkspace({ port: 80, bindHost: '127.0.0.2', publicOrigin: 'https://Docs.Example.invalid:443/' });
  for (const [host, origin] of [
    ['localhost', 'http://localhost'],
    ['127.0.0.2:80', 'http://127.0.0.2'],
    ['[::1]', 'http://[::1]'],
    ['docs.example.invalid:443', 'https://docs.example.invalid'],
    ['DOCS.EXAMPLE.INVALID', undefined]
  ]) assert.equal(await local(host, origin), 200, host);
  assert.equal(await local('localhost:81', 'http://localhost'), 403);
  assert.equal(await local('localhost', 'https://localhost'), 403);
  assert.equal(await local('docs.example.invalid', 'https://other.example.invalid'), 403);
  assert.equal(await local('other.example.invalid', undefined), 403);

  const ipv6 = requestWorkspace({ port: 5050, bindHost: '2001:0db8:0:0:0:0:0:1', publicOrigin: 'https://proxy.example.invalid:8443' });
  assert.equal(await ipv6('[2001:db8::1]:5050', 'http://[2001:db8::1]:5050'), 200);
  assert.equal(await ipv6('proxy.example.invalid:8443', 'https://proxy.example.invalid:8443'), 200);
  assert.equal(await ipv6('proxy.example.invalid:8443', 'http://proxy.example.invalid:8443'), 403);
  const wildcard = requestWorkspace({ port: 5050, bindHost: '0:0:0:0:0:0:0:0' });
  assert.equal(await wildcard('[::1]:5050', 'http://[::1]:5050'), 200);
  assert.equal(await wildcard('[::]:5050', 'http://[::]:5050'), 403);
  const demo = requestWorkspace({ port: 5050, demoMode: true });
  assert.equal(await demo('preview.example.invalid:443', 'https://preview.example.invalid'), 200);
  assert.equal(await demo('preview.example.invalid', 'https://other.example.invalid'), 403);
});

test('demo disables remote Git and serves static bytes without committing failed file responses', async t => {
  const docs = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-http-boundaries-'));
  const asset = Buffer.from([0xff, 0xfe, 0, 0xab, 0x41]);
  await Promise.all(['read.png', 'unreadable.png'].map(name => fs.writeFile(path.join(docs, name), asset)));
  const script = [
    'const fs = require("node:fs/promises"), path = require("node:path"), { server } = require("./server");',
    'const read = fs.readFile;',
    'fs.readFile = async (name, encoding) => {',
    '  if (name === path.resolve("public", "data-contracts.d.ts")) {',
    '    const bytes = Buffer.from([0xff, 0xfe, 0, 0xab, 0x41]);',
    '    return encoding ? bytes.toString(encoding) : bytes;',
    '  }',
    '  if (["diff-core.d.ts", "unreadable.png"].includes(path.basename(name)))',
    '    throw Object.assign(Error("fixture read failed"), { code: "ENOENT" });',
    '  return read(name, encoding);',
    '};',
    'server.listen(0, "127.0.0.1", () => console.log(server.address().port));'
  ].join('\n');
  const child = spawn(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOST: '127.0.0.1', PORT: '5050', PUBLIC_ORIGIN: '', DITA_DEMO_MODE: '1',
      DOCS_ROOT: docs, REPOSITORIES_ROOT: docs, DITA_SAVE_JOURNAL_DIR: path.join(docs, 'journal') }
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit');
      child.kill();
      await closed;
    }
    await fs.rm(docs, { recursive: true, force: true });
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start: ' + stderr)), 10000);
    child.stdout.once('data', data => { clearTimeout(timer); resolve(Number(String(data).trim())); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited with ' + code + ': ' + stderr)); });
  });
  const base = 'http://127.0.0.1:' + port;
  const request = (route, options = {}) => fetch(base + route, { signal: AbortSignal.timeout(5000), ...options });
  const workspace = await (await request('/api/workspace')).json();
  assert.equal(workspace.capabilities.remoteGit, false);
  assert.equal(workspace.capabilities.gitWrites, false);
  const headers = { 'x-workspace-token': workspace.workspaceToken };
  const endpoints = ['/api/remotes/branches', '/api/remotes/clone', '/api/remote/check', '/api/remote/update', '/api/remote/push'];
  for (const route of endpoints) {
    const blocked = await request(route, { method: 'POST', headers, body: '{' });
    assert.equal(blocked.status, 403, route);
    assert.match((await blocked.json()).error, /演示模式不支持远程 Git/);
  }
  assert.equal((await request('/api/remote', { headers })).status, 403);
  const resource = await request('/data-contracts.d.ts');
  assert.equal(resource.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(Buffer.from(await resource.arrayBuffer()), asset);
  const image = await request('/api/asset?path=read.png');
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), asset);
  assert.equal((await request('/diff-core.d.ts')).status, 404);
  assert.equal((await request('/api/asset?path=unreadable.png')).status, 404);
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.doesNotMatch(stderr, /ERR_HTTP_HEADERS_SENT/);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http');
const { fixture, url } = require('./remote-fixture'), { createApiHandler } = require('../lib/api-router'), { createWorkspaceLock } = require('../lib/workspace-lock');
test('remote routes enforce origin/identity and rotate workspace identity after actual updates', async t => {
  const f = await fixture(t); let token = 'initial', handler;
  const workspace = { get root() { return f.root; }, get token() { return token; }, rotateToken() { token = 'updated'; }, snapshot: async () => ({ root: f.root, workspaceToken: token }) };
  const lock = createWorkspaceLock(), server = http.createServer((req, res) => lock(req.method !== 'GET', () => { const parsed = new URL(req.url, 'http://localhost'); return handler(req, res, parsed.pathname, parsed.searchParams); }).catch(error => { res.writeHead(error.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port, base = 'http://127.0.0.1:' + port;
  handler = createApiHandler({ workspace, git: f.base, remoteRepositories: f.remote, documents: {}, maps: {}, port });
  const request = (route, body, extra = {}) => fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-workspace-token': token, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await request('/api/remotes/branches', { url }, { 'x-workspace-token': '' })).status, 409); assert.equal((await request('/api/remotes/clone', { url, name: 'blocked' }, { origin: 'https://bad.invalid' })).status, 403);
  assert.equal((await request('/api/remotes/clone', { url: 'file:///outside', name: 'blocked' })).status, 400);
  const cloned = await request('/api/remotes/clone', { url, name: 'manual' }); assert.equal(cloned.status, 201); f.select((await cloned.json()).path); await f.advance();
  const checked = await (await request('/api/remote/check', {})).json(); assert.equal(checked.behind, 1); assert.equal(token, 'initial');
  const updated = await (await request('/api/remote/update', { expectedHead: checked.head, expectedRemoteHead: checked.remoteHead })).json(); assert.equal(updated.workspace.workspaceToken, 'updated');
  assert.equal((await request('/api/remote/check', {}, { 'x-workspace-token': 'initial' })).status, 409);
  const latest = await (await request('/api/remote/check', {})).json(); assert.equal((await (await request('/api/remote/update', { expectedHead: latest.head, expectedRemoteHead: latest.remoteHead })).json()).updated, false);
});

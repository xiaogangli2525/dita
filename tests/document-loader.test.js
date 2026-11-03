'use strict';
const { createSession } = require('../public/workspace-session');
const test = require('node:test'), assert = require('node:assert/strict');
const { createDocumentLoader } = require('../public/document-loader');
const { createEvents } = require('../public/manual-core');
const store = require('../public/document-store');
function fixture() {
  const replies = [], state = { filesMap: new Map() }, events = createEvents(), api = { token: 'first', request: url => new Promise(resolve => replies.push({ url, resolve })) };
  const session = createSession(state), loader = createDocumentLoader({ state, session, api, events });
  function release(content = '<topic/>', start = 0) { replies[start].resolve(new Response(content)); replies[start + 1].resolve(new Response(JSON.stringify({ available: true, content: '<git/>', status: 'clean' }))); }
  return { state, session, events, api, loader, replies, release };
}
test('Map and tab loads share the same request and working-buffer identity', async () => {
  const f = fixture(), first = f.loader.load('a.dita'), second = f.loader.load('a.dita'); assert.equal(first, second); assert.equal(f.replies.length, 2); f.release();
  const file = await first; store.editDocument(file, '<edited/>'); assert.equal(await f.loader.load('a.dita'), file); assert.equal(file.current, '<edited/>'); assert.equal(file.history.undo.length, 1);
});
test('a delayed load never overwrites a buffer created or edited by another operation', async () => {
  const f = fixture(), loading = f.loader.load('a.dita'), file = store.createDocument({ path: 'a.dita', content: '<disk/>' }); store.editDocument(file, '<working/>'); f.session.registerDocument(file); f.release('<stale/>');
  assert.equal(await loading, file); assert.equal(file.current, '<working/>'); assert.equal(file.disk, '<disk/>'); assert.equal(file.history.undo.length, 1);
});
test('closed documents and replaced workspaces discard late loads without poisoning retries', async () => {
  const f = fixture(), closed = f.loader.load('a.dita'); f.events.emit('file:closed', 'a.dita'); f.release(); await assert.rejects(closed, /忽略旧/); assert.equal(f.state.filesMap.size, 0);
  const old = f.loader.load('a.dita'); f.events.emit('workspace:willChange'); f.api.token = 'second'; const current = f.loader.load('a.dita'); f.release('<old/>', 2); await assert.rejects(old, /忽略旧/); f.release('<new/>', 4); assert.equal((await current).current, '<new/>');
});

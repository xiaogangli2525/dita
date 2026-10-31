'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSaveCoordinator, createProposal, applyProposal } = require('../public/document-store');
const { createWorkspaceClient } = require('../public/workspace-client');
const { createWorkspaceLock } = require('../lib/workspace-lock');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('save acknowledgement preserves edits made while the request is in flight', async () => {
  let finish;
  const file = { path: 'topic.dita', current: 'sent', disk: 'old', dirty: true };
  const save = createSaveCoordinator(snapshot => {
    assert.equal(snapshot.expectedContent, 'old');
    return new Promise(resolve => { finish = resolve; });
  });
  const pending = save(file);
  await tick();
  file.current = 'typed while saving';
  assert.equal(save(file), pending, 'duplicate saves share the same operation');
  finish({ content: 'sent' });
  const result = await pending;
  assert.equal(file.current, 'typed while saving');
  assert.equal(file.disk, 'sent');
  assert.equal(file.dirty, true);
  assert.equal(result.clean, false);
});

test('failed save preserves the buffer and the disk baseline', async () => {
  const file = { path: 'a.dita', current: 'new', disk: 'old', dirty: true };
  const save = createSaveCoordinator(async () => { throw new Error('conflict'); });
  await assert.rejects(save(file), /conflict/);
  assert.deepEqual(file, { path: 'a.dita', current: 'new', disk: 'old', dirty: true });
});

test('proposals are explicit, validated, undoable edits and reject stale documents', () => {
  const file = { path: 'a.dita', current: '<old/>', disk: '<old/>' };
  const validate = value => { if (!value.startsWith('<')) throw new Error('invalid XML'); };
  assert.throws(() => createProposal({ file, workspaceToken: 'one', content: 'bad' }, validate), /invalid XML/);
  const proposal = createProposal({ file, workspaceToken: 'one', content: '<new/>' }, validate);
  assert.equal(file.current, '<old/>');
  assert.throws(() => applyProposal(proposal, { file, workspaceToken: 'two' }, validate, () => {}), /文档已变化/);
  file.current = '<edited/>';
  assert.throws(() => applyProposal(proposal, { file, workspaceToken: 'one' }, validate, () => {}), /文档已变化/);
  file.current = '<old/>';
  const undo = [];
  const applied = applyProposal(proposal, { file, workspaceToken: 'one' }, validate, (target, next) => { undo.push(target.current); target.current = next; });
  assert.equal(applied.status, 'applied');
  assert.equal(file.current, '<new/>');
  assert.equal(file.disk, '<old/>');
  file.current = undo.pop();
  assert.equal(file.current, '<old/>');
});

test('workspace client tags requests and rejects old responses including delayed bodies', async () => {
  let release;
  const client = createWorkspaceClient(async (_url, options) => {
    assert.equal(options.headers.get('x-workspace-token'), 'first');
    const response = new Response('ok');
    response.text = () => new Promise(resolve => { release = resolve; });
    return response;
  });
  client.adopt('first');
  const response = await client.request('/api/file');
  const body = response.text();
  client.adopt('second');
  release('old workspace content');
  await assert.rejects(body, /工作区已切换/);
});

test('workspace switching waits for reads and prevents later reads overtaking it', async () => {
  const lock = createWorkspaceLock();
  const events = [];
  let release;
  const first = lock(false, async () => { events.push('read'); await new Promise(resolve => { release = resolve; }); events.push('read complete'); });
  const switcher = lock(true, async () => { events.push('switch'); });
  const later = lock(false, async () => { events.push('next read'); });
  await tick();
  assert.deepEqual(events, ['read']);
  release();
  await Promise.all([first, switcher, later]);
  assert.deepEqual(events, ['read', 'read complete', 'switch', 'next read']);
});

test('one document mutation boundary preserves disk/baseline through edit, undo and redo', () => {
  const { editDocument, travelHistory } = require('../public/document-store');
  const file = { current: '<old/>', disk: '<old/>', baseline: '<git/>' };
  editDocument(file, '<new/>');
  assert.equal(file.dirty, true);
  travelHistory(file, 'undo'); assert.equal(file.current, '<old/>'); assert.equal(file.dirty, false);
  travelHistory(file, 'redo'); assert.equal(file.current, '<new/>');
  assert.equal(file.disk, '<old/>'); assert.equal(file.baseline, '<git/>');
  editDocument(file, '<new/>', { historyMeta: { reviewDecisionsBefore: new Map(), reviewDecisionsAfter: new Map([[1, 'accept']]) } });
  assert.equal(travelHistory(file, 'undo').reviewDecisionsAfter.get(1), 'accept');
});

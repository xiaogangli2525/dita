'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { createHash } = require('node:crypto');
const core = require('../public/ai-edit-core'), { createTaskStore, fingerprint } = require('../public/ai-task-store');
const identity = { root: '/docs', branch: 'main', path: 'main.ditamap' };
function fixture() {
  const source = '<topic><title>HTTP</title><body><p>发送请求</p></body></topic>', start = source.indexOf('发送');
  const result = { summary: '统一表述', questions: [], edits: [{ id: 't0', before: '发送请求', after: '发起请求' }] };
  return { filePath: 'main.ditamap', scope: 'manual', reply: '继续润色', search: '请求', model: 'ML307G',
    target: { path: 'a.dita', source, start, end: start + 4, kind: 'range', query: '' },
    history: { instructions: ['统一表述'], previousResult: result }, transcript: [{ kind: 'turn', instruction: '统一表述', ...result }], proposal: true, manual: null, fromScan: false };
}
function storage() { const data = new Map(); return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; }

test('AI recovery retains scoped conversation and draft while dropping credentials and executable/UI data', () => {
  const disk = storage(), task = fixture(), store = createTaskStore(disk);
  store.save(identity, { ...task, key: 'secret', configuration: { key: 'secret' }, html: '<script/>', busy: true });
  const saved = createTaskStore(disk).load(identity);
  assert.equal(saved.reply, task.reply); assert.equal(saved.model, task.model); assert.equal(saved.selected.path, 'a.dita');
  assert.deepEqual(saved.history.instructions, ['统一表述']); assert.equal(saved.proposal, true);
  assert.equal(core.applyResult(saved.selected, saved.history.previousResult).content, task.target.source.replace('发送', '发起'));
  assert.doesNotMatch([...disk.data.values()][0], /secret|configuration|<script|"busy"|"parts"/);
});

test('AI task keys isolate repository, branch and opened manual or Topic', () => {
  const disk = storage(), store = createTaskStore(disk); store.save(identity, fixture());
  for (const changed of [{ root: '/other' }, { branch: 'release' }, { path: 'a.dita' }]) assert.equal(store.load({ ...identity, ...changed }), null);
  store.remove(identity); assert.equal(store.load(identity), null); assert.equal(disk.data.size, 0);
});

test('damaged or stale-patch records remain on disk and cannot become an active proposal', () => {
  const disk = storage(), store = createTaskStore(disk); store.save(identity, fixture());
  const key = [...disk.data.keys()][0], original = JSON.parse(disk.data.get(key));
  original.history.previousResult.edits[0].before = '原文已过期'; const damaged = JSON.stringify(original); disk.data.set(key, damaged);
  const recovered = createTaskStore(disk); assert.equal(recovered.load(identity), null); assert.match(recovered.warning, /原始数据已保留/);
  recovered.save(identity, fixture()); assert.equal(disk.data.get(key), damaged, 'automatic checkpoint must not overwrite damaged recovery data');
  recovered.remove(identity); recovered.save(identity, fixture()); assert.ok(createTaskStore(disk).load(identity));
});

test('quota or denied storage keeps the current-page recovery copy with a visible warning', () => {
  const store = createTaskStore({ getItem() { return null; }, setItem() { throw Error('quota'); }, removeItem() {} });
  store.save(identity, fixture()); assert.match(store.warning, /仅保留在本页/); assert.equal(store.load(identity).reply, '继续润色');
  const unavailable = createTaskStore(null); unavailable.save(identity, fixture()); assert.ok(unavailable.load(identity)); assert.match(unavailable.warning, /存储不可用/);
});

test('malformed target ranges, missing context and oversized replies cannot replace a valid task', () => {
  const disk = storage(), store = createTaskStore(disk); store.save(identity, fixture());
  const raw = [...disk.data.values()][0];
  for (const changed of [{ target: { ...fixture().target, path: '../a.dita' } }, { target: { ...fixture().target, end: 99999 } },
    { history: null }, { reply: 'x'.repeat(6001) }, { transcript: Array(25).fill({ kind: 'applied', text: '' }) }]) {
    store.save(identity, { ...fixture(), ...changed }); assert.equal([...disk.data.values()][0], raw);
  }
});

test('manual recovery fingerprints include models, rule contents and every referenced source', async () => {
  const digest = value => Promise.resolve(createHash('sha256').update(value).digest('hex'));
  const snapshot = { path: 'main.ditamap', content: '<map/>', project: { schema: 1, models: ['M100'] }, projectContent: '{}',
    noteRules: { expectedContent: null }, files: new Map([['b.dita', { current: 'B' }], ['a.dita', { current: 'A' }]]) };
  const before = await fingerprint(snapshot, digest);
  assert.equal(await fingerprint({ ...snapshot, files: new Map([...snapshot.files].reverse()) }, digest), before);
  for (const changed of [{ content: '<map product="M100"/>' }, { project: { schema: 1, models: ['M200'] } },
    { noteRules: { expectedContent: 'changed' } }, { files: new Map([['a.dita', { current: 'Changed' }], ['b.dita', { current: 'B' }]]) }]) assert.notEqual(await fingerprint({ ...snapshot, ...changed }, digest), before);
});

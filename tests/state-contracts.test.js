'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createSession } = require('../public/workspace-session');
const store = require('../public/document-store');
const { createSnapshot } = require('../public/snapshot-data');
const { createRecord } = require('../public/delivery-data');
const workspace = () => ({ root: '/docs', workspaceToken: 'one', files: [{ path: 'a.dita' }],
  maps: [{ path: 'main.ditamap', title: 'Disk', children: [{ path: 'a.dita' }] }], currentBranch: 'main' });
const document = path => store.createDocument({ path, content: '<topic/>' });
function fixture() { const state = {}, session = createSession(state); session.replaceWorkspace(workspace()); return { state, session }; }

test('workspace domain views reject direct writes, including nested metadata and collection backdoors', () => {
  const { state, session } = fixture(), file = session.registerDocument(document('a.dita'));
  for (const write of [() => { state.activePath = 'x'; }, () => { state.maps = []; }, () => state.maps.push({ path: 'x' }),
    () => { state.maps[0].children[0].path = 'x'; }, () => { state.capabilities.git = false; },
    () => state.filesMap.clear(), () => state.mapAuthorPaths.add('x')]) assert.throws(write, TypeError);
  state.filesMap.forEach((value, key, view) => { assert.equal(value, file); assert.equal(key, file.path); assert.equal(view, state.filesMap); assert.equal(view.set, undefined); });
  session.activateDocument(file.path); assert.equal(state.activePath, file.path);
  session.setAuthorPaths([file.path]); assert.equal(state.mapAuthorPaths.has(file.path), true);
  assert.throws(() => session.setMode('other'), /模式/); assert.equal(state.mode, 'visual');
});

test('session commands retain buffer identity and history, close stale undo targets and isolate workspaces', () => {
  const first = fixture(), second = fixture(), file = first.session.registerDocument(document('a.dita'));
  store.editDocument(file, '<edited/>'); first.session.activateDocument(file.path);
  assert.equal(first.session.registerDocument(document(file.path)), file); assert.equal(file.history.undo.length, 1);
  first.session.registerDocument(document('b.dita')); first.session.setHistoryTarget('b.dita');
  first.session.closeDocument('b.dita'); assert.equal(first.state.historyTargetPath, file.path);
  first.session.replaceWorkspace({ ...workspace(), root: '/new', workspaceToken: 'two' });
  assert.equal(first.state.filesMap.size, 0); assert.equal(first.state.activePath, ''); assert.equal(first.state.mapAuthorPaths.size, 0);
  assert.equal(second.state.root, '/docs'); assert.equal(file.current, '<edited/>'); assert.equal(file.disk, '<topic/>');
});

test('directory refresh preserves unsaved Map projection while taking fresh disk data for clean Maps', () => {
  const { state, session } = fixture(), file = session.registerDocument(document('main.ditamap'));
  store.editDocument(file, '<map><title>Working</title></map>');
  session.upsertMap({ path: file.path, title: 'Working', children: [{ path: 'unsaved.dita' }] });
  session.selectMapSource('0/1'); session.refreshDirectory(workspace());
  assert.equal(state.maps[0].title, 'Working'); assert.equal(state.maps[0].children[0].path, 'unsaved.dita'); assert.equal(state.selectedMapSourcePath, '0/1');
  store.acknowledgeSave(file, { content: file.current }, true); session.refreshDirectory(workspace());
  assert.equal(state.maps[0].title, 'Disk'); assert.equal(state.filesMap.get(file.path), file);
  assert.throws(() => session.replaceWorkspace({ ...workspace(), maps: [null] }), /响应无效/); assert.equal(state.filesMap.get(file.path), file);
});

test('save boundaries pin the request and reject mismatched acknowledgements without moving disk', async () => {
  const file = document('a.dita'); store.editDocument(file, '<edited/>');
  const request = { path: file.path, content: file.current, expectedContent: file.disk };
  const saved = store.createSaveCoordinator(async captured => { assert.equal(Object.isFrozen(captured), true); return { path: captured.path, content: captured.content }; });
  const pending = saved(file, request); request.content = '<tampered/>'; await pending; assert.equal(file.disk, '<edited/>');
  for (const result of [{ path: 'b.dita', content: '<wrong/>' }, { content: false }, { content: '<wrong/>', created: 'yes' }]) {
    const before = store.snapshotDocument(file);
    await assert.rejects(store.createSaveCoordinator(async () => result)(file), /不匹配/); assert.deepEqual(store.snapshotDocument(file), before);
  }
  let sent = false; await assert.rejects(store.createSaveCoordinator(async () => { sent = true; })(file, { path: 'wrong', content: 'x', expectedContent: '' }), /不匹配/); assert.equal(sent, false);
});

function manual() {
  const file = document('a.dita');
  return { workspace: 'one', root: '/docs', branch: 'main', path: file.path, content: file.current,
    capturedAt: '2026-11-03T00:00:00.000Z', map: { path: file.path, children: [{ path: file.path }] },
    files: new Map([[file.path, file]]), buffers: new Map([[file.path, store.snapshotDocument(file)]]),
    project: { schema: 1, models: ['M100'] }, projectContent: null, noteRules: null, filter: null };
}
test('manual snapshots detach every nested capture value and hide writable Map instances', () => {
  const input = manual(), captured = createSnapshot(input);
  input.project.models.push('M200'); input.map.children[0].path = 'changed'; input.files.get('a.dita').current = '<changed/>'; input.buffers.clear();
  assert.deepEqual(captured.project.models, ['M100']); assert.equal(captured.map.children[0].path, 'a.dita'); assert.equal(captured.files.get('a.dita').current, '<topic/>'); assert.equal(captured.buffers.size, 1);
  for (const change of [() => captured.files.set('b', {}), () => captured.buffers.clear(), () => { captured.files.get('a.dita').current = 'bad'; },
    () => { captured.map.children[0].path = 'bad'; }, () => captured.project.models.push('M200')]) assert.throws(change, TypeError);
});

test('delivery records hash exactly the captured sources and compiled bytes without sharing mutable summaries', async () => {
  const snapshot = createSnapshot(manual()), report = { model: 'M100', included: 1, excluded: 2, unmarked: 0, unused: 0 }, source = { commit: 'abc', dirty: true };
  const request = { snapshot, source, data: { output: new Blob(['PDF bytes']), previewHtml: '<p>preview</p>', report }, model: 'M100', format: 'pdf', version: 'v1', filename: 'HTTP.pdf', prefixes: true, unsavedPaths: ['a.dita'] };
  const hashed = [], record = await createRecord(request, async value => { const text = typeof value === 'string' ? value : await value.text(); hashed.push(text); return 'hash:' + text; });
  assert.equal(record.outputSha256, 'hash:PDF bytes'); assert.equal(record.documents[0].sha256, 'hash:<topic/>'); assert.equal(record.modelNotePrefixPolicy, 'explicit-prefix-v1');
  report.included = 99; source.commit = 'new'; request.unsavedPaths.length = 0;
  assert.equal(record.report.included, 1); assert.equal(record.source.commit, 'abc'); assert.deepEqual(record.unsavedPaths, ['a.dita']); assert.equal(hashed.includes('<p>preview</p>'), false);
  await assert.rejects(createRecord({ ...request, format: 'word' }, async () => ''), /格式/);
});

test('lint enforces document, workspace and review mutation ownership', async () => {
  const { ESLint } = require('eslint'), lint = new ESLint();
  const source = `function mutate(state,file,A) { state.root='x'; A.state.mode='editor'; state.filesMap.clear(); file.disk='x'; state.reviewCurrent='x'; } module.exports=mutate;`;
  const [controller] = await lint.lintText(source, { filePath: 'public/document-navigation.js' });
  assert.equal(controller.messages.filter(item => item.ruleId === 'no-restricted-syntax').length, 5);
  const [reviewResult] = await lint.lintText(`function mutate(state) { state.reviewDecisions.set(0,'accept'); state.reviewGroups.clear(); } module.exports=mutate;`, { filePath: 'public/review.js' });
  assert.equal(reviewResult.messages.filter(item => item.ruleId === 'no-restricted-syntax').length, 2);
  const [storeResult] = await lint.lintText(source, { filePath: 'public/document-store.js' });
  assert.equal(storeResult.errorCount, 0);
});

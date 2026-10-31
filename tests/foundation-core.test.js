'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createManualService } = require('../public/manual-service');
const { createDraftStore } = require('../public/draft-store');
const { createReleaseStore } = require('../public/release-store');
const domain = require('../public/manual-core');
const notes = require('../public/footnotes-core');
const publication = require('../public/publication-core');
const { findMatches } = require('../public/search-core');
const core = require('../public/app-core');
function storage() {
  const map = new Map(); return { get length() { return map.size; }, key: index => [...map.keys()][index], getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
function app() {
  const source = '<topic id="t"><body><p>Command<fn conref="shared.dita#s/n"/></p><p><xref href="shared.dita#s/n" type="fn"/></p></body></topic>';
  const resource = '<topic id="s"><body><section product="M100"><fn id="n">SHARED</fn></section></body></topic>';
  const state = { root: '/docs', currentBranch: 'main', activePath: 'main.ditamap', filesMap: new Map([
    ['main.ditamap', { path: 'main.ditamap', current: '<map/>', disk: '<map/>', dirty: false }],
    ['topic.dita', { path: 'topic.dita', current: source, disk: source, dirty: false }],
    ['shared.dita', { path: 'shared.dita', current: resource.replace('SHARED', 'WORKING'), disk: resource, dirty: true }],
    ['other.dita', { path: 'other.dita', current: '<topic>dirty</topic>', disk: '<topic/>', dirty: true }]
  ]) };
  const A = { state, project: { value: { schema: 1, models: ['M100', 'M200'] }, expectedContent: 'config' }, ditaCore: core,
    api: { token: 'one', request: async url => { assert.equal(url, '/api/map/resolve'); return { ok: true, json: async () => ({ title: 'Function', children: [{ type: 'file', path: 'topic.dita' }] }) }; }, error: async () => 'failed' } };
  return A;
}
test('manual snapshot shares buffers, dependency save scope and the exact note publication origins', async () => {
  const A = app(), service = createManualService(A), snapshot = await service.capture();
  assert.deepEqual([...snapshot.files.keys()], ['topic.dita', 'shared.dita']);
  assert.deepEqual(service.saveCandidates(snapshot).map(file => file.path), ['shared.dita']);
  assert.match(snapshot.files.get('shared.dita').current, /WORKING/);
  const data = service.listNotes(snapshot, 'M100');
  assert.equal(data.notes.length, data.report.included);
  const external = data.notes.find(note => note.reused);
  assert.equal(external.sourceNote.path, 'shared.dita');
  assert.equal(external.sourceNote.source, A.state.filesMap.get('shared.dita').current);
  A.state.filesMap.get('shared.dita').current += ' ';
  assert.equal(service.current(snapshot), false);
});
test('manual snapshots become stale after save acknowledgements, project updates and workspace switches', async () => {
  for (const change of [A => { A.state.filesMap.get('shared.dita').disk += ' '; }, A => { A.project.expectedContent = 'next'; }, A => { A.api.token = 'next'; }, A => { A.state.filesMap.delete('topic.dita'); }]) {
    const A = app(), service = createManualService(A), snapshot = await service.capture(); change(A); assert.equal(service.current(snapshot), false);
  }
});
test('project registry rejects typos during delivery while source notes remain editable', async () => {
  const A = app(); A.state.filesMap.get('shared.dita').current = A.state.filesMap.get('shared.dita').current.replace('M100', 'M1O0');
  const service = createManualService(A), snapshot = await service.capture();
  assert.throws(() => service.prepare(snapshot), /未登记型号/);
  assert.equal(service.listNotes(snapshot).notes.length, 2);
  assert.deepEqual(domain.checkModels(['M100', 'M1O0'], A.project.value), ['M1O0']);
  assert.throws(() => domain.validateProject({ schema: 1, models: ['M100', 'M100'] }), /重复/);
  assert.throws(() => domain.validateProject({ schema: 1, models: ['M 100'] }), /型号/);
});
test('confirmed common notes retain unrelated metadata and remain distinct from unknown applicability', () => {
  const source = '<topic id="t"><body><p>Context<fn otherprops="market(cn)">Note &amp; text</fn></p></body></topic>';
  const note = notes.listFootnotes(source)[0];
  const updated = notes.updateFootnote(source, note, { content: note.text, common: true });
  assert.match(updated, /market\(cn\) applicability\(common\)/);
  const data = publication.prepareTopic(updated, 'a.dita', 'M100');
  assert.equal(data.report.included, 1); assert.equal(data.report.unmarked, 0);
  assert.equal(notes.listFootnotes(updated)[0].common, true);
  const inherited = '<topic><body product="M100"><p><fn>Restricted</fn></p></body></topic>', restricted = notes.listFootnotes(inherited)[0];
  assert.equal(notes.filterNotes([restricted], 'M200').length, 0);
  assert.throws(() => notes.updateFootnote(inherited, restricted, { content: restricted.text, common: true }), /祖先条件/);
  assert.throws(() => publication.prepareTopic(inherited.replace('<fn>', '<fn otherprops="applicability(common)">'), 'a.dita'), /通用注脚与型号条件冲突/);
});
test('drafts are isolated by repository and branch and retain their comparison base', () => {
  const data = storage(), store = createDraftStore(data), scope = { root: '/repo-a', branch: 'main' };
  const file = { path: 'topic.dita', current: '<topic>Unsaved</topic>', disk: '<topic/>', dirty: true };
  store.put(scope, file);
  assert.equal(store.list(scope)[0].base, file.disk);
  assert.equal(store.list({ ...scope, branch: 'other' }).length, 0);
  assert.equal(store.list({ ...scope, root: '/repo-b' }).length, 0);
  data.setItem('dita.draft.v1:broken', '{bad'); assert.equal(store.list(scope).length, 1);
  store.put(scope, { ...file, dirty: false }); assert.equal(store.list(scope).length, 0);
  assert.throws(() => createDraftStore({ setItem() { throw new Error('quota'); } }).put(scope, file), /quota/);
});
test('plaintext search crosses inline markup, decodes entities and returns exact source selection ranges', () => {
  const source = '<?xml version="1.0"?><topic><body><p>TCP <b>connection</b> &amp; MQTT</p><p>中文参数 <![CDATA[AT+OPEN]]></p></body></topic>';
  for (const [query, span] of [['TCP connection', 'TCP <b>connection'], ['& MQTT', '&amp; MQTT'], ['中文参数', '中文参数'], ['AT+OPEN', 'AT+OPEN']]) {
    const [hit] = findMatches(source, query); assert.ok(hit, query); assert.equal(source.slice(hit.start, hit.end), span); assert.equal(hit.matchedSource, span);
  }
  assert.equal(findMatches(source, 'xml version').length, 0);
  assert.equal(findMatches(source, '').length, 0);
  assert.equal(findMatches('<topic><p>A A A</p></topic>', 'a', 2).length, 2);
});
test('release history is bounded, repository-isolated and stores only caller-provided provenance records', () => {
  const store = createReleaseStore(storage());
  for (let i = 0; i < 55; i++) store.append('/a', { schema: 1, manualPath: 'main.ditamap', index: i, source: { commit: 'abc' } });
  assert.equal(store.list('/a').length, 50); assert.equal(store.list('/a')[0].index, 54); assert.equal(store.list('/b').length, 0);
  assert.equal('current' in store.list('/a')[0], false);
});

test('a failing extension listener cannot interrupt document events for other features', () => {
  const errors = [], events = domain.createEvents(error => errors.push(error.message)), received = [];
  events.on('changed', () => { throw new Error('extension failed'); }); events.on('changed', value => received.push(value));
  events.emit('changed', 'new'); assert.deepEqual(errors, ['extension failed']); assert.deepEqual(received, ['new']);
});

test('XML downloads normalize their declaration to the browser UTF-8 bytes without changing the editor source', async () => {
  const vm = require('node:vm'), fs = require('node:fs'); let output;
  const sandbox = { window: {}, Blob, URL: { createObjectURL(blob) { output = blob; return 'blob:test'; }, revokeObjectURL() {} }, setTimeout: fn => fn(), document: { body: { append() {} }, createElement: () => ({ click() {}, remove() {} }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/browser-files'), 'utf8'), sandbox);
  const source = '<?xml version="1.0" encoding="GBK"?><topic>中文</topic>';
  sandbox.window.DitaBrowserFiles.downloadXML(source, 'topic.xml');
  assert.equal(await output.text(), '<?xml version="1.0" encoding="UTF-8"?><topic>中文</topic>');
  assert.match(source, /encoding="GBK"/);
});

test('manual capture waits for project identity before freezing its model rules', async () => {
  const A = app(); let release, requested = false;
  A.project.ready = () => new Promise(resolve => { release = resolve; });
  const request = A.api.request; A.api.request = (...args) => { requested = true; return request(...args); };
  const promise = createManualService(A).capture(); assert.equal(requested, false);
  A.project.value = { schema: 1, models: ['M100', 'M200', 'M300'] }; A.project.expectedContent = 'latest'; release();
  const snapshot = await promise; assert.deepEqual(snapshot.project.models, ['M100', 'M200', 'M300']); assert.equal(snapshot.projectContent, 'latest');
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { compose, start } = require('../public/application');
const store = require('../public/document-store');

test('document construction and frozen snapshots keep disk, Git base and undo ownership separate', () => {
  const file = store.createDocument({ path: 'a.dita', content: '<topic>disk</topic>', baseline: '<topic>git</topic>', gitStatus: 'modified' });
  store.editDocument(file, '<topic>working</topic>'); const snapshot = store.snapshotDocument(file);
  assert.equal(snapshot.dirty, true); assert.equal(snapshot.disk, '<topic>disk</topic>'); assert.equal(snapshot.baseline, '<topic>git</topic>');
  assert.equal(Object.hasOwn(snapshot, 'history'), false); assert.equal(Object.isFrozen(snapshot), true);
  store.travelHistory(file, 'undo'); assert.equal(file.current, file.disk); assert.equal(snapshot.current, '<topic>working</topic>');
  assert.throws(() => store.createDocument({ path: '', content: '' }), /路径/);
});

test('feature contexts expose only declared capabilities, resolve late services and limit writes', () => {
  const host = { state: {}, saving: false, secret: 'not a feature dependency' }; let firstContext;
  compose(host, [
    { name: 'first', ports: ['state', 'saving', 'second'], writable: ['saving'], create: context => { firstContext = context; return { read: () => context.second.value }; } },
    { name: 'second', ports: [], create: () => ({ value: 42 }) }
  ]);
  assert.equal(host.first.read(), 42); assert.equal(firstContext.secret, undefined); assert.equal(Object.isFrozen(firstContext), true);
  assert.throws(() => { firstContext.state = {}; }, TypeError); firstContext.saving = true; assert.equal(host.saving, true);
  assert.deepEqual(Object.keys(firstContext), ['state', 'saving', 'second']);
});

test('composition validates the full initialization plan before invoking a feature factory', () => {
  for (const bad of [
    { name: 'bad', ports: ['missing'], create() {} },
    { name: 'bad', ports: [], requires: ['later'], create() {} },
    { name: 'bad', ports: [] },
    { name: 'bad', ports: ['state'], writable: ['missing'], create() {} }
  ]) {
    let installed = false; const host = { state: {} };
    assert.throws(() => compose(host, [{ name: 'first', ports: [], create: () => { installed = true; } }, bad]));
    assert.equal(installed, false); assert.equal(Object.hasOwn(host, 'first'), false);
  }
  assert.throws(() => compose({}, [{ name: 'first', create() {}, expose: ['later'] }, { name: 'later', create() {} }]), /重复/);
});

test('composition preserves live public getters without sharing controller state across applications', () => {
  const definition = { name: 'service', ports: [], expose: ['lastResult'], create() { let result = null; return { set: value => { result = value; }, get lastResult() { return result; } }; } };
  const first = compose({}, [definition]), second = compose({}, [definition]);
  first.service.set('first'); assert.equal(first.lastResult, 'first'); assert.equal(second.lastResult, null);
  assert.throws(() => compose(first, [definition]), /重复初始化/);
});

test('missing browser modules fail startup with a named dependency instead of partially wiring the app', () => {
  assert.throws(() => start({ state: {}, api: {}, ditaCore: {} }, {}, {}), /缺少功能工厂：manual/);
});

test('loading the delivery module registers a factory without touching DOM or the application facade', () => {
  let touched = 0;
  const window = new Proxy({}, { get(target, key) { if (key === 'DitaApp') touched++; return target[key]; } });
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/export'), 'utf8'), { window, document: new Proxy({}, { get() { throw Error('DOM touched during module load'); } }) });
  assert.equal(typeof window.DitaExport.createExportController, 'function'); assert.equal(touched, 0); assert.equal(Object.hasOwn(window, 'DitaApp'), false);
});

test('domain modules stay independent of application, UI and filesystem controllers', () => {
  const directory = path.join(__dirname, '../public');
  for (const name of ['manual-core', 'xml-source', 'document-store', 'footnotes-core', 'publication-core', 'publication-resolver', 'table-core', 'search-core', 'reference-paths', 'note-reuse-core']) {
    const source = fs.readFileSync(path.join(directory, name + '.js'), 'utf8');
    assert.doesNotMatch(source, /(?:window|root)\.DitaApp|require\(['"]\.\/(?:app|editor-controller|export|workspace-shell|save|documents)['"]\)/, name);
  }
});

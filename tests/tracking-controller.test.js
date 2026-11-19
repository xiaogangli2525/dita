'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const store = require('../public/document-store'), core = require('../public/oxygen-tracking'), oxygen = require('../public/oxygen-core');
const { createEvents } = require('../public/manual-core');
function fixture() {
  const nodes = new Map(), saved = new Map(), events = createEvents();
  function get(id) {
    if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, open: false, textContent: '', listeners: new Map(), attributes: new Map(),
      addEventListener(type, callback) { this.listeners.set(type, callback); }, setAttribute(name, value) { this.attributes.set(name, value); }, showModal() { this.open = true; }, close() { this.open = false; } });
    return nodes.get(id);
  }
  const original = '<topic><title>T</title><body><codeblock>TIMEOUT=30</codeblock></body></topic>';
  const file = store.createDocument({ path: 'a.dita', content: original });
  const state = { activePath: file.path, filesMap: new Map([[file.path, file]]), mapAuthorPaths: new Set() };
  const A = { state, dom: { editor: {} }, api: { token: 'workspace-1' }, events, toast() {}, setStatus() {},
    setFileContent(file, content, options) { assert.equal(options.origin, 'tracking'); store.editDocument(file, content); events.emit('document:changed', file); } };
  const window = { DitaOxygenTracking: core, DitaOxygenCore: oxygen, crypto: { randomUUID: () => 'controller' }, localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/editor/tracking'), 'utf8'), { window, document: { getElementById: get } });
  const controller = window.DitaTracking.createController(A), submit = () => get('trackingForm').listeners.get('submit')({ preventDefault() {} });
  return { A, file, original, controller, get, submit, saved };
}
test('tracking settings validate author, persist native mode and preserve existing records when disabled', () => {
  const f = fixture(); f.controller.show(); f.get('trackingEnabled').checked = true; f.submit();
  assert.match(f.get('trackingError').textContent, /修订作者/); assert.equal(f.file.current, f.original);
  f.get('trackingAuthor').value = 'QA'; f.submit();
  assert.equal(core.enabled(f.file.current), true); assert.equal(f.A.dom.editor.readOnly, true); assert.equal(f.get('reviewScope').value, 'oxygen');
  const revision = f.controller.prepare(f.file, f.file.current.replace('30', '60')); store.editDocument(f.file, revision);
  assert.equal(core.resolve(revision, false), core.setEnabled(f.original, true));
  f.controller.show(); f.get('trackingEnabled').checked = false; f.submit();
  assert.equal(core.enabled(f.file.current), false); assert.match(f.file.current, /oxy_delete/); assert.equal(f.A.dom.editor.readOnly, false);
  const untracked = f.file.current.replace('TIMEOUT', 'TIMEOUT2'); assert.equal(f.controller.prepare(f.file, untracked), untracked);
  assert.equal(f.saved.get('dita.tracking.author'), 'QA');
});
test('settings cannot overwrite edits or a workspace switch that occurred while the dialog was open', () => {
  const f = fixture(); f.controller.show(); f.get('trackingEnabled').checked = true; f.get('trackingAuthor').value = 'QA';
  store.editDocument(f.file, f.original.replace('30', '60')); f.submit();
  assert.match(f.get('trackingError').textContent, /已变化/); assert.equal(f.file.current, f.original.replace('30', '60'));
  f.controller.show(); f.A.api.token = 'workspace-2'; f.submit(); assert.match(f.get('trackingError').textContent, /已变化/);
  f.A.events.emit('workspace:willChange'); assert.equal(f.get('trackingDialog').open, false);
});
test('Map setting overrides child mode in the active manual while independent Topics keep their own flag', () => {
  const f = fixture(), map = store.createDocument({ path: 'main.ditamap', content: '<map><title>M</title><topicref href="a.dita"/></map>' });
  f.A.state.filesMap.set(map.path, map); f.A.state.activePath = map.path; f.A.state.mapAuthorPaths.add(f.file.path);
  f.controller.show(); f.get('trackingEnabled').checked = true; f.get('trackingAuthor').value = 'QA'; f.submit();
  const revision = f.controller.prepare(f.file, f.file.current.replace('30', '60')); assert.match(revision, /oxy_insert_start/);
  store.editDocument(f.file, revision); f.controller.show(); f.get('trackingEnabled').checked = false; f.submit();
  assert.equal(f.controller.prepare(f.file, f.file.current.replace('TIMEOUT', 'NEXT')), f.file.current.replace('TIMEOUT', 'NEXT'));
  f.A.state.activePath = f.file.path; assert.match(f.controller.prepare(f.file, f.file.current.replace('TIMEOUT', 'NEXT')), /oxy_delete/);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createController } = require('../public/map-author-controller');
const { createEvents } = require('../public/manual-core');
const { validateXml } = require('../public/xml-source');
const { buildMockDom } = require('./dom-mock');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function setup() {
  const { document } = buildMockDom(), visualEditor = document.createElement('div');
  const file = { path: 'main.ditamap', current: '<map><title>HTTP</title></map>' };
  const state = { activePath: file.path, mode: 'visual', filesMap: new Map([[file.path, file]]), maps: [{ path: file.path, title: 'HTTP', children: [{ path: 'slow.dita' }] }] };
  const events = createEvents(), loaded = deferred(), response = deferred(), requested = deferred(), messages = [];
  const api = { token: 'first', request: () => { requested.resolve(); return response.promise; } };
  const controller = createController({ state, dom: { visualEditor }, api, events, validateXml, ditaCore: { collectPreviewPaths: entries => entries }, setStatus: message => messages.push(message) }, {
    load: () => loaded.promise, documentLabel: file => file.path, renderTabs() {}, updateTree() {}, renderInspector() {}, renderMapReview() {}
  });
  return { controller, state, api, file, events, loaded, response, requested, messages, visualEditor };
}

test('a late Map success or failure cannot replace a newer document, mode or workspace', async () => {
  for (const transition of ['document', 'source', 'workspace', 'replacement']) for (const failed of [false, true]) {
    const view = setup(), pending = view.controller.render(view.file);
    assert.match(view.visualEditor.textContent, /正在加载/);
    if (transition === 'document') view.state.activePath = 'new.dita';
    if (transition === 'source') { view.state.mode = 'editor'; view.controller.invalidate(); }
    if (transition === 'workspace') { view.events.emit('workspace:willChange'); view.api.token = 'second'; }
    if (transition === 'replacement') view.state.filesMap.set(view.file.path, { ...view.file });
    view.visualEditor.textContent = 'New surface';
    if (failed) view.loaded.reject(Error('Old workspace failure'));
    else view.loaded.resolve({ path: 'slow.dita', current: '<topic/>' });
    await pending;
    assert.equal(view.visualEditor.textContent, 'New surface', transition);
    assert.deepEqual(view.messages, []);
  }
});

test('a resolved Map refresh cannot publish a directory or error after a workspace switch', async () => {
  for (const failed of [false, true]) {
    const view = setup();
    view.controller.scheduleRefresh(view.file); await view.requested.promise;
    view.events.emit('workspace:willChange'); view.api.token = 'second';
    if (failed) view.response.reject(Error('Late failure'));
    else view.response.resolve({ ok: true, json: async () => ({ path: view.file.path, title: 'Stale result' }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.state.maps[0].title, 'HTTP'); assert.deepEqual(view.messages, []);
  }
});

test('current refresh failures explain the problem while independent controllers keep their own jobs', async () => {
  const first = setup(), second = setup();
  first.controller.scheduleRefresh(first.file); second.controller.scheduleRefresh(second.file);
  await Promise.all([first.requested.promise, second.requested.promise]);
  first.events.emit('workspace:willChange');
  first.response.reject(Error('Cancelled workspace'));
  second.response.resolve({ ok: false, status: 503 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(first.messages, []);
  assert.match(second.messages[0], /503.*修改仍保留/);
  assert.equal(second.file.current, '<map><title>HTTP</title></map>');
});

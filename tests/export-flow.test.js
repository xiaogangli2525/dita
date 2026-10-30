'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { buildMockDom } = require('./visual-harness');
const core = require('../public/app-core');
function harness() {
  buildMockDom();
  const source = '<topic id="a"><title>Working title</title><body><p>Unsaved edit</p><image href="image.png"/></body></topic>';
  const state = { activePath: 'main.ditamap', filesMap: new Map([
    ['main.ditamap', { path: 'main.ditamap', current: '<map/>' }],
    ['a.dita', { path: 'a.dita', current: source }]
  ]) };
  const map = { path: 'main.ditamap', title: 'Guide', children: [{ type: 'file', path: 'a.dita' }] };
  const pane = () => ({ classList: { remove() {}, toggle() {} } });
  let blob;
  const A = { state, ditaCore: core, dom: { editorPane: pane(), visualPane: pane(), previewPane: pane(), htmlPreviewPane: pane(), mdPreviewPane: pane(), htmlPreviewFrame: {} },
    api: { token: 'workspace', request: async url => {
      if (url === '/api/map/resolve') return { ok: true, json: async () => map };
      throw new Error('Unexpected disk read: ' + url);
    }, error: async () => 'failure' },
    setStatus(message, error) { A.status = message; A.failed = error; },
    showLoading() { A.loading = true; }, hideLoading() { A.loading = false; }
  };
  const sandbox = { window: { DitaApp: A, addEventListener() {} }, Blob, setTimeout: callback => callback(),
    URL: { createObjectURL(value) { blob = value; return 'blob:test'; }, revokeObjectURL() {} },
    document: { body: { append() {} }, createElement() { return { click() {}, remove() {} }; } }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/export.js'), 'utf8'), sandbox);
  A.browserLoadImageBytes = async () => 'data:image/png;base64,AAAA';
  return { A, output: async () => blob?.text() };
}
test('HTML download uses working buffers and embeds images just like preview', async () => {
  const { A, output } = harness();
  await A.exportMapToHtmlFile();
  const html = await output();
  assert.match(html, /Unsaved edit/);
  assert.match(html, /data:image\/png;base64,AAAA/);
  assert.doesNotMatch(html, /\/api\/asset/);
  assert.equal(A.loading, false);
  assert.equal(A.failed, undefined);
});
test('non-Map export does not leave the loading overlay active', async () => {
  const { A } = harness();
  A.state.activePath = 'a.dita';
  await A.previewMapHtml();
  assert.notEqual(A.loading, true);
  assert.equal(A.failed, true);
});
test('an unreadable image stops the download with a visible error', async () => {
  const { A, output } = harness();
  A.browserLoadImageBytes = async () => { throw new Error('image missing'); };
  await A.exportMapToHtmlFile();
  assert.equal(await output(), undefined);
  assert.equal(A.failed, true);
  assert.equal(A.loading, false);
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const { createSearchEngine } = require('../public/knowledge-search');
const { buildPackage } = require('../public/knowledge-package');
const { createZip } = require('../public/knowledge-zip');
test('technical lookup preserves complete command/parameter/numeric tokens and ranks definitions above examples', () => {
  const engine = createSearchEngine(), records = [
    { manualId: 'a', manualTitle: 'HTTP/HTTPS 用户手册', title: 'AT+MHTTPCFG', text: 'ssl_id timeout 范围为 0～5。' },
    { manualId: 'b', manualTitle: '使用示例', title: '使用方法', text: 'AT+MHTTPCFG 命令示例 ssl_id' },
    { manualId: 'a', manualTitle: 'HTTP/HTTPS 用户手册', title: 'AT+MHTTPCFGX', text: 'ssl_id2 timeout' },
    { manualId: 'a', manualTitle: '错误说明', title: '错误码', text: '582 操作失败；5820 属于其它定义。' },
    { manualId: 'b', manualTitle: '错误说明', title: '错误码 5820', text: '其它定义。' }
  ], index = engine.build(records);
  assert.equal(engine.search(records, index, 'AT+MHTTPCFG')[0].position, 0);
  assert.deepEqual(engine.search(records, index, 'AT+MHTTPCFG').map(hit => hit.position).sort(), [0, 1]);
  assert.equal(engine.search(records, index, 'ssl_id').some(hit => hit.position === 2), false);
  assert.deepEqual(engine.search(records, index, '582').map(hit => hit.position), [3]);
  assert.deepEqual(engine.search(records, index, 'AT+MHTTPCFG', 'b').map(hit => hit.position), [1]);
  assert.equal(engine.search(records, index, 'HTTP 超时')[0].position, 0);
  assert.equal(engine.search(records, index, 'AT+UNKNOWN').length, 0);
});
test('Chinese questions, bilingual aliases, empty and hostile input remain ordinary search data', () => {
  const engine = createSearchEngine(), records = [{ manualId: 'a', title: '证书上传', text: '上传证书后检查证书状态。' }], index = engine.build(records);
  for (const query of ['如何上传证书', 'certificate', '证书']) assert.equal(engine.search(records, index, query)[0].position, 0);
  assert.deepEqual(engine.search(records, index, ''), []); assert.deepEqual(engine.search(records, index, '<script>alert(1)</script>'), []);
  const text = '保留前文。'.repeat(100) + 'AT+MHTTPCFG ssl_id 参数范围';
  assert.match(engine.excerpt(text, 'ssl_id'), /ssl_id/); assert.ok(engine.excerpt(text, 'ssl_id').length <= 192);
});
const manual = () => ({ id: 'm-0123456789abcdef', model: 'ML307G', title: 'HTTP 手册', version: 'V1', capturedAt: '2026-11-11T00:00:00.000Z',
  html: '<!doctype html><html><body>已发布 HTML</body></html>', htmlSha256: 'hash', body: '<h2 id="m-0123456789abcdef--sec-0">AT+MHTTPCFG</h2><p>ssl_id</p>',
  toc: [{ title: 'AT+MHTTPCFG', anchor: 'm-0123456789abcdef--sec-0' }], entries: [{ title: 'AT+MHTTPCFG', anchor: 'm-0123456789abcdef--sec-0', text: 'ssl_id' }],
  report: { included: 1 }, source: { repository: 'http', commit: 'abc', dirty: false, documents: [{ path: 'a.dita', sha256: 'source-hash' }] } });
test('offline ZIP preserves UTF-8 bytes, provenance and per-manual downloads with valid CRC records', async () => {
  const result = buildPackage({ title: 'ML307G 知识库', model: 'ML307G', sdkVersion: 'V1', manuals: [manual()] });
  const files = unzipSync(new Uint8Array(await result.zip.arrayBuffer()));
  assert.deepEqual(Object.keys(files), ['docs/index.html', 'docs/manifest.json', 'docs/README.txt', 'docs/manuals/m-0123456789abcdef.html']);
  assert.equal(strFromU8(files['docs/index.html']), result.html);
  assert.deepEqual(JSON.parse(strFromU8(files['docs/manifest.json'])), result.manifest);
  assert.equal(result.manifest.manuals[0].source.documents[0].sha256, 'source-hash');
  assert.equal(strFromU8(files['docs/manuals/m-0123456789abcdef.html']), manual().html);
  assert.match(result.html, /default-src 'none'/); assert.doesNotMatch(result.html, /<script[^>]+src=|<link[^>]+href=/);
  assert.match(result.filename, /^ML307G-SDK-V1-.*\.zip$/);
});
test('package boundaries reject mismatched models, duplicate manual identities, invalid fields and unsafe ZIP paths', () => {
  const options = { title: 'KB', model: 'ML307G', sdkVersion: 'V1', manuals: [manual()] };
  for (const bad of [{ model: '' }, { sdkVersion: '' }, { title: '' }, { manuals: [] }, { manuals: [manual(), manual()] }, { manuals: [{ ...manual(), model: 'ML307N' }] }]) assert.throws(() => buildPackage({ ...options, ...bad }));
  for (const name of ['../escape', '/absolute', 'docs/../escape', 'docs//a', 'C:/x']) assert.throws(() => createZip([{ name, content: 'x' }]), /路径/);
  assert.throws(() => createZip([{ name: 'a', content: 'x' }, { name: 'a', content: 'y' }]), /重复/);
});
test('embedded titles and contents cannot break out of the offline data script', () => {
  const result = buildPackage({ title: '</script><script>alert(1)</script>', model: 'ML307G', sdkVersion: '<img src=x>', manuals: [{ ...manual(), title: '</script><script>alert(2)</script>' }] });
  assert.equal((result.html.match(/<script>/g) || []).length, 1);
  assert.equal((result.html.match(/<\/script>/g) || []).length, 1);
  assert.doesNotMatch(result.html, /<script>alert|<img src=x>/);
});
test('compiled reader and provenance are detached and frozen independently of caller edits', () => {
  const input = manual(), result = buildPackage({ title: 'KB', model: 'ML307G', sdkVersion: 'V1', manuals: [input] });
  input.source.documents[0].sha256 = 'changed'; input.entries[0].text = 'changed';
  assert.equal(result.manifest.manuals[0].source.documents[0].sha256, 'source-hash');
  assert.equal(result.book.manuals[0].entries[0].text, 'ssl_id');
  assert.throws(() => { result.manifest.manuals[0].source.documents[0].sha256 = 'overwrite'; }, TypeError);
  assert.throws(() => { result.book.manuals[0].entries.push({}); }, TypeError);
});

test('SDK retrieval supports aliases, prefix suggestions, definition priority, scoped filters and compiled-index fallback', () => {
  const engine = createSearchEngine(), records = [
    { manualId: 'oc', mode: 'OC', module: '文件系统', title: '文件系统示例', text: '调用 cm_fs_mkdir、cm_fs_open', symbols: ['cm_fs_mkdir', 'cm_fs_open'] },
    { manualId: 'oc', mode: 'OC', module: '文件系统', kind: 'reference', title: 'cm_fs_mkdir', text: '创建目录 返回 0 表示成功', definedSymbols: ['cm_fs_mkdir'], aliases: ['新建文件夹'] },
    { manualId: 'oc', mode: 'OC', module: '文件系统', title: 'cm_fs_open', text: '打开文件', definedSymbols: ['cm_fs_open'] },
    { manualId: 'at', mode: 'AT', module: 'HTTP', title: 'AT+MHTTPCFG', text: 'ssl_id 582', definedSymbols: ['AT+MHTTPCFG'] }
  ], index = engine.build(records);
  for (const query of ['创建目录', '新建文件夹', '如何新建文件夹', 'cm_fs_mkdir']) assert.equal(engine.search(records, index, query)[0].position, 1, query);
  assert.deepEqual(engine.search(records, index, 'cm_fs_mkdir', '', 40, { mode: 'AT' }), []);
  assert.deepEqual(engine.suggest(records, index, 'cm_fs_'), ['cm_fs_open', 'cm_fs_mkdir']);
  assert.deepEqual(engine.suggest(records, index, 'cm_fs_', { manualId: 'at' }), []);
  assert.deepEqual(engine.suggest(records, index, 'cm_fs_', { mode: 'AT' }), []);
  assert.equal(engine.search(records, { schema: 2, compiled: { format: 'broken' } }, 'cm_fs_mkdir')[0].position, 1);
  assert.equal(engine.search(records, index, 'cm_fs_mkdir_nonexistent').length, 0);
  assert.equal(engine.search(records, index, '0', 'oc')[0].position, 1);
});

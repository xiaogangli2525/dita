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
  assert.deepEqual(Object.keys(files), ['docs/index.html', 'docs/manifest.json', 'docs/knowledge.json', 'docs/README.txt', 'docs/manuals/m-0123456789abcdef.html']);
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


test('uploaded ML307G knowledge ZIP benchmark covers all 26 real chapter entries', () => {
  const engine = createSearchEngine();
  // Chapter titles and short search-relevant excerpts are distilled from the uploaded
  // ML307G-SDK-Preview-Knowledge.zip. The customer ZIP itself is not copied into the repo.
  const manualId = 'http';
  const manualTitle = 'HTTP/HTTPS用户手册';
  const rows = [
    ['服务与支持', '关于模组产品及产品手册的评论、疑问和技术支持联系方式。', 'guide'],
    ['文档声明', '产品特性取决于当地网络设计、网络性能和预先安装的软件。', 'guide'],
    ['关于文档', '修订记录、版本描述、参数设置和内容更新。', 'guide'],
    ['引言', '基于HTTP/HTTPS通信协议定义相关AT命令及其操作流程。', 'guide'],
    ['适用型号', '适用模组和模组子型号列表，包含ML307G和MR380R-RC。', 'guide'],
    ['AT命令概述', '介绍AT命令定义及其语法格式，通过AT命令控制模组功能。', 'reference'],
    ['AT命令语法', 'AT命令必须以AT或at开头，以回车符CR结尾，后面跟随响应。', 'reference'],
    ['AT命令响应', 'ERROR表示AT命令格式错误或其他错误，OK表示命令执行成功。', 'reference'],
    ['HTTP/HTTPS协议AT命令', '详细描述HTTP/HTTPS协议相关的AT命令和命令格式。', 'reference'],
    ['AT+MHTTPCFG 参数设置', '设置客户端实例通用配置参数，包括header、cached和ssl_id。', 'reference', ['AT+MHTTPCFG']],
    ['AT+MHTTPCREATE 创建HTTP实例', '创建HTTP实例并初始化相关内容，最多可同时建立4个实例。', 'reference', ['AT+MHTTPCREATE']],
    ['AT+MHTTPHEADER 设置HTTP特定报头', '设置HTTP特定报头header及其长度和内容。', 'reference', ['AT+MHTTPHEADER']],
    ['AT+MHTTPCONTENT 设置HTTP CONTENT数据', '设置HTTP content数据，提供请求内容和数据长度。', 'reference', ['AT+MHTTPCONTENT']],
    ['AT+MHTTPREQUEST 发送HTTP请求', '发送HTTP请求，支持GET、PUT和POST请求方法。', 'reference', ['AT+MHTTPREQUEST']],
    ['AT+MHTTPREAD 读取HTTP数据', '读取缓存模式下的HTTP缓存数据和响应内容。', 'reference', ['AT+MHTTPREAD']],
    ['AT+MHTTPDEL 删除HTTP实例', '删除已创建的实例，并清空该实例所有配置。', 'reference', ['AT+MHTTPDEL']],
    ['AT+MHTTPTERM 终止HTTP传输', '终止当前HTTP传输，支持终止指定客户端实例。', 'reference', ['AT+MHTTPTERM']],
    ['AT+MHTTPDLFILE HTTP下载文件', '下载数据到文件系统，无需创建实例，支持URL和本地路径。', 'reference', ['AT+MHTTPDLFILE']],
    ['+MHTTPURC URC信息上报', 'HTTP报头接收URC、content接收URC和错误事件URC主动上报。', 'guide', ['+MHTTPURC']],
    ['示例', 'HTTP/HTTPS命令在相关业务场景中的使用流程。', 'example'],
    ['HTTP示例', 'HTTP操作流程，包含实例创建、参数配置、GET、PUT和POST请求。', 'example'],
    ['HTTPS示例', 'HTTPS GET请求流程，包含SSL证书写入和HTTPS配置。', 'example'],
    ['缓存模式', '介绍缓存模式使用步骤及注意事项，获取大数据时不建议使用缓存模式。', 'guide'],
    ['HTTP下载文件', '介绍下载数据到文件系统的步骤，重要型号限制说明。', 'guide'],
    ['错误码', 'HTTP/HTTPS命令相关错误码，包含656连接失败、651无空闲客户端等。', 'guide']
  ];
  const records = rows.map(([title, text, kind, symbols = []], index) => ({
    id: String(index), manualId, manualTitle, title, text, kind, mode: 'AT', module: 'HTTP',
    symbols, definedSymbols: symbols
  }));
  records.push({ ...records[21], id: '25', manualId: 'https-sample', manualTitle: 'HTTPS示例', title: 'HTTPS示例' });
  const index = engine.build(records);
  assert.equal(records.length, 26);
  const cases = [
    ['HTTP请求头怎么设置', 'AT+MHTTPHEADER 设置HTTP特定报头'],
    ['怎么创建HTTP客户端实例', 'AT+MHTTPCREATE 创建HTTP实例'],
    ['给POST请求添加请求内容', 'AT+MHTTPCONTENT 设置HTTP CONTENT数据'],
    ['如何发起GET请求', 'AT+MHTTPREQUEST 发送HTTP请求'],
    ['读取HTTP缓存数据', 'AT+MHTTPREAD 读取HTTP数据'],
    ['删除已经创建的客户端', 'AT+MHTTPDEL 删除HTTP实例'],
    ['停止当前HTTP传输', 'AT+MHTTPTERM 终止HTTP传输'],
    ['把服务器文件下载到模组本地', 'AT+MHTTPDLFILE HTTP下载文件'],
    ['HTTPS证书怎么写入', 'HTTPS示例'],
    ['HTTP主动上报事件', '+MHTTPURC URC信息上报'],
    ['HTTP返回656是什么错误', '错误码'],
    ['AT指令最后要加什么', 'AT命令语法'],
    ['AT返回OK和ERROR是什么意思', 'AT命令响应'],
    ['缓存模式适合下载大文件吗', '缓存模式'],
    ['GET PUT POST流程示例', 'HTTP示例'],
    ['哪些模组型号支持', '适用型号'],
    ['HTTP连接参数配置在哪里', 'AT+MHTTPCFG 参数设置'],
    ['HTTP相关命令有哪些', 'HTTP/HTTPS协议AT命令'],
    ['AT+MHTTPCONFG', 'AT+MHTTPCFG 参数设置'],
    ['AT+MHTTPREAD', 'AT+MHTTPREAD 读取HTTP数据']
  ];
  const misses = [];
  for (const [query, expectedTitle] of cases) {
    const hits = engine.search(records, index, query, '', 5);
    if (hits[0]?.position == null || records[hits[0].position]?.title !== expectedTitle) {
      misses.push({ query, expectedTitle, actual: hits.slice(0, 3).map(hit => records[hit.position]?.title) });
    }
  }
  assert.deepEqual(misses, [], 'Real-manual benchmark queries should rank the expected chapter first');
});

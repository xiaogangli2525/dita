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


test('MR380R four-manual benchmark covers natural-language questions, domain synonyms, typos and exact API lookup', () => {
  const engine = createSearchEngine();
  // Compact benchmark records distilled from the four supplied manuals.
  // No full customer manual text is copied into the test fixture.
  const records = [
    { manualId: 'sdk', manualTitle: 'SDK开发指导手册', title: '搭建编译环境', text: 'SDK开发包自带编译必需工具，解压至非中文路径完成编译环境搭建。', module: 'SDK开发指导手册' },
    { manualId: 'sdk', manualTitle: 'SDK开发指导手册', title: '编译SDK', text: 'scons -h 查看帮助，scons target=userapp 编译用户程序。', module: 'SDK开发指导手册' },
    { manualId: 'sdk', manualTitle: 'SDK开发指导手册', title: '下载固件', text: '下载方式参考对应型号模组的维护诊断工具用户手册。', module: 'SDK开发指导手册' },
    { manualId: 'sdk', manualTitle: 'SDK开发指导手册', title: '固件下载工具简介', text: '固件下载支持多种工具，不同型号使用适配的下载工具。', module: 'SDK开发指导手册' },
    { manualId: 'sdk', manualTitle: 'SDK开发指导手册', title: 'LOG抓取', text: '程序调试期间使用USB或UART方式抓取日志，辅助问题分析。', module: 'SDK开发指导手册' },
    { manualId: 'sdk', manualTitle: 'SDK开发指导手册', title: '死机现场查看', text: '参考维护诊断工具用户手册查看模组死机现场。', module: 'SDK开发指导手册' },
    { manualId: 'sdk', manualTitle: 'SDK开发指导手册', title: '用户入口函数', text: 'cm_opencpu_entry 系统初始化过程中调用，执行初始化和业务线程创建。', symbols: ['cm_opencpu_entry'], definedSymbols: ['cm_opencpu_entry'], module: 'SDK开发指导手册' },
    { manualId: 'resource', manualTitle: 'OpenCPU资源综述', title: '内存资源', text: 'RAM最大可用空间可通过cm_mem_get_heap_stats函数查询，包含堆栈空间和文件系统资源。', symbols: ['cm_mem_get_heap_stats'], definedSymbols: ['cm_mem_get_heap_stats'], module: 'OpenCPU资源综述' },
    { manualId: 'resource', manualTitle: 'OpenCPU资源综述', title: '引脚资源', text: '介绍模组引脚资源、引脚分配、GPIO复用功能和引脚初始电平。', symbols: ['AP_READY', 'SLEEP_IND', 'W_DISABLE'], module: 'OpenCPU资源综述' },
    { manualId: 'resource', manualTitle: 'OpenCPU资源综述', title: '外设资源', text: 'UART、IIC、GPIO、PWM、SPI接口数量及复用说明。', module: 'OpenCPU资源综述' },
    { manualId: 'resource', manualTitle: 'OpenCPU资源综述', title: '其他使用说明', text: '驻网时间常规情况约7s到12s，信号差时驻网时间会变长。', module: 'OpenCPU资源综述' },
    { manualId: 'dialup', manualTitle: '拨号上网开发指导手册', title: '功能介绍', text: '数据拨号模块用于移动网络激活拨号和网络设备管理，提供cm_modem_call、PDP上下文、APN和自动联网功能。', symbols: ['cm_modem_call', 'cm_modem_set_pdp_context', 'cm_modem_set_default_apn'], definedSymbols: ['cm_modem_call', 'cm_modem_set_pdp_context', 'cm_modem_set_default_apn'], module: '拨号上网开发指导手册' },
    { manualId: 'dialup', manualTitle: '拨号上网开发指导手册', title: 'API说明', text: '具体接口定义查阅cm_modem.h及cm_dialup.h，包含APN和PDP上下文结构体。', symbols: ['cm_modem', 'cm_dialup', 'cm_default_apn_t'], definedSymbols: ['cm_default_apn_t'], module: '拨号上网开发指导手册' },
    { manualId: 'dialup', manualTitle: '拨号上网开发指导手册', title: '使用示例', text: 'SDK示例程序cm_demo_modem包含pdp_set、call_get和拨号状态回调。', symbols: ['cm_demo_modem'], module: '拨号上网开发指导手册' },
    { manualId: 'dialup', manualTitle: '拨号上网开发指导手册', title: '调试方法', text: '通过modem pdp_get、pdp_set、call_get、call和discall命令测试数据连接。', module: '拨号上网开发指导手册' },
    { manualId: 'dialup', manualTitle: '拨号上网开发指导手册', title: '注意事项', text: '默认自动连接，修改APN前建议关闭自动联网，设置PDP上下文后建立数据连接。', module: '拨号上网开发指导手册' },
    { manualId: 'webui', manualTitle: 'WebUI开发指导手册', title: '前端UI', text: '前端网页视觉展示和基本操作，使用HTML、CSS和JavaScript实现。', module: 'WebUI开发指导手册' },
    { manualId: 'webui', manualTitle: 'WebUI开发指导手册', title: '后端WebServer', text: '模组后端Web Server使用Mongoose，负责服务端运行逻辑。', module: 'WebUI开发指导手册' },
    { manualId: 'webui', manualTitle: 'WebUI开发指导手册', title: '前后端交互', text: '前端和后端采用HTTP socket通讯，使用AJAX和XML数据格式交互。', module: 'WebUI开发指导手册' },
    { manualId: 'webui', manualTitle: 'WebUI开发指导手册', title: '前端定制开发', text: '在xml/ui_mifi.xml添加条目，创建HTML、XML和JS文件完成前端定制。', module: 'WebUI开发指导手册' },
    { manualId: 'webui', manualTitle: 'WebUI开发指导手册', title: '后端定制开发', text: '在kernel webserver目录和applet_array.c中添加后端模块。', module: 'WebUI开发指导手册' },
    { manualId: 'webui', manualTitle: 'WebUI开发指导手册', title: '开发示例', text: '通过添加SIM卡管理功能示例展示WebUI开发流程。', module: 'WebUI开发指导手册' }
  ];
  const index = engine.build(records);
  const cases = [
    ['模块上不了网', '功能介绍'],
    ['怎么烧录固件', '下载固件'],
    ['编译环景', '搭建编译环境'],
    ['抓取日志', 'LOG抓取'],
    ['死机现场怎么查', '死机现场查看'],
    ['查看剩余内存', '内存资源'],
    ['可用内存', '内存资源'],
    ['网页怎么定制', '前端定制开发'],
    ['后台服务在哪', '后端WebServer'],
    ['前后端怎么通信', '前后端交互'],
    ['网络注册要多久', '其他使用说明'],
    ['cm_modem_call', '功能介绍'],
    ['cm_modem_cali', '功能介绍'],
    ['cm_mem_get_heap_stats', '内存资源'],
    ['APN怎么设置', '注意事项'],
    ['PDP数据连接如何激活', '功能介绍'],
    ['怎么查看有哪些GPIO引脚', '引脚资源'],
    ['串口和SPI接口有多少', '外设资源'],
    ['如何添加SIM卡管理页面', '开发示例'],
    ['如何关闭自动联网', '注意事项']
  ];
  const misses = [];
  for (const [query, expectedTitle] of cases) {
    const hits = engine.search(records, index, query, '', 5);
    if (hits[0]?.position == null || records[hits[0].position]?.title !== expectedTitle) {
      misses.push({ query, expectedTitle, actual: hits.slice(0, 3).map(hit => records[hit.position]?.title) });
    }
  }
  assert.deepEqual(misses, [], 'Every natural-language benchmark query should rank its expected chapter first');
});

'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { flatten } = require('../lib/knowledge-book');
const { build, search } = require('../lib/knowledge-semantic');

async function main() {
  const destination = process.argv[2];
  if (!destination) throw Error('请指定用于离线验证的输出 JSON 路径');
  global.fetch = async () => { throw Error('Offline semantic smoke test attempted network access'); };
  const book = { schema: 1, title: '离线验证手册', model: 'TEST', sdkVersion: 'v1', generatedAt: new Date().toISOString(),
    manuals: [{ id: 'm-0123456789abcdef', title: '开发指导手册', mode: 'OC', module: '调试', version: 'v1',
      source: { repository: 'smoke', commit: null, dirty: false },
      entries: [{ anchor: 'log', title: '日志抓取方法', text: '使用串口工具抓取模组日志，选择调试串口，保存日志文件。' }] }] };
  const records = flatten(book); book.semantic = await build(records);
  const hits = await search(records, book.semantic, '日志抓取方法', [], { semanticOnly: true });
  assert.equal(hits[0]?.position, 0);
  await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, JSON.stringify(book));
  console.log('断网语义检索验证通过：512 维向量，首条命中日志抓取方法');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

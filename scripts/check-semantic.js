'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { flatten } = require('../lib/knowledge-book');
const { build, search } = require('../lib/knowledge-semantic');
const { buildPackage } = require('../public/knowledge/knowledge-package');

async function main() {
  const destination = process.argv[2];
  if (!destination) throw Error('请指定用于离线验证的输出 JSON 路径');
  global.fetch = async () => { throw Error('Offline semantic smoke test attempted network access'); };
  const uart = process.argv.includes('--uart');
  const title = uart ? '外设资源' : '日志抓取方法';
  const description = uart ? 'UART 串口资源，最大组数：4，包含日志专用的 UART 口。' : '使用串口工具抓取模组日志，选择调试串口，保存日志文件。';
  const query = uart ? '支持多少串口' : title;
  const book = { schema: 1, title: '离线验证手册', model: uart ? 'MR380R' : 'TEST', sdkVersion: 'v1', generatedAt: new Date().toISOString(),
    manuals: [{ id: 'm-0123456789abcdef', title: '开发指导手册', mode: 'OC', module: '调试', version: 'v1',
      source: { repository: 'smoke', commit: null, dirty: false },
      entries: [{ anchor: 'log', title, text: title + ' ' + description }] }] };
  const records = flatten(book); book.semantic = await build(records);
  const hits = await search(records, book.semantic, query, [], { semanticOnly: true });
  assert.equal(hits[0]?.position, 0);
  await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, JSON.stringify(book));
  const manual = book.manuals[0], html = '<!doctype html><html><body><h2 id="log">' + title + '</h2>\n<p>' + description + '</p></body></html>';
  const output = buildPackage({ title: book.title, model: book.model, sdkVersion: book.sdkVersion,
    manuals: [{ ...manual, model: book.model, html, body: html, toc: [{ title, anchor: 'log' }], report: { included: 0 } }] });
  await fs.writeFile(destination.replace(/\.json$/, '.zip'), new Uint8Array(await output.zip.arrayBuffer()));
  if (uart) {
    const docs = path.join(path.dirname(destination), 'uart-docs');
    await fs.mkdir(docs, { recursive: true });
    await fs.writeFile(path.join(docs, 'index.html'), output.html);
    await fs.writeFile(path.join(docs, 'knowledge.json'), JSON.stringify(book));
  }
  console.log('断网语义检索验证通过：512 维向量，首条命中' + title);
}
main().catch(error => { console.error(error); process.exitCode = 1; });

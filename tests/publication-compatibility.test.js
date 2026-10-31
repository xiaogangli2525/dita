'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const resolver = require('../public/publication-resolver');
const publication = require('../public/publication-core');
const core = require('../public/app-core');
const { buildMockDom } = require('./visual-harness');
const fixture = path.join(__dirname, 'fixtures/manual');
const map = { title: 'MQTT fixture', source: fs.readFileSync(path.join(fixture, 'main.ditamap'), 'utf8'), children: ['connect', 'publish'].map(name => ({ type: 'file', path: 'topics/' + name + '.dita' })).concat({ type: 'file', path: 'shared/notes.dita', processingRole: 'resource-only' }) };
const read = file => fs.readFileSync(path.join(fixture, file), 'utf8');
async function input() { return resolver.loadDependencies(new Map(core.collectPreviewPaths(map.children).map(entry => [entry.path, { current: read(entry.path) }])), async file => read(file)); }

test('dependency closure uses referenced resources without adding resource chapters or mutating buffers', async () => {
  const files = await input(), before = [...files].map(([p, f]) => [p, f.current]);
  assert.equal(files.size, 3);
  const data = publication.preparePublication({ map, files, model: 'M100' }, core.collectPreviewPaths);
  assert.deepEqual(data.report, { model: 'M100', included: 4, excluded: 3, unmarked: 1, unused: 0 });
  assert.match(data.files.get('topics/connect.dita').current, /A_CONREF/);
  assert.doesNotMatch(data.files.get('topics/connect.dita').current, /conref=|id="limit"/);
  assert.deepEqual([...files].map(([p, f]) => [p, f.current]), before);
  assert.deepEqual(publication.listModels(files), ['M100', 'M200', 'M300']);
});
test('three-model HTML and Markdown preserve tables, images, code and working links with one shared note number', async () => {
  buildMockDom();
  const files = await input();
  for (const model of ['M100', 'M200', 'M300']) {
    const reads = [], loadImageBytes = async file => { reads.push(file); assert.equal(file, 'assets/network.svg'); return 'data:image/svg+xml;base64,DEMO'; };
    const html = await core.exportMapToHtml({ map, files, model, loadImageBytes });
    const md = await core.exportMapToMarkdown({ map, files, model, loadImageBytes });
    for (const output of [html, md]) {
      assert.match(output, /COMMON_CONREF/); assert.match(output, /UNMARKED/); assert.match(output, /data:image\/svg\+xml/);
      assert.doesNotMatch(output, /UNUSED_RESOURCE_BODY|ANCESTOR_EXCLUDED|conref=/);
      assert.equal(output.includes('A_CONREF'), model === 'M100');
      assert.equal(output.includes('AB_SHARED'), model !== 'M300');
      assert.equal(output.includes('INHERITED_AB'), model !== 'M300');
      assert.equal(output.includes('INHERITED_B'), model === 'M200');
      assert.equal(output.includes('C_ONLY'), model === 'M300');
      assert.match(output, /AT\+MQTTPUB/);
    }
    assert.match(html, /href="#sec-1-node-publish%2Fparameters"/);
    assert.match(html, /id="sec-1-node-publish%2Fparameters"/);
    assert.match(md, /\(#sec-1-node-publish%2Fparameters\)/);
    assert.match(md, /id="sec-1-node-publish%2Fparameters"/);
    assert.match(md, /\| QoS \| 说明 \|/);
    assert.match(md, /\| payload \| 负载大小/);
    if (model !== 'M300') {
      assert.equal((html.match(/AB_SHARED/g) || []).length, 1);
      const number = [...html.matchAll(/<li id="fn-(\d+)">([^]*?)<\/li>/g)].find(match => match[2].includes('AB_SHARED'))?.[1];
      assert.ok(number); // The fixture's resource note is reused in a paragraph and a list.
      assert.equal(html.split('href="#fn-' + number + '"').length - 1, 2);
      assert.equal((md.match(/AB_SHARED/g) || []).length, 1);
      assert.equal((html.match(/重试示意/g) || []).length, 1);
    }
    assert.ok(reads.length);
  }
});
test('conref chains keep local attributes and identifiers and rebase images to the including topic', () => {
  const files = new Map([
    ['a.dita', { current: '<topic id="a"><body><p><fn id="local" product="M200" conref="reuse/b.dita#b/n"/></p><xref href="#a/local" type="fn"/></body></topic>' }],
    ['reuse/b.dita', { current: '<topic id="b"><body><fn id="n" conref="../shared/c.dita#c/n"/></body></topic>' }],
    ['shared/c.dita', { current: '<topic id="c"><body><fn id="n" product="M100" callout="*">CHAIN<image href="img.svg"/></fn></body></topic>' }]
  ]);
  const data = publication.preparePublication({ map: { children: [{ type: 'file', path: 'a.dita' }] }, files, model: 'M200' }, core.collectPreviewPaths);
  const xml = data.files.get('a.dita').current;
  assert.match(xml, /id="local"/); assert.match(xml, /product="M200"/); assert.match(xml, /callout="\*"/);
  assert.match(xml, /href="shared\/img.svg"/); assert.match(xml, /CHAIN/);
});
test('cycles, missing targets, mismatched types, unsupported constructs and escaping references stop publication', async () => {
  for (const [body, pattern] of [
    ['<p id="a" conref="#t/a"/>', /循环/],
    ['<p conref="#t/missing"/>', /目标不存在/],
    ['<fn conref="#t/p"/><p id="p">X</p>', /类型不匹配/],
    ['<p conkeyref="key/p"/>', /conkeyref/],
    ['<p keyref="key"/>', /keyref/],
    ['<p conrefend="#t/p"/>', /conrefend/],
    ['<p xml:base="other/">X</p>', /xml:base/]
  ]) assert.throws(() => publication.prepareTopic('<topic id="t"><body>' + body + '</body></topic>', 'a.dita'), pattern);
  for (const href of ['../../secret.dita#t/n', 'https://example.com/a.dita#t/n', '%2Ftmp/a.dita#t/n', '..%5Csecret.dita#t/n']) {
    let reads = 0;
    await assert.rejects(resolver.loadDependencies(new Map([['a.dita', { current: '<topic><body><fn conref="' + href + '"/></body></topic>' }]]), async () => { reads++; return ''; }));
    assert.equal(reads, 0);
  }
  assert.throws(() => resolver.validateMap('<map><topicref href="sub.ditamap"/></map>', ''), /子 Map/);
  assert.throws(() => resolver.validateMap('<map product="M100"/>', 'M100'), /Map 级/);
});
test('missing normal links and Markdown merged cells stop instead of producing a broken manual', async () => {
  buildMockDom();
  const m = { title: 'Manual', children: [{ type: 'file', path: 'a.dita' }] };
  const files = current => new Map([['a.dita', { current }]]);
  await assert.rejects(core.exportMapToHtml({ map: m, files: files('<topic id="a"><body><p><xref href="missing.dita#b">Broken</xref></p></body></topic>') }), /链接目标/);
  const table = '<topic id="a"><body><table><tgroup cols="2"><colspec colname="c1"/><colspec colname="c2"/><tbody><row><entry namest="c1" nameend="c2">Merged</entry></row></tbody></tgroup></table></body></topic>';
  assert.match(await core.exportMapToHtml({ map: m, files: files(table) }), /colspan="2"/);
  await assert.rejects(core.exportMapToMarkdown({ map: m, files: files(table) }), /合并单元格/);
});

test('duplicate IDs introduced by reuse and ambiguous fragment relocation fail explicitly', () => {
  const duplicate = '<topic id="t"><body><section id="s"><p id="p">X</p></section><section conref="#t/s"/></body></topic>';
  assert.throws(() => publication.prepareTopic(duplicate, 'a.dita'), /重复的元素 ID/);
  const files = new Map([
    ['a.dita', { current: '<topic id="a"><body><p conref="b.dita#b/p"/></body></topic>' }],
    ['b.dita', { current: '<topic id="b"><body><p id="p"><xref href="#b/p">Link</xref></p></body></topic>' }]
  ]);
  assert.throws(() => resolver.resolveConrefs(files), /ID 重定位/);
});

test('nested-list notes render once and links cannot target anchors missing from the chosen output', async () => {
  buildMockDom();
  const m = { title: 'Manual', children: [{ type: 'file', path: 'a.dita' }] };
  const files = current => new Map([['a.dita', { current }]]);
  const nested = '<topic id="a"><body><p><xref href="#a/item">Item</xref></p><ul><li>Outer<ul><li id="item">Inner<fn>NESTED_NOTE</fn></li></ul></li></ul></body></topic>';
  const md = await core.exportMapToMarkdown({ map: m, files: files(nested) });
  assert.equal(md.split('Inner').length - 1, 1);
  assert.equal((md.match(/\[\^1\](?!:)/g) || []).length, 1);
  assert.equal(md.split('NESTED_NOTE').length - 1, 1);
  const cells = '<topic id="a"><body><p><xref href="#a/cell">Cell</xref></p><table><tgroup cols="1"><tbody><row><entry id="cell">Target</entry></row></tbody></tgroup></table></body></topic>';
  assert.match(await core.exportMapToHtml({ map: m, files: files(cells) }), /id="sec-0-node-a%2Fcell"/);
  await assert.rejects(core.exportMapToMarkdown({ map: m, files: files(cells) }), /所选格式中定位/);
});

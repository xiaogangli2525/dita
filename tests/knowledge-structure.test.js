'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { parseFragment } = require('parse5');
const blocks = require('../public/knowledge-structure');
const semantic = require('../public/knowledge-semantic');
const count = text => text.length + 2;
const vector = () => [1, ...Array(511).fill(0)];
function extract(html, footnotes = '') {
  const definitions = blocks.definitions(blocks.tree(parseFragment(footnotes)));
  return blocks.extract(blocks.tree(parseFragment(html)), definitions, 'topic');
}
function record(result) {
  return { manualId: 'manual', manualTitle: 'HTTP用户手册', anchor: 'topic', title: 'AT+TEST 参数设置', text: '确定的发布正文', sourcePath: 'topics/parameters.dita',
    structure: blocks.seal('AT+TEST 参数设置', '确定的发布正文', result.units, result.warnings) };
}
test('merged table rows preserve column labels, inherited row context and only referenced footnotes', () => {
  const result = extract('<h2 id="topic">参数</h2><table><thead><tr><th>参数</th><th>说明</th></tr></thead><tbody><tr><td rowspan="2">timeout<sup class="fn-ref"><a href="#fn-1">1</a></sup></td><td>整数，单位秒</td></tr><tr><td>默认值120</td></tr><tr><td>ssl_id</td><td>证书实例</td></tr></tbody></table>',
    '<li id="fn-1"><div class="footnote-content">ML307G：范围按当前型号规定。</div></li><li id="fn-2"><div class="footnote-content">UNREFERENCED_NOTE</div></li>');
  const rows = result.units.filter(unit => unit.kind === 'table-row');
  assert.equal(rows.length, 3); assert.match(rows[0].text, /参数：timeout/); assert.match(rows[1].text, /参数：timeout\n说明：默认值120/);
  assert.deepEqual(rows[0].notes, rows[1].notes); assert.equal(rows[2].notes.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /UNREFERENCED_NOTE/);
});
test('full-width parameter cells keep each definition together and code keeps whitespace', () => {
  const result = extract('<table><tr><td colspan="2">参数描述</td></tr><tr><td colspan="2">公共说明<p><code>&lt;timeout&gt;</code>整数，单位秒。</p><p><code>&lt;ssl_id&gt;</code>证书编号。</p></td></tr></table><pre>AT+TEST=1\n  OK\n  +TEST: 1</pre>');
  assert.ok(result.units.some(unit => unit.text === '公共说明'));
  assert.ok(result.units.some(unit => unit.text === '<timeout>整数，单位秒。'));
  const code = result.units.find(unit => unit.kind === 'code'); assert.equal(code.text, 'AT+TEST=1\n  OK\n  +TEST: 1');
  assert.ok(result.units.find(unit => unit.text === '<timeout>整数，单位秒。').context.includes('参数描述'));
});
test('content identities survive unrelated insertions and nested sections do not create sparse paths', () => {
  const original = extract('<h4>参数说明</h4><p>timeout 的解释</p>'), updated = extract('<p>新增前言</p><h4>参数说明</h4><p>timeout 的解释</p>');
  assert.equal(original.units.at(-1).id, updated.units.at(-1).id);
  assert.deepEqual(original.units.at(-1).section, ['参数说明']); blocks.validate(record(original));
});
test('structured chunks carry required notes and context and reject stale text, reordered or missing units', async () => {
  const result = extract('<table><tr><th>参数</th><th>说明</th></tr><tr><td>timeout</td><td>' + '超时说明。'.repeat(180) + '<sup class="fn-ref"><a href="#fn">1</a></sup></td></tr></table>', '<li id="fn"><div class="footnote-content">仅适用于当前发布型号。</div></li>');
  const entry = record(result), chunks = await semantic.chunksFor([entry], count);
  assert.ok(chunks.length > 1); assert.ok(chunks.every(chunk => chunk.text.includes('注脚：仅适用于当前发布型号。') && chunk.sourcePath === entry.sourcePath && chunk.tokenCount <= 512));
  assert.equal(chunks.at(-1).end, result.units[0].text.length);
  const index = semantic.createIndex(chunks, chunks.map(vector)); semantic.validate([entry], index);
  assert.throws(() => semantic.validate([{ ...entry, text: '已修改正文' }], index), /结构与正文/);
  assert.throws(() => semantic.validate([entry], { ...index, chunks: chunks.slice(0, -1) }), /正文不一致/);
  assert.throws(() => semantic.validate([entry], { ...index, chunks: [...chunks].reverse() }), /正文不一致/);
  assert.throws(() => semantic.validate([entry], { ...index, chunks: chunks.map(chunk => ({ ...chunk, noteIds: [] })) }), /正文不一致/);
});
test('required oversized notes fail explicitly, missing notes and invalid spans cannot be silently indexed', async () => {
  assert.throws(() => extract('<p>x<sup class="fn-ref"><a href="#missing">1</a></sup></p>'), /缺少关联注脚/);
  assert.throws(() => extract('<table><tr><td colspan="9000">x</td></tr></table>'), /跨度/);
  const result = extract('<p>参数说明<sup class="fn-ref"><a href="#fn">1</a></sup></p>', '<li id="fn"><div class="footnote-content">' + '限制条件'.repeat(200) + '</div></li>');
  await assert.rejects(() => semantic.chunksFor([record(result)], count), /关联注脚超出/);
});
test('v2 indices remain readable and deterministic fallback is explicit for text-only input', async () => {
  const entry = { manualId: 'plain', title: '标题', anchor: 'topic', text: '无结构的旧正文。'.repeat(100) };
  const old = await semantic.legacyChunksFor([entry], count), index = semantic.createIndex(old, old.map(vector), semantic.LEGACY_PROFILE);
  assert.equal(semantic.compatible(index), true); semantic.validate([entry], index);
  const fresh = await semantic.chunksFor([entry], count); assert.ok(fresh.every(chunk => chunk.kind === 'legacy'));
});


test('header footnotes are inherited by the associated rows without leaking unrelated table notes', () => {
  const result = extract('<table><thead><tr><th>参数</th><th>说明<sup class="fn-ref"><a href="#header">1</a></sup></th></tr></thead><tbody><tr><td>timeout</td><td>超时<sup class="fn-ref"><a href="#body">2</a></sup></td></tr><tr><td>retry</td><td>重试</td></tr></tbody></table>', '<li id="header"><div class="footnote-content">整列限制</div></li><li id="body"><div class="footnote-content">仅此参数限制</div></li>');
  assert.deepEqual(result.units[0].notes.map(note => note.id).sort(), ['body', 'header']);
  assert.deepEqual(result.units[1].notes.map(note => note.id), ['header']);
});


test('section context ends with its container and code indentation survives extraction', () => {
  const result = extract('<section><h3>前置条件</h3><p>条件说明。</p></section><p>正文介绍。</p><pre>    first_line\n        second_line</pre>');
  assert.deepEqual(result.units.find(unit => unit.text === '正文介绍。').section, []);
  assert.equal(result.units.find(unit => unit.kind === 'code').text, '    first_line\n        second_line');
});


test('parameter enumeration values and examples remain coupled with their definition on long splits', async () => {
  const result = extract('<table><tr><td colspan="2">参数描述</td></tr><tr><td colspan="2"><p><code>&lt;cached&gt;</code>缓存模式，默认值0。</p><dl><dt>0</dt><dd>非缓存模式</dd><dt>1</dt><dd>缓存模式</dd></dl><pre>AT+TEST=1\nOK</pre></td></tr></table>');
  const parameter = result.units.find(unit => unit.kind === 'table-row');
  assert.match(parameter.text, /<cached>缓存模式/); assert.match(parameter.text, /0\s+非缓存模式/); assert.match(parameter.text, /AT\+TEST=1\nOK/);
  assert.ok(parameter.context.some(value => value.includes('默认值0')));
  const entry = record(result), chunks = await semantic.chunksFor([entry], count);
  assert.equal(chunks.filter(chunk => chunk.kind === 'table-row').length, 1);
});


test('split parameter rows repeat their identifier and required default instead of losing them in continuation chunks', async () => {
  const simple = extract('<table><tr><th>参数</th><th>说明</th></tr><tr><td>timeout</td><td>' + '长参数说明。'.repeat(150) + '</td></tr></table>');
  const simpleChunks = await semantic.chunksFor([record(simple)], count);
  assert.ok(simpleChunks.length > 1); assert.ok(simpleChunks.every(chunk => chunk.text.includes('行标识：timeout')));
  const wide = extract('<table><tr><td colspan="2"><p><code>&lt;cached&gt;</code>缓存模式，默认值0。</p><dl><dt>0</dt><dd>非缓存模式</dd></dl><p>' + '说明内容。'.repeat(180) + '</p></td></tr></table>');
  const wideChunks = await semantic.chunksFor([record(wide)], count);
  assert.ok(wideChunks.length > 1); assert.ok(wideChunks.every(chunk => chunk.text.includes('参数定义：<cached>缓存模式，默认值0。')));
});


test('actual DITA dlentry wrappers and enumeration in the following table row keep the owning parameter', () => {
  const result = extract('<table><tr><td colspan="2">参数描述</td></tr><tr><td colspan="2"><code>&lt;cached&gt;</code>缓存模式，默认值0。</td></tr><tr><td colspan="2"><dl><div><dt>0</dt><dd>非缓存模式</dd></div><div><dt>1</dt><dd>缓存模式</dd></div></dl></td></tr><tr><td colspan="2"><code>&lt;timeout&gt;</code>超时时间。</td></tr><tr><td colspan="2"><dl><div><dt>0</dt><dd>无限等待</dd></div></dl></td></tr></table>');
  const cached = result.units.find(unit => unit.text.includes('非缓存模式'));
  assert.ok(cached); assert.ok(cached.context.some(value => value.includes('<cached>') && value.includes('默认值0')));
  const timeout = result.units.find(unit => unit.text.includes('无限等待')); assert.ok(timeout.context.some(value => value.includes('<timeout>')));
  assert.ok(!timeout.context.some(value => value.includes('<cached>')));
  const standalone = extract('<dl><div><dt>name</dt><dd>完整解释</dd></div></dl>');
  assert.ok(standalone.units.some(unit => unit.text.includes('name') && unit.text.includes('完整解释')));
});


test('named parameter anchors remain valid and unmarked legacy fragments fall back to the chapter', () => {
  const result = extract('<table><tr><td colspan="2"><p id="original-parameter"><code>&lt;timeout&gt;</code>超时参数。</p><dl><dt>0</dt><dd>不超时</dd></dl></td></tr></table>');
  assert.equal(result.units[0].sourceAnchor, 'original-parameter');
  assert.equal(extract('<p>普通说明</p>').units[0].sourceAnchor, 'topic');
});

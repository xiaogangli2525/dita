'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareTopic } = require('../public/publication-core');
const { buildMockDom } = require('./visual-harness');
const core = require('../public/app-core');
const source = '<topic id="t"><title>T</title><body><p>Body<fn product="M100">Only A</fn><fn product="M200">Only B</fn><fn>Unmarked</fn></p><fn id="shared" product="M100 M200">Shared <b>content</b>.</fn><p>Ref<xref href="#t/shared" type="fn"/> again<xref href="#t/shared" type="fn"/></p><fn id="unused">Unused definition</fn></body></topic>';
const map = { title: 'MQTT', children: [{ type: 'file', path: 'topics/a.dita' }] };
function files(xml = source) { return new Map([['topics/a.dita', { current: xml }]]); }

test('model publishing removes only unmatched notes and retains unknown applicability and source layout', () => {
  const result = prepareTopic(source, 'topics/a.dita', 'M100');
  assert.doesNotMatch(result.content, /Only B|Unused definition/);
  assert.match(result.content, /Only A/); assert.match(result.content, /Unmarked/); assert.match(result.content, /Shared <b>content/);
  assert.deepEqual(result.report, { model: 'M100', excluded: 1, unmarked: 1, included: 3, unused: 1 });
  assert.equal(result.content, source.replace('<fn product="M200">Only B</fn>', '').replace('<fn id="unused">Unused definition</fn>', ''));
});
test('excluded definitions also remove every associated callout', () => {
  const result = prepareTopic(source, 'topics/a.dita', 'M300');
  assert.doesNotMatch(result.content, /Only A|Only B|Shared|type="fn"/);
  assert.match(result.content, /Unmarked/);
});
test('reference validity and supported subset fail explicitly', () => {
  for (const xml of [
    '<topic id="t"><body><p><xref href="#t/missing" type="fn"/></p></body></topic>',
    '<topic id="t"><body><fn id="n">One</fn><fn id="n">Two</fn></body></topic>',
    '<topic id="t"><body><p><xref href="b.dita#t/n" type="fn"/></p></body></topic>',
    '<topic><body><p><fn conref="other.dita#t/n"/></p></body></topic>',
    '<topic><body><p><fn product="group(M100 M200)">Condition</fn></p></body></topic>'
  ]) assert.throws(() => prepareTopic(xml, 'topics/a.dita', 'M100'));
});
test('HTML and Markdown share model scope, sequential numbers and repeated-reference identity', async () => {
  buildMockDom();
  const input = files();
  const html = await core.exportMapToHtml({ map, files: input, model: 'M100' });
  assert.doesNotMatch(html, /Only B|Unused definition/);
  assert.match(html, /适用型号：M100。/);
  assert.equal((html.match(/id="fn-3"/g) || []).length, 1);
  assert.match(html, /id="fnref-3-1"/); assert.match(html, /id="fnref-3-2"/);
  assert.match(html, /href="#fnref-3-1"/);
  assert.equal((html.match(/Shared <strong>content<\/strong>/g) || []).length, 1);
  const md = await core.exportMapToMarkdown({ map, files: input, model: 'M100' });
  assert.doesNotMatch(md, /Only B|Unused definition/);
  assert.equal((md.match(/\[\^3\]:/g) || []).length, 1);
  assert.match(md, /Ref\[\^3\] again\[\^3\]/);
  assert.equal(input.get('topics/a.dita').current, source);
});
test('all-model output obeys reference-only id semantics, custom callouts and scoped IDs', async () => {
  buildMockDom();
  const other = '<topic id="t"><title>Other</title><body><fn id="shared" callout="*">Second topic</fn><p><xref href="b.dita#t/shared" type="fn"/></p></body></topic>';
  const input = files(); input.set('topics/b.dita', { current: other });
  const expanded = { ...map, children: [...map.children, { type: 'file', path: 'topics/b.dita' }] };
  const html = await core.exportMapToHtml({ map: expanded, files: input });
  assert.match(html, /Only A/); assert.match(html, /Only B/); assert.match(html, />\[\*\]<\/a>/);
  assert.equal((html.match(/id="fn-5"/g) || []).length, 1);
  assert.match(html, /Second topic/);
});
test('images in excluded notes are never requested and broken references stop exports', async () => {
  buildMockDom();
  const xml = '<topic id="t"><title>T</title><body><p>Body<fn product="M200"><image href="missing.png"/></fn></p></body></topic>';
  let reads = 0;
  await core.exportMapToHtml({ map, files: files(xml), model: 'M100', loadImageBytes: async () => { reads++; throw new Error('missing'); } });
  assert.equal(reads, 0);
  await assert.rejects(core.exportMapToMarkdown({ map, files: files('<topic id="t"><body><p><xref href="#t/missing" type="fn"/></p></body></topic>') }), /找不到注脚/);
});

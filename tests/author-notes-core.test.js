'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { completeInsertion, listFootnotes } = require('../public/footnotes-core');
test('Author note insertion escapes plain content and removes only its temporary ID', () => {
  const source = '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep--><topic id="t"><body><p id="p">A &amp; B<fn id="insert-test"/> C<fn id="kept">Shared</fn></p><codeblock>  AT\n    OK</codeblock></body></topic><?tail preserve?>';
  const result = completeInsertion(source, 'insert-test', { content: '参数 < 10 & 保留', products: 'M100 M200 M100' });
  assert.equal(result.content, source.replace('<fn id="insert-test"/>', '<fn product="M100 M200">参数 &lt; 10 &amp; 保留</fn>'));
  assert.equal(result.note.text, '参数 < 10 & 保留'); assert.equal(result.note.products.join(' '), 'M100 M200');
  assert.equal(listFootnotes(result.content).length, 2); assert.match(result.content, /id="kept"/);
});
test('Author note creation uses the existing common and inherited applicability checks', () => {
  const source = '<topic><body><p>A<fn id="insert-test"/></p></body></topic>';
  assert.match(completeInsertion(source, 'insert-test', { content: '通用', common: true }).content, /<fn otherprops="applicability\(common\)">通用<\/fn>/);
  const unresolved = completeInsertion(source, 'insert-test', { content: '待确认' });
  const delivered = require('../public/publication-core').prepareTopic(unresolved.content, 'topic.dita', 'M300');
  assert.equal(delivered.report.included, 1); assert.equal(delivered.report.unmarked, 1);
  const inherited = source.replace('<body>', '<body product="M100">');
  assert.throws(() => completeInsertion(inherited, 'insert-test', { content: '通用', common: true }), /祖先条件/);
  assert.throws(() => completeInsertion(source, 'insert-test', { content: ' ', common: true }), /填写注脚/);
  assert.throws(() => completeInsertion(source, 'missing', { content: '说明' }), /插入位置/);
  assert.throws(() => completeInsertion(source.replace('</p>', '<fn id="insert-test"/></p>'), 'insert-test', { content: '说明' }), /插入位置/);
});

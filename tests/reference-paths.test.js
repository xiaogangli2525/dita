'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const paths = require('../public/reference-paths');
test('relocation patches only URI values and preserves encoding, trivia, mixed content and code', () => {
  const source = '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep--><topic id="t"><title>中文</title><body><p><image href = \'图%20A.svg?x=1&amp;y=2#mark\'/><xref href="#t/id">self</xref><xref href="old.dita#t/id">explicit self</xref><p conref="../shared.dita#s/p" conrefend="../shared.dita#s/end"/><xref href="https://example.invalid/a?q=1&amp;x=2">external</xref></p><codeblock>  href="unchanged"\r\n    KEEP</codeblock></body></topic>\r\n<?tail keep?>';
  const actual = paths.rebase(source, 'manuals/old.dita', 'copies/new.dita');
  const expected = source.replace("图%20A.svg?x=1&amp;y=2#mark", "../manuals/%E5%9B%BE%20A.svg?x=1&amp;y=2#mark").replace('href="old.dita#t/id"', 'href="new.dita#t/id"');
  assert.equal(actual, expected); assert.equal(paths.resolve('copies/new.dita', '../manuals/%E5%9B%BE%20A.svg').path, 'manuals/图 A.svg');
});
test('Map and reused-content references retain their original workspace targets after relocation', () => {
  const source = '<map><topicref href="topics/a.dita#t" copy-to="out/a.dita"/><topicref href="../common.dita"/><data href="mailto:docs@example.invalid"/></map>';
  assert.equal(paths.rebase(source, 'manuals/main.ditamap', 'main.ditamap'), '<map><topicref href="manuals/topics/a.dita#t" copy-to="manuals/out/a.dita"/><topicref href="common.dita"/><data href="mailto:docs@example.invalid"/></map>');
  assert.equal(paths.rebase('<topic conref="old.dita#t"/>', 'docs/old.dita', 'docs/new.dita'), '<topic conref="new.dita#t"/>');
});
test('relative-path resolution rejects escapes, absolute destinations and malformed URI data', () => {
  assert.deepEqual(paths.resolve('manuals/main.ditamap', 'topics/a%20b.dita#t/id'), { path: 'manuals/topics/a b.dita', suffix: '#t/id', self: false, directory: false });
  for (const value of ['../outside.dita', '/tmp/a.dita', 'C:\\a.dita', 'a\0.dita']) assert.throws(() => paths.normalize(value));
  assert.throws(() => paths.resolve('main.ditamap', '%2e%2e/outside.dita'), /超出/); assert.throws(() => paths.resolve('main.ditamap', 'bad%uri'), /URI/); assert.equal(paths.resolve('main.ditamap', 'https://example.invalid/a.dita'), null);
});
test('nontrivial xml:base stops unsupported relocation before producing a damaged copy', () => {
  const source = '<topic xml:base="shared/"><title>T</title><body><xref href="a.dita#t"/></body></topic>';
  assert.throws(() => paths.rebase(source, 'docs/a.dita', 'a.dita'), /xml:base/); assert.equal(paths.rebase(source, 'docs/a.dita', 'docs/b.dita'), source);
});

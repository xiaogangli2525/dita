'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateXml, formatXml } = require('../public/xml-source');
const { parseXml } = require('../lib/xml-tree');

for (const source of [
  '<topic id=bad/>', '<topic id="a" id="b"/>', '<topic>A & B</topic>',
  '<topic/><topic/>', '<topic a="x<y"/>', '<topic>]]></topic>',
  '<topic><!--bad--comment--></topic>', '<topic>&#0;</topic>',
  '<topic>&#xD800;</topic>', '<topic>\u0000</topic>', '<p:x/>',
  '<x xmlns:a="u" xmlns:b="u" a:id="1" b:id="2"/>',
  '<topic></topic><!DOCTYPE topic>', ' <?xml version="1.0"?><topic/>'
]) test('browser/server validation reject: ' + JSON.stringify(source), () => {
  assert.throws(() => validateXml(source));
  assert.throws(() => parseXml(source));
});

test('formatting preserves code, mixed content, declarations, PIs and comments', () => {
  const prefix = '<?xml version="1.0" encoding="GBK"?>\r\n<!DOCTYPE topic SYSTEM "a>b.dtd">\r\n<!--before-->\r\n<?custom value?>\r\n';
  const code = '<codeblock>if ok:\r\n    if ready:\r\n        run()</codeblock>';
  const mixed = '<p><b>A</b> <i>B</i>  C</p>';
  const suffix = '\r\n<!--after-->';
  const original = prefix + '<topic id="a"><title>T</title><body>' + code + mixed + '</body></topic>' + suffix;
  const result = formatXml(original);
  assert.ok(result.startsWith(prefix)); assert.ok(result.endsWith(suffix));
  assert.ok(result.includes(code)); assert.ok(result.includes(mixed));
  assert.ok(!/(?<!\r)\n/.test(result));
  assert.equal(formatXml(result), result);
});

test('formatting leaves xml:space and unknown specialized content untouched', () => {
  const source = '<topic><body><section xml:space="preserve"><p>A</p>   <p>B</p></section><custom><p>A</p> <p>B</p></custom></body></topic>';
  const result = formatXml(source);
  assert.ok(result.includes('<section xml:space="preserve"><p>A</p>   <p>B</p></section>'));
  assert.ok(result.includes('<custom><p>A</p> <p>B</p></custom>'));
  assert.equal(formatXml('<topic/>'), '<topic/>');
});

test('server XML tree accepts Unicode names and retains outer document content', () => {
  const { serializeXmlDocument } = require('../lib/xml-tree');
  const source = '<?xml version="1.0" encoding="GBK"?>\n<!--before-->\n<文档 标题="中文"><段落>内容</段落></文档>\n<?after keep?>';
  const parsed = parseXml(source);
  assert.equal(parsed.root.name, '文档');
  assert.equal(parsed.root.attrs.标题, '中文');
  assert.equal(serializeXmlDocument(parsed), source);
});

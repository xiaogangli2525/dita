'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const xml = require('../public/xml-dom'), author = require('../public/author-renderer'), source = require('../public/author-source');
const oxygen = require('../public/oxygen-core'), preview = require('../public/markdown-preview');
const { renderHtmlDocument } = require('../public/delivery-document'), { buildMockDom } = require('./dom-mock');

test('canonical XML ranges retain source offsets while DOM receives a validated document without a DTD', () => {
  const input = '<?xml version="1.0"?>\r\n<!DOCTYPE topic [<!ELEMENT topic ANY>]>\r\n<!--keep--><topic id="t"><title>🔧 HTTP</title><body><p a="a > b"><![CDATA[A < B]]></p><?revision keep?></body></topic><?tail keep?>';
  let domInput, calls = 0;
  class Parser {
    parseFromString(text, kind) { domInput = text; calls++; assert.equal(kind, 'application/xml'); return { querySelector: () => null }; }
  }
  const parsed = xml.parseSource(input, Parser), title = parsed.tree.children.find(node => node.name === 'title');
  const paragraph = parsed.tree.children.find(node => node.name === 'body').children.find(node => node.name === 'p');
  assert.equal(input.slice(title.end, title.close.start), '🔧 HTTP');
  assert.equal(input.slice(paragraph.start, paragraph.close.end), '<p a="a > b"><![CDATA[A < B]]></p>');
  assert.match(domInput, /<!--keep-->|<\?tail keep\?>/); assert.doesNotMatch(domInput, /<!DOCTYPE/);
  assert.throws(() => xml.parseSource('<topic><p></topic>', Parser), /Mismatched|Unexpected/);
  assert.equal(calls, 1, 'invalid XML must not reach the DOM parser');
});

test('Author modules edit detached surfaces without application state and retain original source around two sequential edits', () => {
  const { document } = buildMockDom();
  const input = '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep--><topic id=\'t\'><title>HTTP</title><body><p id="p">文字 &amp; <b>保留</b><fn product="A1">差异</fn></p></body></topic>\r\n<?tail keep?>';
  const surface = author.createAuthorTopic(input, document, false, 'http/topic.dita');
  assert.equal(source.updateSource(input, surface), input);
  surface.querySelector('h2').appendChild(document.createTextNode(' 更新'));
  const once = source.updateSource(input, surface);
  assert.equal(once, input.replace('<title>HTTP</title>', '<title>HTTP 更新</title>'));
  surface.querySelector('h2').appendChild(document.createTextNode(' & 完成'));
  assert.equal(source.updateSource(once, surface), input.replace('<title>HTTP</title>', '<title>HTTP 更新 &amp; 完成</title>'));
});

test('lower rendering modules can load without the app facade, editor services, DOM globals or delivery factory', () => {
  const output = execFileSync(process.execPath, ['-e', `
    require('./public/author-source');
    const preview = require('./public/markdown-preview');
    const {renderHtmlDocument} = require('./public/delivery-document');
    const oxy = require('./public/oxygen-core');
    if(Object.keys(require.cache).some(p=>/(?:app-core|delivery-core|editor-controller|manual-service)\\.js$/.test(p)))throw Error('Upper layer loaded');
    console.log(JSON.stringify({markdown:preview.renderMarkdownToHtml('**OK**'),
      html:renderHtmlDocument({title:'T',sections:[]}).includes('<h1>T</h1>'),
      changes:oxy.collectOxyTrackedChanges('<?oxy_delete content="OLD"?>').length}));
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), { markdown: '<p><strong>OK</strong></p>\n', html: true, changes: 1 });
});

test('Oxygen handling has document-local indices and source change offsets', () => {
  buildMockDom();
  const input = '<topic><title>T</title><body><?oxy_insert_start author="A"?>New<?oxy_insert_end?><?oxy_delete author="B" content="Old &amp; text"?></body></topic>';
  const a = xml.parseXml(input), b = xml.parseXml(input);
  oxygen.normalizeOxyPIs(a, true); oxygen.normalizeOxyPIs(b, true);
  assert.equal(a.querySelector('ins').getAttribute('data-oxy-index'), '0');
  assert.equal(b.querySelector('ins').getAttribute('data-oxy-index'), '0');
  assert.equal(a.querySelector('del').textContent, 'Old & text');
  const changes = oxygen.collectOxyTrackedChanges(input);
  assert.deepEqual(changes.map(change => change.type), ['insert', 'delete']);
  assert.ok(input.slice(changes[0].index, changes[0].index + changes[0].matchLength).startsWith('<?oxy_insert_start'));
});

test('HTML document layout escapes metadata and keeps caller-rendered sections/notes independent', () => {
  const sections = Object.freeze([Object.freeze({ title: '<命令>', body: '<p>正文</p>' })]), footnotes = Object.freeze(['<p>差异</p>']);
  const html = renderHtmlDocument({ title: 'A & <B>', model: 'X<1', version: 'V"1', sections, footnotes });
  assert.match(html, /<title>A &amp; &lt;B&gt;<\/title>/); assert.match(html, /X&lt;1/); assert.match(html, /V&quot;1/);
  assert.match(html, /&lt;命令&gt;/); assert.match(html, /id="fn-1"/); assert.match(html, /href="#fnref-1-1"/);
  assert.doesNotMatch(renderHtmlDocument({ title: 'Other', sections: [] }), /差异|fn-1/);
});

test('standalone Markdown preview retains literal code and refuses executable URLs', () => {
  const html = preview.renderMarkdownToHtml('[bad](javascript:alert) `[code](javascript:alert)`\n\n```x"onclick="bad\n<script>literal</script>\n```');
  assert.doesNotMatch(html, /href="javascript:|"onclick="|<script>/);
  assert.match(html, /<code>\[code\]\(javascript:alert\)<\/code>/); assert.match(html, /&lt;script&gt;literal/);
  assert.match(preview.highlightMarkdown('# Title\n<script>literal</script>'), /md-heading/);
});

test('CDATA text renders as inert text in ordinary Author paragraphs and standalone Markdown conversion', () => {
  const { document } = buildMockDom(), node = { nodeType: 4, data: 'A < B & C', childNodes: [] };
  assert.equal(author.renderDitaNode(node, document)?.textContent, 'A < B & C');
  const { createDeliveryCore } = require('../public/delivery-core');
  const delivery = createDeliveryCore({});
  assert.equal(delivery.ditaToMarkdown(node), 'A < B & C');
});

test('ordinary annotated text edits preserve PI positions/entities and refuse edits crossing annotation boundaries', () => {
  const { document } = buildMockDom();
  const input = '<topic><title><?oxy_comment_start author="A"?>T &amp; X<?oxy_comment_end?></title><body><p>Keep</p></body></topic>';
  const surface = author.createAuthorTopic(input, document);
  surface.querySelector('h2').appendChild(document.createTextNode(' 更新'));
  const next = source.updateSource(input, surface);
  assert.equal(next, input.replace('</title>', ' 更新</title>'));
  const replacement = author.createAuthorTopic(input, document);
  replacement.querySelector('h2').textContent = '替换标题';
  assert.equal(source.updateSource(input, replacement), input.replace('T &amp; X<?oxy_comment_end?>', '替换标题<?oxy_comment_end?>'));
  const marked = '<topic><title>T</title><body><p>One<?oxy_comment_start author="A"?>Two<?oxy_comment_end?>Three</p></body></topic>';
  const other = author.createAuthorTopic(marked, document);
  other.querySelector('p').textContent = 'Replacement';
  assert.throws(() => source.updateSource(marked, other), /跨过批注或修订/);
});

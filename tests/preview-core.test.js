'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildMockDom } = require('./visual-harness');

test('exportMapToMarkdown converts DITA elements to Markdown', async () => {
  const core = require('../public/app-core.js');
  const entries = [{ type: 'file', path: 'topics/test.dita', title: 'Test' }];
  const dita = '<?xml version="1.0"?><topic id="t"><title>Test Topic</title><body>' +
    '<p>Hello <b>bold</b> and <i>italic</i> world</p>' +
    '<ul><li>Item one</li><li>Item two</li></ul>' +
    '<codeblock outputclass="language-c">int main(){return 0;}</codeblock>' +
    '<p>Use <codeph>printf</codeph> function</p>' +
    '<note type="tip">This is a tip</note>' +
    '<image href="img/diagram.png" alt="Diagram"/>' +
    '<dl><dlentry><dt>Key</dt><dd>Value</dd></dlentry></dl>' +
    '<table><tgroup cols="2"><thead><row><entry>A</entry><entry>B</entry></row></thead><tbody><row><entry>1</entry><entry>2</entry></row></tbody></tgroup></table>' +
    '</body></topic>';
  const files = new Map([['topics/test.dita', { path: 'topics/test.dita', current: dita }]]);
  const md = await core.exportMapToMarkdown({ map: { title: 'Manual', children: entries }, files, title: 'Manual' });
  assert.ok(md.includes('# Manual'), 'title heading');
  assert.ok(md.includes('## Test Topic'), 'topic heading');
  assert.ok(md.includes('**bold**'), 'bold text');
  assert.ok(md.includes('*italic*'), 'italic text');
  assert.ok(md.includes('- Item one'), 'unordered list');
  assert.ok(md.includes('```c'), 'code block with lang');
  assert.ok(md.includes('`printf`'), 'inline code');
  assert.ok(md.includes('> **Tip:**'), 'note blockquote');
  assert.ok(md.includes('![Diagram]('), 'image');
  assert.ok(md.includes('**Key**'), 'definition list term');
  assert.ok(md.includes('| A | B |'), 'table header');
  assert.ok(md.includes('| 1 | 2 |'), 'table body');
  assert.ok(md.includes('| --- | --- |'), 'table separator');
});


test('exportMapToMarkdown embeds images via loadImageBytes', async () => {
  const core = require('../public/app-core.js');
  const entries = [{ type: 'file', path: 'topics/img.dita', title: 'Img' }];
  const dita = '<?xml version="1.0"?><topic id="t"><title>Img Topic</title><body>' +
    '<image href="pic/photo.png" alt="Photo"/></body></topic>';
  const files = new Map([['topics/img.dita', { path: 'topics/img.dita', current: dita }]]);
  const stubLoader = (p) => Promise.resolve('data:image/png;base64,STUB');
  const md = await core.exportMapToMarkdown({ map: { title: 'M', children: entries }, files, title: 'M', loadImageBytes: stubLoader });
  assert.ok(md.includes('![Photo](data:image/png;base64,STUB)'), 'image should be embedded as data URI');
});

test('exportMapToMarkdown uses relative paths without loadImageBytes', async () => {
  const core = require('../public/app-core.js');
  const entries = [{ type: 'file', path: 'topics/img.dita', title: 'Img' }];
  const dita = '<?xml version="1.0"?><topic id="t"><title>Img Topic</title><body>' +
    '<image href="pic/photo.png" alt="Photo"/></body></topic>';
  const files = new Map([['topics/img.dita', { path: 'topics/img.dita', current: dita }]]);
  const md = await core.exportMapToMarkdown({ map: { title: 'M', children: entries }, files, title: 'M' });
  assert.ok(md.includes('![Photo](topics/pic/photo.png)'), 'image should use relative path');
  assert.ok(!md.includes('data:image'), 'no data URI when loadImageBytes absent');
});

test('exportMapToHtml embeds images via loadImageBytes', async () => {
  const core = require('../public/app-core.js');
  const entries = [{ type: 'file', path: 'topics/img.dita', title: 'Img' }];
  const dita = '<?xml version="1.0"?><topic id="t"><title>Img Topic</title><body>' +
    '<image href="pic/photo.png" alt="Photo"/></body></topic>';
  const files = new Map([['topics/img.dita', { path: 'topics/img.dita', current: dita }]]);
  const stubLoader = (p) => Promise.resolve('data:image/png;base64,STUB');
  const html = await core.exportMapToHtml({ map: { title: 'M', children: entries }, files, title: 'M', loadImageBytes: stubLoader });
  assert.ok(html.includes('data:image/png;base64,STUB'), 'html should embed image as data URI');
});


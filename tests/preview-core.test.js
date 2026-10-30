'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildMockDom } = require('./visual-harness');

test('map preview renders all referenced topics', async () => {
  const core = require('../public/app-core.js');
  const { document } = buildMockDom();

  const entries = [
    { type: 'file', path: 'topics/first.dita', title: 'First' },
    { type: 'file', path: 'topics/second.dita', title: 'Second' }
  ];
  const files = new Map(entries.map(entry => [entry.path, {
    path: entry.path,
    current: `<topic><title>${entry.title}</title><body><p>${entry.title} body</p></body></topic>`
  }]));
  const fragment = core.createMapPreview({
    map: { title: 'Manual', children: entries },
    files,
    document
  });

  assert.equal(fragment.querySelectorAll('h1').length, 3);
  assert.ok(fragment.textContent.includes('Manual'));
  assert.ok(fragment.textContent.includes('First body'));
  assert.ok(fragment.textContent.includes('Second body'));
});

test('map preview reports topics that cannot be loaded', async () => {
  const core = require('../public/app-core.js');
  const { document } = buildMockDom();
  const entries = [
    { type: 'file', path: 'topics/first.dita', title: 'First' },
    { type: 'file', path: 'topics/missing.dita', title: 'Missing' }
  ];
  const files = new Map([
    ['topics/first.dita', { path: 'topics/first.dita', current: '<topic><title>First</title><body><p>First body</p></body></topic>' }]
  ]);
  const fragment = core.createMapPreview({ map: { title: 'Manual', children: entries }, files, document });

  assert.ok(fragment.textContent.includes('First body'));
  assert.ok(fragment.textContent.includes('topics/missing.dita'));
});

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

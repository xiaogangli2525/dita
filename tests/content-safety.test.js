'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../public/app-core'), assets = require('../public/asset-core');
const { createTestApp } = require('./visual-harness');

test('source attributes stay inert in Author while edits preserve the original XML', () => {
  const source = '<topic><title onclick="alert(1)">Title</title><body><p id="p" onclick="alert(1)" style="position:fixed" data-dita-source="image">Editable<xref href="javascript:alert(1)">Link</xref></p><image href="missing.png" src="https://example.invalid/remote" onerror="alert(1)"/></body></topic>';
  const app = createTestApp(source); app.updateVisualFromXml(source);
  const p = app.dom.visualEditor.querySelector('p'), image = app.dom.visualEditor.querySelector('img'), link = app.dom.visualEditor.querySelector('a');
  assert.equal(p.getAttribute('data-dita-source'), 'p'); assert.equal(p.getAttribute('onclick'), null); assert.equal(p.getAttribute('style'), null);
  assert.equal(image.getAttribute('onerror'), null); assert.doesNotMatch(image.src, /example\.invalid/); assert.equal(link.getAttribute('href'), null);
  assert.equal(app.visualToXml(), source);
  p.childNodes[0].data = 'Edited';
  assert.equal(app.visualToXml(), source.replace('Editable', 'Edited'));
});

test('link targets reject executable schemes including ASCII whitespace obfuscation', () => {
  for (const href of ['javascript:alert(1)', 'java\nscript:alert(1)', '\tVBScript:msgbox(1)', 'data:text/html,hi', 'file:///secret']) assert.equal(assets.safeLinkHref(href), '');
  for (const href of ['https://example.invalid/a?x=1&y=2', 'mailto:docs@example.invalid', '#topic/id', '../topic.dita']) assert.equal(assets.safeLinkHref(href), href);
});

test('Markdown HTML escapes attribute delimiters and never formats generated attributes', () => {
  const html = core.renderMarkdownToHtml('[bad](javascript:alert) ![picture](https://example.invalid/"onerror="alert)\n```x"onclick="alert\ntext\n```');
  assert.doesNotMatch(html, /href="javascript:|"onerror="|"onclick="/);
  assert.match(html, /&quot;onerror=&quot;/); assert.match(html, /&quot;onclick=&quot;/);
  assert.match(core.renderMarkdownToHtml('`[code](javascript:alert)` **bold**'), /<code>\[code\]\(javascript:alert\)<\/code> <strong>bold<\/strong>/);
});

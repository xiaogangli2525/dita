'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { listFootnotes, updateFootnote, filterNotes } = require('../public/footnotes-core');
const source = '<?xml version="1.0" encoding="GBK"?>\r\n<!--keep-->\r\n<topic id="t"><title>T</title><body><p><codeph>AT+MQTTOPEN</codeph>: limit<fn id="a" product="M100 M200">M100 &amp; M200: 2 connections.</fn>.</p><p>Retry<fn id="b">Unassigned note.</fn>.</p><p>See<fn id="c" product="M300">Keep <xref href="other.dita">this link</xref>.</fn>.</p></body></topic>';

test('indexes actual fn elements, associated models and command context', () => {
  const notes = listFootnotes(source, 'topic.dita');
  assert.equal(notes.length, 3);
  assert.deepEqual(notes[0].products, ['M100', 'M200']);
  assert.match(notes[0].context, /AT\+MQTTOPEN/);
  assert.equal(notes[0].text, 'M100 & M200: 2 connections.');
  assert.equal(notes[1].products.length, 0);
  assert.equal(notes[2].rich, true);
});
test('model filtering retains unassigned notes and never infers applicability from prose', () => {
  const notes = listFootnotes(source);
  assert.deepEqual(filterNotes(notes, 'M100').map(n => n.index), [0, 1]);
  assert.deepEqual(filterNotes(notes, 'M300').map(n => n.index), [1, 2]);
  assert.deepEqual(filterNotes(notes, '', 'MQTTOPEN').map(n => n.index), [0]);
});
test('edits only one fn and preserves declarations, CRLF, ids, links and surrounding source', () => {
  const [note] = listFootnotes(source);
  const next = updateFootnote(source, note, { content: 'New & correct <limit>', products: 'M200 M200 M400' });
  assert.equal(next, source.replace(note.before, '<fn id="a" product="M200 M400">New &amp; correct &lt;limit&gt;</fn>'));
  const rich = listFootnotes(source)[2];
  const linked = updateFootnote(source, rich, { content: rich.inner, products: 'M300 M400' });
  assert.ok(linked.includes('<xref href="other.dita">this link</xref>'));
  assert.equal(updateFootnote(source, note, { content: note.text, products: 'M100 M200' }), source);
});
test('stale edits, broken rich XML and referenced footnotes are rejected', () => {
  const notes = listFootnotes(source);
  assert.throws(() => updateFootnote(source + '\n', notes[0], { content: 'wrong' }), /文档已变化/);
  assert.throws(() => updateFootnote(source, notes[2], { content: '<xref>broken', products: 'M300' }));
  const ref = '<topic><body><p><fn conref="common.dita#t/n"/></p></body></topic>';
  assert.throws(() => updateFootnote(ref, listFootnotes(ref)[0], { content: 'overwrite' }), /引用源/);
});
test('CDATA, comments, duplicate text and unrelated metadata retain exact content when assigning a model', () => {
  const xml = '<topic><body><p>Same<fn id="one"><![CDATA[a < b]]><!--keep--></fn>Same<fn id="two">Same</fn></p></body></topic>';
  const note = listFootnotes(xml)[0];
  const next = updateFootnote(xml, note, { content: note.inner, products: 'M100' });
  assert.equal(next, xml.replace('<fn id="one">', '<fn id="one" product="M100">'));
});

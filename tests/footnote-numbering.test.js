'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createManualService } = require('../public/manual-service');
const core = require('../public/app-core');
const { buildMockDom } = require('./visual-harness');
function fixture(sources, paths = Object.keys(sources)) {
  const files = new Map(Object.entries(sources).map(([path, current]) => [path, { current }]));
  const map = { title: 'Numbering', children: paths.map(path => ({ type: 'file', path })) };
  const snapshot = { map, files, project: { models: [] } }, service = createManualService({ ditaCore: core });
  return { snapshot, service, data: service.listNotes(snapshot) };
}
test('a manual has one first-use sequence and repeated xrefs retain one definition number', async () => {
  const { snapshot, data } = fixture({
    'a.dita': '<topic id="a"><body><fn id="later">DEFINED_FIRST</fn><p><fn>A</fn><xref type="fn" href="#a/later"/><xref type="fn" href="#a/later"/></p></body></topic>',
    'b.dita': '<topic id="b"><body><p><fn>B</fn><xref type="fn" href="a.dita#a/later"/></p></body></topic>'
  });
  assert.deepEqual(data.notes.map(n => [n.number, n.text]), [[1, 'A'], [2, 'DEFINED_FIRST'], [3, 'B']]);
  assert.equal(data.calls.filter(c => !c.definition && !c.origin && c.number === 2).length, 3);
  assert.deepEqual(data.notes.map(note => note.usages.length), [1, 3, 1]);
  assert.deepEqual(data.notes[1].usages.map(use => use.path), ['a.dita', 'a.dita', 'b.dita']);
  buildMockDom(); const html = await core.exportMapToHtml(snapshot), md = await core.exportMapToMarkdown(snapshot);
  assert.deepEqual([...html.matchAll(/id="fnref-(\d+)-\d+"/g)].map(m => Number(m[1])), [1, 2, 2, 3, 2]);
  assert.deepEqual([...md.matchAll(/^\[\^(\d+)\]:/gm)].map(m => Number(m[1])), [1, 2, 3]);
});
test('editing identities remain source-scoped when filenames, IDs or note text repeat', () => {
  const { data } = fixture(Object.fromEntries(['a', 'b'].map(id => [id + '.dita', '<topic id="same"><body><fn id="same">SAME</fn><p><xref type="fn" href="#same/same"/></p></body></topic>'])));
  assert.deepEqual(data.notes.map(n => [n.number, n.sourceNote.path]), [[1, 'a.dita'], [2, 'b.dita']]);
  for (const call of data.calls) assert.equal(call.note.sourceNote.path, call.number === 1 ? 'a.dita' : 'b.dita');
});
test('conref occurrences map to their visible source while block reuse does not invent child markers', () => {
  const { data } = fixture({
    'a.dita': '<topic id="a"><body><p conref="shared.dita#s/p"/><p><fn conref="shared.dita#s/n"/><fn>LOCAL</fn></p></body></topic>',
    'shared.dita': '<topic id="s"><body><p id="p"><fn>BLOCK</fn></p><fn id="n">REUSED</fn></body></topic>'
  }, ['a.dita']);
  assert.deepEqual(data.notes.map(n => n.text), ['BLOCK', 'REUSED', 'LOCAL']);
  const visible = data.calls.filter(c => c.path === 'a.dita' && !c.origin);
  assert.deepEqual(visible.map(c => [c.number, c.xmlPath]), [[2, '0/1/0'], [3, '0/1/1']]);
  assert.equal(visible[0].note.sourceNote.path, 'shared.dita');
  assert.deepEqual(data.notes.map(note => note.usages.length), [1, 1, 1], 'block reuse also has a visible usage');
});
test('unused named definitions do not consume numbers and custom callouts keep their explicit label', () => {
  const { data } = fixture({ 'a.dita': '<topic id="a"><body><fn id="unused">UNUSED</fn><fn id="star" callout="*">STAR</fn><p><fn>A</fn><xref type="fn" href="#a/star"/></p></body></topic>' });
  assert.deepEqual(data.notes.map(n => [n.number, n.label]), [[1, '1'], [2, '*']]);
  assert.ok(data.calls.every(c => c.note.text !== 'UNUSED'));
});
test('model delivery renumbers retained notes while unfiltered authoring preserves the manual sequence', async () => {
  const { snapshot, service, data } = fixture({
    'a.dita': '<topic id="a"><body><p><fn product="M200">OTHER</fn><fn product="M100">A</fn></p></body></topic>',
    'b.dita': '<topic id="b"><body><p><fn>B</fn></p></body></topic>'
  });
  assert.deepEqual(data.notes.map(n => n.number), [1, 2, 3]);
  assert.deepEqual(service.listNotes(snapshot, 'M100').notes.map(n => [n.number, n.text]), [[1, 'A'], [2, 'B']]);
  buildMockDom(); const html = await core.exportMapToHtml({ ...snapshot, model: 'M100' });
  assert.deepEqual([...html.matchAll(/id="fnref-(\d+)-\d+"/g)].map(m => Number(m[1])), [1, 2]);
});

test('reuse impact aggregates one source under distinct inherited model conditions', () => {
  const { data } = fixture({
    'a.dita': '<topic id="a"><body><p product="M100"><fn conref="shared.dita#s/n"/></p><p product="M200"><fn conref="shared.dita#s/n"/></p></body></topic>',
    'shared.dita': '<topic id="s"><body><fn id="n">SHARED</fn></body></topic>'
  }, ['a.dita']);
  assert.equal(data.notes.length, 2);
  for (const note of data.notes) {
    assert.equal(note.usages.length, 2);
    assert.deepEqual(note.usages.map(use => use.conditions), [['M100'], ['M200']]);
  }
});

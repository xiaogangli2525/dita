'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const store = require('../public/document-store');
const file = () => ({ path: 'a.dita', current: '', disk: '' });
function edit(f, text, time, beforeCursor, afterCursor, key = 'insert') {
  store.editDocument(f, text, { group: { key, time, beforeCursor, afterCursor }, historyMeta: { selectionBefore: beforeCursor, selectionAfter: afterCursor } });
}
test('contiguous typing shares one history entry and retains both endpoint selections', () => {
  const f = file(); edit(f, 'a', 0, '0', '1'); edit(f, 'ab', 20, '1', '2'); edit(f, 'abc', 40, '2', '3');
  assert.equal(f.history.undo.length, 1); const entry = store.travelHistory(f, 'undo'); assert.equal(f.current, ''); assert.equal(entry.selectionBefore, '0'); assert.equal(entry.selectionAfter, '3');
  store.travelHistory(f, 'redo'); assert.equal(f.current, 'abc');
});
test('pauses, moved selections, input kinds and explicit boundaries split typing groups', () => {
  const f = file(); edit(f, 'a', 0, '0', '1'); edit(f, 'ab', 950, '1', '2'); edit(f, 'axb', 960, '1', '2'); edit(f, 'ab', 970, '2', '1', 'delete');
  store.breakHistoryGroup(f); edit(f, 'a', 980, '1', '0', 'delete'); assert.equal(f.history.undo.length, 5);
});
test('composition groups merge intermediate text across time and stop at a new composition', () => {
  const f = file();
  for (const [text, time] of [['n', 0], ['ni', 3000], ['你', 8000]]) store.editDocument(f, text, { group: { key: 'composition:1', time, composition: true } });
  store.editDocument(f, '你好', { group: { key: 'composition:2', time: 9000, composition: true } }); assert.equal(f.history.undo.length, 2);
  store.travelHistory(f, 'undo'); assert.equal(f.current, '你'); store.travelHistory(f, 'undo'); assert.equal(f.current, '');
});
test('cancelled composition does not leave an empty undo entry', () => {
  const f = file(); store.editDocument(f, 'n', { group: { key: 'ime', composition: true } }); store.editDocument(f, '', { group: { key: 'ime', composition: true } });
  assert.equal(f.history.undo.length, 0); assert.equal(f.current, ''); assert.equal(f.dirty, false);
  edit(f, 'a', 20, '0', '1'); assert.equal(f.history.undo.length, 1); store.travelHistory(f, 'undo'); assert.equal(f.current, '');
});
test('undo, commands and save acknowledgements form history boundaries without losing dirty content', async () => {
  const f = file(); edit(f, 'a', 0, '0', '1'); const save = store.createSaveCoordinator(async submitted => ({ content: submitted.content })); await save(f);
  edit(f, 'ab', 10, '1', '2'); assert.equal(f.history.undo.length, 2); assert.equal(f.disk, 'a');
  store.travelHistory(f, 'undo'); edit(f, 'ac', 20, '1', '2'); assert.equal(f.history.undo.length, 2); assert.equal(f.history.redo.length, 0);
  store.editDocument(f, 'COMMAND'); edit(f, 'COMMANDx', 30, '7', '8'); assert.equal(f.history.undo.length, 4); assert.equal(f.disk, 'a');
});

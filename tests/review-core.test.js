'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { lineDiff, inlineDiff, groupDiffRows, applyDiffGroups } = require('../public/app-core');
const { createReviewStore } = require('../public/review-store');

function reviewStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('review decisions survive reload with accepted and rejected blocks and can be reset', () => {
  const storage = reviewStorage(), scope = { root: '/docs', currentBranch: 'main' };
  const baseline = 'First\nKeep\nSecond', current = 'First changed\nKeep\nSecond changed';
  const decisions = new Map([[0, 'accept'], [2, 'reject']]);
  const file = { path: 'a.dita', baseline, current: applyDiffGroups(baseline, current, decisions, 0, 'accept') };
  createReviewStore(storage).save(scope, file, baseline, current, decisions);
  const restored = createReviewStore(storage).restore(scope, file);
  assert.equal(restored.current, current);
  assert.deepEqual(restored.decisions, decisions);
  createReviewStore(storage).save(scope, file, baseline, current, new Map());
  assert.equal(createReviewStore(storage).restore(scope, file).decisions.size, 0);
});

test('new edits reopen only changed blocks and do not confuse identical insertions', () => {
  const storage = reviewStorage(), scope = { root: '/docs', currentBranch: 'main' }, store = createReviewStore(storage);
  const baseline = 'First\nKeep\nSecond\nTail', current = 'Added\nFirst\nKeep\nAdded\nSecond changed\nTail';
  const file = { path: 'a.dita', baseline, current };
  const groups = groupDiffRows(lineDiff(baseline, current), 0);
  const index = groups.findIndex(group => group.type === 'changed');
  store.save(scope, file, baseline, current, new Map([[index, 'accept']]));
  const restored = store.restore(scope, { ...file, current: current.replace('Second changed', 'Second changed again') });
  assert.deepEqual([...restored.decisions.values()], ['accept']);
  assert.equal(restored.decisions.has(index), true);
  assert.equal(store.restore(scope, { ...file, current: current.replace('Added', 'Different') }).decisions.size, 0);
});

test('review acceptance remains aligned after an unrelated earlier insertion', () => {
  const storage = reviewStorage(), scope = { root: '/docs', currentBranch: 'main' }, store = createReviewStore(storage);
  const baseline = 'First\nKeep\nSecond', current = 'First\nKeep\nSecond changed';
  const file = { path: 'a.dita', baseline, current };
  store.save(scope, file, baseline, current, new Map([[1, 'accept']]));
  const next = store.restore(scope, { ...file, current: 'Inserted\n' + current });
  const groups = groupDiffRows(lineDiff(baseline, next.current), 0);
  assert.equal(next.decisions.size, 1);
  assert.match(groups[[...next.decisions.keys()][0]].rows.map(row => row.text).join(' '), /Second changed/);
});

test('review progress is isolated by repository, branch, path and baseline', () => {
  const scope = { root: '/docs', currentBranch: 'main' }, store = createReviewStore(reviewStorage());
  const file = { path: 'a.dita', baseline: 'Old', current: 'New' };
  store.save(scope, file, file.baseline, file.current, new Map([[0, 'accept']]));
  for (const [otherScope, otherFile] of [[{ ...scope, root: '/other' }, file], [{ ...scope, currentBranch: 'release' }, file],
    [scope, { ...file, path: 'b.dita' }], [scope, { ...file, baseline: 'Updated' }], [scope, { ...file, current: 'Old' }]]) {
    assert.equal(store.restore(otherScope, otherFile).decisions.size, 0);
  }
});

test('unavailable or corrupt review storage keeps content intact and reports its limitation', t => {
  t.mock.method(console, 'warn', () => {});
  const scope = { root: '/docs', currentBranch: 'main' }, file = { path: 'a.dita', baseline: 'Old', current: 'New' };
  const storage = { getItem() { return '{'; }, setItem() { throw Error('Quota'); } };
  const store = createReviewStore(storage);
  assert.equal(store.restore(scope, file).current, file.current);
  store.save(scope, file, file.baseline, file.current, new Map([[0, 'accept']]));
  assert.match(store.warning, /仅保存在本页/);
  const memory = createReviewStore(null);
  memory.save(scope, file, file.baseline, file.current, new Map([[0, 'accept']]));
  assert.match(memory.warning, /仅保存在本页/);
  assert.equal(memory.restore(scope, file).decisions.get(0), 'accept');
});

test('inline diff highlights only the changed words', () => {
  assert.deepEqual(inlineDiff('Old title', 'New title'), [
    { type: 'old', text: 'Old' },
    { type: 'new', text: 'New' },
    { type: 'same', text: ' title' }
  ]);
  assert.deepEqual(inlineDiff('The old value', 'The new value'), [
    { type: 'same', text: 'The ' },
    { type: 'old', text: 'old' },
    { type: 'new', text: 'new' },
    { type: 'same', text: ' value' }
  ]);
});

test('inline diff handles insertions, deletions, equality, and Unicode characters', () => {
  assert.deepEqual(inlineDiff('hello world', 'hello brave world'), [
    { type: 'same', text: 'hello ' },
    { type: 'new', text: 'brave ' },
    { type: 'same', text: 'world' }
  ]);
  assert.deepEqual(inlineDiff('hello brave world', 'hello world'), [
    { type: 'same', text: 'hello ' },
    { type: 'old', text: 'brave ' },
    { type: 'same', text: 'world' }
  ]);
  assert.deepEqual(inlineDiff('same', 'same'), [{ type: 'same', text: 'same' }]);
  assert.deepEqual(inlineDiff('A😀', 'A😃'), [
    { type: 'same', text: 'A' },
    { type: 'old', text: '😀' },
    { type: 'new', text: '😃' }
  ]);
});

test('inline diff bounds memory for long replacements', () => {
  const oldText = 'a'.repeat(1200);
  const newText = 'b'.repeat(1200);
  assert.deepEqual(inlineDiff(oldText, newText), [
    { type: 'old', text: oldText },
    { type: 'new', text: newText }
  ]);
});

test('multiple inline edits advance both sides and preserve the exact old and new text', () => {
  for (const [before, after, unchanged] of [
    ['AT+OLD\n    wait(30);', 'AT+NEW\n    wait(60);', 'wait('],
    ['超时为 <b>30</b> 秒。旧说明。', '超时为 <b>60</b> 秒。新说明。', '秒'],
    ['A &amp; B &#x1F642; <port>', 'A &amp; C &#x1F600; <port>', '&amp;'],
    ['😀旧值，第二处🙂旧值', '😃新值，第二处🙃新值', '第二处']
  ]) {
    const result = inlineDiff(before, after);
    assert.equal(result.filter(part => part.type !== 'new').map(part => part.text).join(''), before);
    assert.equal(result.filter(part => part.type !== 'old').map(part => part.text).join(''), after);
    assert.ok(result.some(part => part.type === 'same' && part.text.includes(unchanged)));
  }
});

test('line diff groups separate edits and preserves context', () => {
  const baseline = [
    '<?xml version="1.0"?>',
    '<topic>',
    '  <title>Old title</title>',
    '  <body>',
    '    <p>First</p>',
    '    <p>Second</p>',
    '  </body>',
    '</topic>'
  ].join('\n');
  const current = baseline
    .replace('<title>Old title</title>', '<title>New title</title>')
    .replace('<p>Second</p>', '<p>Second edited</p>');

  const groups = groupDiffRows(lineDiff(baseline, current));
  assert.equal(groups.filter(group => group.type === 'changed').length, 2);
  assert.ok(groups.some(group => group.type === 'same' && group.rows.some(row => row.text.includes('First'))));
});

test('unreviewed blocks remain unchanged while other blocks are accepted or rejected', () => {
  const baseline = 'alpha\nkeep-one\nbeta\nkeep-two\ngamma\n';
  const current = 'Alpha\nkeep-one\nBeta\nkeep-two\nGamma\n';
  const changedIndexes = groupDiffRows(lineDiff(baseline, current))
    .map((group, index) => group.type === 'changed' ? index : -1)
    .filter(index => index >= 0);
  assert.equal(changedIndexes.length, 3);

  const acceptFirst = new Map([[changedIndexes[0], 'accept']]);
  assert.equal(applyDiffGroups(baseline, current, acceptFirst, 3), 'Alpha\nkeep-one\nbeta\nkeep-two\ngamma\n');

  const rejectSecond = new Map([[changedIndexes[1], 'reject']]);
  assert.equal(applyDiffGroups(baseline, current, rejectSecond, 3), 'alpha\nkeep-one\nbeta\nkeep-two\ngamma\n');

  const mixed = new Map([[changedIndexes[0], 'accept'], [changedIndexes[1], 'reject']]);
  assert.equal(applyDiffGroups(baseline, current, mixed, 3), 'Alpha\nkeep-one\nbeta\nkeep-two\ngamma\n');
});

test('review can accept or reject each changed block independently', () => {
  const baseline = 'alpha\none\nbeta\nkeep\ngamma\n';
  const current = 'Alpha\none\nbeta\nkeep\nGamma\n';
  const changedIndexes = groupDiffRows(lineDiff(baseline, current))
    .map((group, index) => group.type === 'changed' ? index : -1)
    .filter(index => index >= 0);
  assert.equal(changedIndexes.length, 2);

  const acceptedFirstOnly = applyDiffGroups(baseline, current, new Map([[changedIndexes[0], 'accept']]), 3);
  assert.equal(acceptedFirstOnly, 'Alpha\none\nbeta\nkeep\ngamma\n');

  const rejectedFirstOnly = applyDiffGroups(baseline, current, new Map([[changedIndexes[1], 'reject']]), 3);
  assert.equal(rejectedFirstOnly, 'alpha\none\nbeta\nkeep\ngamma\n');

  assert.equal(applyDiffGroups(baseline, current, new Map(changedIndexes.map(index => [index, 'accept'])), 3), current);
  assert.equal(applyDiffGroups(baseline, current, new Map(), 3), baseline);
});

test('review context is compact and decision indexes remain stable', () => {
  const baseline = 'a\n' + Array.from({ length: 10 }, (_, index) => `same-${index}`).join('\n') + '\nb\n' + Array.from({ length: 10 }, (_, index) => `same2-${index}`).join('\n') + '\nc\n';
  const current = baseline.replace('a', 'A').replace('c', 'C');
  const groups = groupDiffRows(lineDiff(baseline, current));
  const sameGroups = groups.filter(group => group.type === 'same');
  assert.ok(sameGroups.every(group => group.rows.length <= 3));
  const changedIndexes = groups.map((group, index) => group.type === 'changed' ? index : -1).filter(index => index >= 0);
  assert.equal(changedIndexes.length, 2);
  assert.equal(applyDiffGroups(baseline, current, new Map([[changedIndexes[0], 'accept']])), current.replace('C', 'c'));
  assert.equal(applyDiffGroups(baseline, current, new Map()), baseline);
});

test('line diff keeps inserted lines anchored to following XML', () => {
  const baseline = 'a\nb\nc';
  const current = 'a\ninserted\nb\nc';
  const rows = lineDiff(baseline, current);
  assert.deepEqual(rows.filter(row => row.type === 'same').map(row => row.text), ['a', 'b', 'c']);
  const groups = groupDiffRows(rows);
  const changedIndex = groups.findIndex(group => group.type === 'changed');
  assert.notEqual(changedIndex, -1);
  assert.equal(applyDiffGroups(baseline, current, new Map([[changedIndex, 'accept']])), current);
  assert.equal(applyDiffGroups(baseline, current, new Map()), baseline);
});

test('review shows bounded context before and after a single deletion', () => {
  const baseline = Array.from({ length: 100 }, (_, index) => `line-${index}`).join('\n');
  const current = baseline.replace('line-50\n', '');
  const rows = lineDiff(baseline, current);
  const groups = groupDiffRows(rows, 3);
  assert.equal(groups.filter(group => group.type === 'changed').length, 1);
  assert.ok(groups.filter(group => group.type === 'same').every(group => group.rows.length <= 3));
  const changedIndex = groups.findIndex(group => group.type === 'changed');
  assert.equal(applyDiffGroups(baseline, current, new Map([[changedIndex, 'accept']])), current);
  assert.equal(applyDiffGroups(baseline, current, new Map()), baseline);
});

test('line diff keeps a single deletion isolated in a large document', () => {
  const baseline = Array.from({ length: 3000 }, (_, index) => `line-${index}`).join('\n');
  const currentLines = baseline.split('\n');
  currentLines.splice(1500, 1);
  const rows = lineDiff(baseline, currentLines.join('\n'));

  assert.deepEqual(rows.filter(row => row.type === 'old').map(row => row.text), ['line-1500']);
  assert.equal(rows.filter(row => row.type === 'new').length, 0);
  assert.equal(rows.filter(row => row.type === 'same').length, 2999);
  assert.equal(rows.find(row => row.type === 'same' && row.text === 'line-1501').newIndex, 1501);
});

test('large repeated XML lines stay aligned around several separate deletions', () => {
  const baselineLines = Array.from({ length: 3000 }, (_, index) => `    <p>Repeat ${index % 10}</p>`);
  const currentLines = baselineLines.filter((_, index) => ![500, 1500, 2500].includes(index));
  const baseline = baselineLines.join('\n');
  const current = currentLines.join('\n');
  const rows = lineDiff(baseline, current);
  const changedGroups = groupDiffRows(rows).filter(group => group.type === 'changed');

  assert.equal(rows.filter(row => row.type === 'old').length, 3);
  assert.equal(rows.filter(row => row.type === 'new').length, 0);
  assert.equal(rows.filter(row => row.type === 'same').length, 2997);
  assert.equal(changedGroups.length, 3);
  assert.ok(changedGroups.every(group => group.rows.length === 1));
  const groups = groupDiffRows(rows);
  const decisions = new Map(groups.map((group, index) => [index, group.type === 'changed' ? 'accept' : undefined]));
  assert.equal(applyDiffGroups(baseline, current, decisions), current);
  assert.equal(applyDiffGroups(baseline, current, new Map()), baseline);
});

test('review decisions keep a final newline insertion or deletion', () => {
  for (const [baseline, current] of [['a\nb', 'a\nb\n'], ['a\nb\n', 'a\nb']]) {
    const groups = groupDiffRows(lineDiff(baseline, current));
    const changedIndex = groups.findIndex(group => group.type === 'changed');
    assert.notEqual(changedIndex, -1);
    assert.equal(applyDiffGroups(baseline, current, new Map([[changedIndex, 'accept']])), current);
    assert.equal(applyDiffGroups(baseline, current, new Map()), baseline);
  }
});

test('line diff keeps XML after a deleted middle element unchanged', () => {
  const baseline = [
    '<topic>',
    '  <title>T</title>',
    '  <body>',
    '    <p>one</p>',
    '    <p>remove me</p>',
    '    <p>three</p>',
    '    <p>four</p>',
    '  </body>',
    '</topic>'
  ].join('\n');
  const current = baseline.replace('    <p>remove me</p>\n', '');
  const rows = lineDiff(baseline, current);

  assert.deepEqual(rows.filter(row => row.type === 'old').map(row => row.text), ['    <p>remove me</p>']);
  assert.equal(rows.filter(row => row.type === 'new').length, 0);
  assert.deepEqual(rows.filter(row => row.type === 'same').map(row => row.text).slice(-4), [
    '    <p>three</p>',
    '    <p>four</p>',
    '  </body>',
    '</topic>'
  ]);
});

test('review decisions preserve long unchanged context between blocks', () => {
  const baseline = [
    'a',
    ...Array.from({ length: 10 }, (_, index) => `same-${index}`),
    'b',
    ...Array.from({ length: 10 }, (_, index) => `same2-${index}`),
    'c'
  ].join('\n');
  const current = baseline.replace(/^a/m, 'A').replace(/^c/m, 'C');
  const groups = groupDiffRows(lineDiff(baseline, current), 3);
  const changedIndexes = groups
    .map((group, index) => group.type === 'changed' ? index : -1)
    .filter(index => index >= 0);
  assert.deepEqual(changedIndexes, [0, 2]);

  const acceptedFirst = applyDiffGroups(
    baseline,
    current,
    new Map([[changedIndexes[0], 'accept']]),
    3
  );
  assert.equal(acceptedFirst, baseline.replace(/^a/m, 'A'));
  assert.equal(acceptedFirst.split('\n').length, baseline.split('\n').length);
});

test('review merge keeps the working document line endings', () => {
  const baseline = 'a\nb\nc';
  const current = 'a\r\nB\r\nc';
  const changedIndex = groupDiffRows(lineDiff(baseline, current))
    .findIndex(group => group.type === 'changed');
  const accepted = applyDiffGroups(baseline, current, new Map([[changedIndex, 'accept']]));
  assert.equal(accepted, current);
  assert.ok(accepted.includes('\r\n'));
});

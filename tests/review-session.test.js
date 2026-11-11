'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createReviewSession, clearReviewState } = require('../public/review-session');
const { createReviewStore } = require('../public/review-store');
const docs = require('../public/document-store');
function fixture(inManual = false) {
  const a = docs.createDocument({ path: 'a.dita', content: 'First\nKeep\nSecond' });
  docs.editDocument(a, 'First changed\nKeep\nSecond changed');
  const b = docs.createDocument({ path: 'b.dita', content: 'B' }); docs.editDocument(b, 'B changed');
  const state = { root: '/docs', currentBranch: 'main', activePath: inManual ? 'manual.ditamap' : a.path, filesMap: new Map([[a.path, a], [b.path, b]]) };
  clearReviewState(state);
  const progress = createReviewStore(null), session = createReviewSession({ state, progress });
  if (inManual) session.prepareManual([a, b], true); else session.resetTopic(a);
  return { a, b, state, session, progress, write: (file, content, options) => docs.editDocument(file, content, options) };
}
for (const inManual of [false, true]) test((inManual ? 'manual' : 'Topic') + ' uses one review transaction for partial, bulk, reversal and history decisions', () => {
  const { a, b, state, session, write } = fixture(inManual), frame = session.frame(a, inManual);
  const changes = session.groups(frame).flatMap((group, index) => group.type === 'changed' ? [index] : []);
  session.decide(frame, new Map([[changes[0], 'accept']]), write);
  assert.equal(a.current, 'First changed\nKeep\nSecond changed'); assert.equal(a.disk, a.baseline);
  session.decide(frame, new Map([[changes[1], 'reject']]), write);
  assert.equal(a.current, 'First changed\nKeep\nSecond');
  const history = docs.travelHistory(a, 'undo'); session.restoreDecisions(history.reviewDecisionsBefore, a, history.reviewInManual);
  assert.equal(a.current, frame.current); assert.equal(session.decisionsFor(frame).size, 1);
  const redo = docs.travelHistory(a, 'redo'); session.restoreDecisions(redo.reviewDecisionsAfter, a, redo.reviewInManual);
  assert.equal(session.decisionsFor(frame).get(changes[1]), 'reject');
  session.decide(frame, new Map([[changes[1], null]]), write); assert.equal(a.current, frame.current);
  session.decide(frame, new Map(changes.map(index => [index, 'reject'])), write); assert.equal(a.current, a.baseline);
  session.decide(frame, new Map(changes.map(index => [index, 'accept'])), write); assert.equal(a.current, frame.current);
  assert.equal(b.current, 'B changed'); assert.equal(Object.hasOwn(a, 'reviewCurrent'), false);
  assert.equal(state.reviewDecisions.has(inManual ? a.path + '::' + changes[0] : changes[0]), true);
});
test('manual decision keys cannot collide between Topics or disturb another Topic on undo', () => {
  const { a, b, session, state, write } = fixture(true), fa = session.frame(a, true), fb = session.frame(b, true);
  session.decide(fa, new Map([[0, 'accept']]), write); session.decide(fb, new Map([[0, 'reject']]), write);
  assert.equal(session.decisionsFor(fa).get(0), 'accept'); assert.equal(session.decisionsFor(fb).get(0), 'reject');
  const undo = docs.travelHistory(b, 'undo'); session.restoreDecisions(undo.reviewDecisionsBefore, b, undo.reviewInManual);
  assert.equal(session.decisionsFor(fa).get(0), 'accept'); assert.equal(session.decisionsFor(fb).size, 0);
  assert.deepEqual([...state.reviewDecisions.keys()], ['a.dita::0']);
});
test('stale source, baseline, active document, workspace, branch and buffer identity cannot apply old review actions', () => {
  for (const mutate of [({ a }) => { a.current += '!'; }, ({ a }) => { a.baseline += '!'; },
    ({ state }) => { state.activePath = 'b.dita'; }, ({ state }) => { state.root = '/other'; },
    ({ state }) => { state.currentBranch = 'release'; }, ({ state, a }) => { state.filesMap.set(a.path, { ...a }); }]) {
    const f = fixture(), frame = f.session.frame(f.a, false); mutate(f); const content = f.a.current;
    assert.throws(() => f.session.decide(frame, new Map([[0, 'accept']]), () => { throw Error('writer must not run'); }), /原文已变化/);
    assert.equal(f.a.current, content); assert.equal(f.state.reviewDecisions.size, 0);
  }
});
test('undoing an earlier Topic decision preserves later decisions made in another Topic', () => {
  const { a, b, session, write } = fixture(true), fa = session.frame(a, true), fb = session.frame(b, true);
  session.decide(fa, new Map([[0, 'accept']]), write);
  session.decide(fb, new Map([[0, 'accept']]), write);
  const undo = docs.travelHistory(a, 'undo'); session.restoreDecisions(undo.reviewDecisionsBefore, a, undo.reviewInManual);
  assert.equal(session.decisionsFor(fa).size, 0); assert.equal(session.decisionsFor(fb).get(0), 'accept');
  const redo = docs.travelHistory(a, 'redo'); session.restoreDecisions(redo.reviewDecisionsAfter, a, redo.reviewInManual);
  assert.equal(session.decisionsFor(fa).get(0), 'accept'); assert.equal(session.decisionsFor(fb).get(0), 'accept');
});
test('history decisions follow their document when switching between Topic and manual review', () => {
  const { a, state, session, write } = fixture(), frame = session.frame(a, false);
  session.decide(frame, new Map([[0, 'accept']]), write);
  const entry = a.history.undo.at(-1); state.activePath = 'manual.ditamap'; session.prepareManual([a], true);
  session.restoreDecisions(entry.reviewDecisionsAfter, a, entry.reviewInManual);
  assert.equal(session.decisionsFor(session.frame(a, true)).get(0), 'accept');
  state.activePath = a.path; session.resetTopic(a);
  session.restoreDecisions(new Map([['a.dita::0', 'reject']]), a, true);
  assert.equal(session.decisionsFor(session.frame(a, false)).get(0), 'reject');
});
test('invalid decisions and a rejected writer leave original content and decision history intact', () => {
  const { a, state, session } = fixture(), frame = session.frame(a, false), original = a.current;
  for (const updates of [new Map([[0, 'approved']]), new Map([[1, 'accept']]), new Map([[-1, 'reject']]), new Map([['0', 'accept']])]) {
    assert.throws(() => session.decide(frame, updates, () => { throw Error('writer must not run'); }), /无效/);
  }
  assert.throws(() => session.decide(frame, new Map([[0, 'reject']]), () => { throw Error('write rejected'); }), /write rejected/);
  assert.equal(a.current, original); assert.equal(state.reviewDecisions.size, 0);
});
test('manual snapshots are private, refresh changed blocks and preserve decisions for untouched Topics', () => {
  const { a, b, state, session, write } = fixture(true), frame = session.frame(a, true);
  session.decide(frame, new Map([[0, 'accept']]), write); session.save(frame);
  docs.editDocument(b, 'B changed again'); session.prepareManual([a, b], false);
  assert.equal(session.decisionsFor(session.frame(a, true)).get(0), 'accept');
  assert.equal(session.frame(b, true).current, 'B changed again');
  session.prepareManual([a, b], true); assert.equal(session.decisionsFor(session.frame(a, true)).get(0), 'accept');
  clearReviewState(state); state.currentBranch = 'release'; session.prepareManual([a, b], false);
  assert.equal(session.decisionsFor(session.frame(a, true)).size, 0);
});

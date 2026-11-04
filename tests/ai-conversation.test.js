'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../public/ai-edit-core'), conversation = require('../public/ai-conversation');
const source = '<topic><title>T</title><body><p>发送请求，然后检查返回值。</p></body></topic>';
const begin = source.indexOf('发送'), scope = core.target(source, begin, begin + '发送请求，然后检查返回值。'.length);
const first = { summary: '润色完成', questions: [], edits: [{ id: 't0', before: scope.text, after: '发起请求，然后检查返回值。' }] };
test('conversation keeps every user requirement and the last cumulative proposal immutable', () => {
  const session = conversation.create(scope); assert.deepEqual(session.context('润色').instructions, []);
  session.record('润色，保留术语', first);
  const context = session.context('再简短些'); assert.deepEqual(context.instructions, ['润色，保留术语']); assert.equal(context.previousResult.edits[0].after, '发起请求，然后检查返回值。');
  assert.ok(Object.isFrozen(context.instructions)); assert.ok(Object.isFrozen(context.previousResult.edits[0]));
  session.record('再简短些', { ...first, edits: [{ ...first.edits[0], after: '发起请求，检查返回值。' }] });
  assert.deepEqual(session.context().instructions, ['润色，保留术语', '再简短些']); assert.equal(session.context().previousResult.edits[0].before, scope.text);
});
test('conversation rejects malformed/stale context and does not silently forget requirements at limits', () => {
  for (const value of [{ instructions: [1] }, { instructions: ['x'] }, { instructions: [], previousResult: first }, { instructions: ['x'], previousResult: { ...first, edits: [{ ...first.edits[0], before: '过期' }] } }]) assert.throws(() => conversation.validate(scope, value));
  const session = conversation.create(scope);
  for (let i = 0; i < 12; i++) session.record('要求' + i, first);
  assert.throws(() => session.context('继续'), /12 轮/); assert.equal(session.context().instructions.length, 12);
});
test('applying a proposal can rebase the conversation to the updated source while keeping pending requirements', () => {
  const initial = conversation.create(scope), result = { ...first, questions: ['正确超时值？'] }; initial.record('润色并修正超时', result);
  const updated = core.applyResult(scope, result).content, nextScope = core.target(updated, scope.start, scope.end + updated.length - source.length);
  const history = initial.context(), next = conversation.create(nextScope, { ...history, previousResult: { ...history.previousResult, edits: [] } });
  assert.equal(nextScope.text, first.edits[0].after); assert.deepEqual(next.context('60 秒').previousResult.questions, ['正确超时值？']);
  assert.deepEqual(next.context('60 秒').instructions, ['润色并修正超时']);
});

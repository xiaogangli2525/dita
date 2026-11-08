'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const core = require('../public/ai-scan-core');
const { createScanStore, mergeResult } = require('../public/ai-scan-store');
const { collectDemoFiles } = require('../scripts/demo-workspace');
const { decodeXmlBuffer } = require('../lib/document-files');
const file = (path, current) => ({ path, current });

function progressFixture() {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const snapshot = { root: '/docs', branch: 'main', path: 'main.ditamap', content: '<map/>', project: { schema: 1, models: ['M100'] },
    projectContent: null, noteRules: { expectedContent: null }, files: new Map([['a.dita', file('a.dita', '<p>First</p>')], ['b.dita', file('b.dita', '<p>Second</p>')]]) };
  const batches = ['a.dita', 'b.dita'].map((path, index) => ({ phase: 'section', evidence: [{ id: 'e' + index, path, kind: 'p', conditions: [], text: index ? 'Second' : 'First' }] }));
  const result = mergeResult(batches[0], { findings: [{ category: 'wording', summary: 'Clarify first', suggestion: 'Review wording', evidence: [{ id: 'e0', quote: 'First' }] }] });
  const run = { snapshot, batches, profile: 'test-model', outcomes: new Map([[0, { status: 'done', result, error: '' }], [1, { status: 'failed', result: null, error: 'Timeout' }]]) };
  return { storage, run };
}

test('scan progress restores successful and failed batches with validated evidence', () => {
  const { storage, run } = progressFixture();
  createScanStore(storage).save(run);
  const restored = createScanStore(storage).load(run.snapshot, run.batches, run.profile);
  assert.equal(restored.restored, true);
  assert.equal(restored.outcomes.get(0).status, 'done');
  assert.equal(restored.outcomes.get(0).result.findings[0].summary, 'Clarify first');
  assert.equal(restored.outcomes.get(1).status, 'failed');
});

test('scan progress isolates roots, branches, manuals, model settings and conditions', () => {
  const { storage, run } = progressFixture();
  createScanStore(storage).save(run);
  const store = createScanStore(storage);
  for (const changed of [{ root: '/other' }, { branch: 'release' }, { path: 'other.ditamap' },
    { project: { schema: 1, models: ['M200'] } }, { content: '<map product="M100"/>' }, { noteRules: { expectedContent: 'new' } }]) {
    assert.equal(store.load({ ...run.snapshot, ...changed }, run.batches, run.profile).outcomes.size, 0);
  }
  assert.equal(store.load(run.snapshot, run.batches, 'other-model').outcomes.size, 0);
});

test('changed XML invalidates its batches while unchanged files keep their progress', () => {
  const { storage, run } = progressFixture(); createScanStore(storage).save(run);
  const changed = { ...run.snapshot, files: new Map(run.snapshot.files) };
  changed.files.set('a.dita', file('a.dita', '<p outputclass="changed">First</p>'));
  const next = createScanStore(storage).load(changed, run.batches, run.profile);
  assert.equal(next.outcomes.has(0), false);
  assert.equal(next.outcomes.has(1), true);
  assert.equal(next.discarded, 1);
});

test('partial retry unions coverage and never completes an uncovered fragment', () => {
  const batch = { phase: 'section', evidence: ['One', 'Two'].map((text, index) => ({ id: 'e' + index, path: 'a.dita', kind: 'p', conditions: [], text })) };
  const partial = mergeResult(batch, { findings: [], covered: ['e0'], failures: ['Timeout'] });
  assert.equal(partial.failures.length, 1);
  const finished = mergeResult(batch, { findings: [], covered: ['e1'] }, partial);
  assert.deepEqual(finished.covered, ['e0', 'e1']);
  assert.deepEqual(finished.failures, []);
  assert.ok(mergeResult(batch, { findings: [], covered: ['e0'] }).failures.length);
  assert.throws(() => mergeResult(batch, { findings: [], covered: ['foreign'] }), /覆盖/);
});

test('recovered scan batches retain more than one model response of valid findings', () => {
  const evidence = Array.from({ length: 14 }, (_, index) => ({ id: 'e' + index, path: 'a.dita', kind: 'p', conditions: [], text: 'Text ' + index }));
  const result = mergeResult({ phase: 'section', evidence }, { findings: evidence.map(item => ({ category: 'wording', summary: item.text,
    suggestion: 'Review wording', evidence: [{ id: item.id, quote: item.text }] })) });
  assert.equal(result.findings.length, 14);
});

test('scan storage failure keeps current-page progress and exposes a warning', t => {
  t.mock.method(console, 'warn', () => {});
  const { run } = progressFixture();
  const store = createScanStore({ getItem() { return null; }, setItem() { throw Error('Quota exceeded'); } });
  store.save(run);
  assert.match(store.warning, /仅保存在本页/);
  assert.equal(store.load(run.snapshot, run.batches, run.profile).outcomes.get(0).status, 'done');
  const corrupt = createScanStore({ getItem() { return '{'; } });
  assert.equal(corrupt.load(run.snapshot, run.batches, run.profile).outcomes.size, 0);
  assert.match(corrupt.warning, /仅保存在本页/);
});

test('a resumable plan retains batches beyond the per-run request budget', () => {
  const records = Array.from({ length: 700 }, (_, index) => ({ commands: [], input: { id: 'e' + index, path: 'a.dita', kind: 'p', conditions: [], text: 'x'.repeat(1500) } }));
  const limited = core.plan(records, false), complete = core.plan(records, false, { all: true });
  assert.ok(limited.skipped > 0);
  assert.equal(complete.skipped, 0);
  assert.deepEqual(complete.batches.slice(0, core.limits.sections), limited.batches);
  assert.equal(complete.batches.length, limited.batches.length + limited.skipped);
});

test('scan evidence retains source identity, inline wording and model conditions', () => {
  const source = '<topic><title>AT+MHTTPREQUEST</title><body><p>单位为<b>秒</b>。</p><p>参数<fn product="ML307R"><div>ML307R：单位为毫秒。</div></fn>说明。</p></body></topic>';
  const map = { source: '<map><topicgroup product="ML307R"><topicref href="a.dita"/></topicgroup><topicref href="a.dita"/></map>', children: [
    { type: 'container', children: [{ type: 'file', path: 'a.dita', sourcePath: '0.0' }] },
    { type: 'file', path: 'a.dita', sourcePath: '1' }
  ] };
  const { records, warnings } = core.collect([file('a.dita', source)], map);
  assert.deepEqual(warnings, []);
  const body = records.find(record => record.input.text === '单位为秒。');
  const footnote = records.find(record => record.input.kind === 'fn');
  assert.equal(body.xmlPath, '1/0');
  assert.match(source.slice(body.start, body.end), /<b>秒<\/b>/);
  assert.deepEqual(footnote.input.conditions, ['Map 引用（任选其一）=product=ML307R | 无条件', 'product=ML307R']);
  assert.match(footnote.input.text, /^ML307R/);
});

test('real HTTP chapters produce bounded batches and shared-command comparison evidence', () => {
  const files = collectDemoFiles(path.join(__dirname, '../examples/http_httpsusermanual'), 'http_httpsusermanual.ditamap');
  const input = [...files].filter(([name]) => /\.dita$/i.test(name)).map(([name, bytes]) => file(name, decodeXmlBuffer(bytes)));
  const { records } = core.collect(input), { batches, skipped } = core.plan(records, true);
  assert.equal(skipped, 0);
  assert.equal(batches.filter(batch => batch.phase === 'section').flatMap(batch => batch.evidence).length, records.length);
  assert.ok(records.some(record => record.input.kind === 'fn'));
  for (const batch of batches) core.validateBatch(batch);
  const compare = batches.find(batch => batch.command === 'AT+MHTTPCFG');
  assert.ok(compare.evidence.some(item => item.path.endsWith('/r_at_mhttpcfg.dita')));
  assert.ok(compare.evidence.some(item => item.path.endsWith('/r_http_example.dita')));
});

test('scan result requires literal quotes, valid IDs and multiple origins for cross comparisons', () => {
  const batch = core.validateBatch({ phase: 'cross', command: 'AT+MHTTPCFG', evidence: [
    { id: 'e0', path: 'a.dita', kind: 'p', conditions: [], text: '超时单位为秒' },
    { id: 'e1', path: 'b.dita', kind: 'p', conditions: ['product=MN318'], text: '超时示例使用毫秒' }
  ] });
  const item = { category: 'technical', summary: '单位待核对', suggestion: '确认适用型号及单位', evidence: [{ id: 'e0', quote: '单位为秒' }, { id: 'e1', quote: '使用毫秒' }] };
  const result = core.validateFindings({ findings: [item,
    { ...item, evidence: [item.evidence[0], { id: 'e1', quote: '不存在的引文' }] },
    { ...item, evidence: [item.evidence[0], { id: 'e100', quote: '使用毫秒' }] },
    { ...item, category: 'wording', evidence: [item.evidence[0]] }] }, batch);
  assert.deepEqual(result, { findings: [item], omitted: 3 });
  assert.throws(() => core.validateBatch({ ...batch, evidence: [batch.evidence[0], batch.evidence[0]] }), { status: 400 });
});

test('scan evidence follows unchanged text after an insertion and rejects changed scope or ambiguous duplicates', () => {
  const source = '<topic><title>T</title><body><p>待修改的正文</p><p product="ML307R">参数说明</p><p>重复文字</p><p>重复文字</p></body></topic>';
  const document = file('a.dita', source);
  const { records } = core.collect([document]);
  const find = text => records.find(record => record.input.text === text);
  const next = source.replace('待修改的正文', '重新编写的一段正文');
  const unchanged = core.rebase(document, next, records);
  assert.equal(unchanged.has(find('待修改的正文').input.id), false);
  assert.equal(unchanged.get(find('参数说明').input.id).start, next.indexOf('参数说明'));
  const changedScope = next.replace('ML307R', 'MN318').replace('<p>重复文字</p>', '');
  const changed = core.rebase(document, changedScope, records);
  assert.equal(changed.has(find('参数说明').input.id), false);
  assert.equal(changed.has(find('重复文字').input.id), false);
});

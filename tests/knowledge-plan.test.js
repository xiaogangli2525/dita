'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { normalizePlan, createPlanStore } = require('../public/knowledge-plan');
const { applyMetadata } = require('../public/knowledge-metadata');
const source = () => ({ repositoryRoot: 'E:\\work\\http', repository: 'http', branch: 'master', path: 'http.ditamap', title: 'HTTP', version: 'V1', filterPath: 'filters/g.ditaval', prefixes: true, mode: 'AT', module: 'HTTP', overrides: {} });
const plan = () => ({ schema: 1, id: 'plan-a', title: '开发者文档', model: 'ML307G', sdkVersion: 'V1', sources: [source()] });
function memory() {
  const map = new Map(); return { get length() { return map.size; }, key: index => [...map.keys()][index], getItem: name => map.get(name) ?? null, setItem: (name, value) => map.set(name, value) };
}
test('publication plans round-trip only validated settings, including Windows roots and metadata', () => {
  const value = plan(); value.sources[0].overrides = { 'topics/a.dita': { fingerprint: 'sha', kind: 'reference', aliases: ['配置连接'], definedSymbols: ['AT+CONFIG'] } };
  const fixed = normalizePlan({ ...value, sources: [{ ...source(), revision: 'refs/tags/sdk-v1' }] }); assert.equal(fixed.sources[0].revision, 'refs/tags/sdk-v1');
  const clean = normalizePlan({ ...value, html: 'private raw content', apiKey: 'secret' });
  assert.deepEqual(JSON.parse(JSON.stringify(clean)), value); assert.doesNotMatch(JSON.stringify(clean), /secret|raw content/);
  for (const bad of [{ sources: [{ ...source(), path: '../private' }] }, { sources: [{ ...source(), filterPath: 'C:/private' }] }, { sources: [{ ...source(), mode: 'invented' }] }, { sources: [source(), source()] }, { id: '../bad' }, { schema: 99 }]) assert.throws(() => normalizePlan({ ...value, ...bad }));
  assert.throws(() => normalizePlan({ ...value, sources: [{ ...source(), overrides: { 'a.dita': { fingerprint: 'x', kind: 'javascript', aliases: [], definedSymbols: [] } } }] }));
});
test('saved plans detect stale same-plan updates and preserve unrelated plans and corrupted data', () => {
  const storage = memory(), first = createPlanStore(storage), second = createPlanStore(storage), value = plan();
  const old = first.save(value); assert.equal(first.list().length, 1);
  const newer = second.save({ ...value, sdkVersion: 'V2' }, old);
  assert.throws(() => first.save({ ...value, title: 'stale' }, old), /其它窗口/);
  assert.equal(first.list()[0].serialized, newer);
  first.save({ ...value, id: 'plan-b' }); assert.equal(first.list().length, 2);
  storage.setItem('dita.knowledge.plan.v1:corrupt', '{broken'); assert.throws(() => first.list());
  assert.equal(storage.getItem('dita.knowledge.plan.v1:corrupt'), '{broken');
  assert.throws(() => createPlanStore(null).save(value), /JSON/);
});
test('metadata is bound to published chapter text and never silently applied after content changes', () => {
  const original = { title: 'HTTP', entries: [{ sourcePath: 'a.dita', fingerprint: 'a', kind: 'guide', aliases: [], definedSymbols: [], symbols: ['AT+CONFIG'] }] };
  const recipe = { ...source(), overrides: { 'a.dita': { fingerprint: 'a', kind: 'reference', aliases: ['连接参数'], definedSymbols: ['AT+CONFIG'] } } };
  const applied = applyMetadata(original, recipe);
  assert.deepEqual(applied.entries[0].aliases, ['连接参数']); assert.deepEqual(original.entries[0].aliases, []);
  const stale = applyMetadata({ ...original, entries: [{ ...original.entries[0], fingerprint: 'b' }] }, recipe);
  assert.deepEqual(stale.staleMetadata, ['a.dita']); assert.deepEqual(stale.entries[0].aliases, []);
  assert.deepEqual(applyMetadata({ ...original, entries: [] }, recipe).staleMetadata, ['a.dita']);
});
test('omitted shared support metadata does not block old plans or suppress unrelated stale metadata', () => {
  const cn = 'contentmodule/topics/reusable_general_cn/g_service_and_support_cn.dita';
  const en = 'contentmodule/topics/reusable_general_en/g_service_and_support_en.dita';
  const original = { title: 'HTTP', entries: [] };
  const overrides = { [cn]: { fingerprint: 'old' }, [en]: { fingerprint: 'old' }, 'topics/removed.dita': { fingerprint: 'old' } };
  const result = applyMetadata(original, { overrides });
  assert.deepEqual(result.staleMetadata, ['topics/removed.dita']);
  assert.equal(Object.keys(overrides).length, 3);
});

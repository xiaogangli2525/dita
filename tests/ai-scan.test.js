'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const core = require('../public/ai-scan-core');
const { collectDemoFiles } = require('../scripts/demo-workspace');
const { decodeXmlBuffer } = require('../lib/document-files');
const file = (path, current) => ({ path, current });

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

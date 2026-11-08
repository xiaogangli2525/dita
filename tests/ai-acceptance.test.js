'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto'), { spawnSync } = require('node:child_process');
const { evaluate, prepare, corpus, defaultDirectory } = require('../scripts/ai-acceptance');
const { createAiProvider } = require('../lib/ai-provider');
const { options } = require('../scripts/check-ai');
const env = { DITA_AI_BASE_URL: 'https://model.example.test/v1', DITA_AI_MODEL: 'acceptance-simulator', DITA_AI_API_KEY: 'acceptance-test-secret' };

function fixtureProvider() {
  const prompts = new Map(), sent = [];
  for (const spec of corpus.cases) for (const [index, turn] of (spec.turns || []).entries()) prompts.set(turn.instruction, { spec, index });
  const provider = createAiProvider({ env, fetchImpl: async (_url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content); sent.push(input);
    let answer;
    if (input.task === 'scan') {
      answer = { findings: input.phase === 'cross' ? [{ category: 'technical', summary: '同条件范围不一致', suggestion: '请研发核对范围',
        evidence: input.evidence.map(item => ({ id: item.id, quote: item.text })) }] : [] };
    } else {
      const { spec, index } = prompts.get(input.instruction), turn = spec.turns[index];
      if (spec.id === 'continued-note' && index === 1) {
        assert.equal(input.conversation.instructions.length, 1);
        assert.ok(input.conversation.previousResult.edits.some(edit => edit.after.includes('SSL相关参数设置')));
      }
      const edits = input.document.parts.flatMap(part => {
        let after = part.text;
        for (const [before, value] of turn.replacements) after = after.replace(before, () => value);
        return after === part.text ? [] : [{ id: part.id, before: part.text, after }];
      });
      answer = { summary: '验收模拟返回', questions: spec.kind === 'clarify' ? ['请提供研发核实的正确数值。'] : [], edits,
        ...(spec.kind === 'blocked' ? { blockedReason: '当前接口仅支持文字修订，不能新增章节或修改 Map。' } : {}) };
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '<think>模拟格式兼容性</think>\n\x60\x60\x60json\n' + JSON.stringify(answer) + '\n\x60\x60\x60' } }] }));
  } });
  return { provider, sent };
}

test('real HTTP acceptance preflight prepares all cases without calling a model or writing source', async () => {
  const before = new Map([...new Set(corpus.cases.map(item => item.path))].map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(defaultDirectory, name))).digest('hex')]));
  const report = await evaluate();
  assert.equal(report.ready, 13); assert.equal(report.failed, 0); assert.equal(report.passed, 0); assert.equal(report.requests, 0); assert.equal(report.modelExecuted, false);
  assert.equal(prepare(corpus.cases.find(item => item.kind === 'guard')).guarded, true);
  for (const [name, hash] of before) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(defaultDirectory, name))).digest('hex'), hash);
  assert.equal(fs.existsSync(path.join(defaultDirectory, 'acceptance-variant')), false);
});

test('the acceptance harness checks every real-source case through the compatible provider and cumulative conversation', async () => {
  const { provider, sent } = fixtureProvider();
  const report = await evaluate({ provider, live: true });
  assert.equal(report.failed, 0, JSON.stringify(report.cases.filter(item => item.status === 'fail')));
  assert.equal(report.passed, 13); assert.equal(report.requests, 13); assert.equal(sent.length, 13);
  assert.equal(report.manualReviewRequired, true); assert.equal(report.model, 'acceptance-simulator');
  assert.doesNotMatch(JSON.stringify(report), /acceptance-test-secret/);
});

test('semantic failures remain failures and do not hide the remaining acceptance cases', async () => {
  const { provider } = fixtureProvider(); let calls = 0;
  const original = provider.generate;
  provider.generate = (...args) => ++calls <= 2 ? Promise.resolve({ summary: '未执行修改', questions: [], edits: [] }) : original(...args);
  const report = await evaluate({ provider, live: true });
  assert.equal(report.failed, 2); assert.equal(report.passed, 11); assert.equal(report.notRun, 0); assert.equal(report.stopped, false);
});

test('repeated adapter failures stop requests and cannot leak credentials or raw upstream errors', async () => {
  const provider = { configuration: () => ({ available: true, model: 'broken' }), generate() { throw Object.assign(Error('authorization: Bearer secret-key; raw body'), { status: 502 }); } };
  const report = await evaluate({ provider, live: true });
  assert.equal(report.requests, 2); assert.equal(report.failed, 2); assert.equal(report.notRun, 11); assert.equal(report.stopped, true);
  assert.doesNotMatch(JSON.stringify(report), /secret-key|authorization|raw body/);
});

test('invalid or changed fixture locations fail before any model call', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dita-ai-acceptance-')); t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  fs.mkdirSync(path.join(directory, 'docs')); fs.writeFileSync(path.join(directory, 'outside.dita'), '<topic><title>Outside</title></topic>');
  assert.throws(() => prepare({ ...corpus.cases[0], path: '../outside.dita' }, path.join(directory, 'docs')), /文档库/);
  assert.throws(() => prepare({ ...corpus.cases[0], anchor: '已不存在的内容' }), /锚点/);
  const report = await evaluate({ cases: [{ ...corpus.cases[0], anchor: '已不存在的内容' }], provider: { configuration: () => ({ available: true }), generate() { assert.fail('must not call model'); } }, live: true });
  assert.equal(report.failed, 1); assert.equal(report.requests, 0);
  assert.throws(() => options(['--case', 'unknown']), /未知/); assert.throws(() => options(['--docs']), /缺少/); assert.throws(() => options(['--key', 'secret']), /不支持/);
});

test('live CLI cannot report success when a real connection is missing', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dita-ai-cli-')); t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const result = spawnSync(process.execPath, ['scripts/check-ai.js', '--live', '--case', 'ssl-note', '--json'], { cwd: path.join(__dirname, '..'), encoding: 'utf8',
    env: { ...process.env, DITA_AI_CONFIG_FILE: path.join(directory, 'missing.json'), DITA_AI_BASE_URL: '', DITA_AI_MODEL: '', DITA_AI_API_KEY: '' } });
  assert.equal(result.status, 2); const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'blocked'); assert.equal(report.modelExecuted, false); assert.equal(report.requests, 0);
});

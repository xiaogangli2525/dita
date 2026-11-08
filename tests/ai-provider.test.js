'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createAiProvider } = require('../lib/ai-provider');
const core = require('../public/ai-edit-core');
const { createAiSettings } = require('../lib/ai-settings');
const writingPolicy = require('../lib/ai-writing-policy');
const xml = '<topic id="a"><title>HTTP</title><body><p>发送请求</p><p>不应发送的其他段落</p></body></topic>';
const block = core.inspect(xml).find(n => n.kind === 'p'), scope = core.target(xml, block.start, block.end);
const result = { summary: '更明确', questions: [], edits: [{ id: 't0', before: '发送请求', after: '发起请求' }] };
const env = { DITA_AI_BASE_URL: 'https://model.example.test/v1', DITA_AI_MODEL: 'test-model', DITA_AI_API_KEY: 'test-secret' };
const response = value => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
test('provider sends only explicit text scope and accepts validated JSON; configuration never exposes keys', async () => {
  let sent;
  const provider = createAiProvider({ env, fetchImpl: async (url, options) => { sent = { url, ...options }; return response(result); } });
  assert.doesNotMatch(JSON.stringify(provider.configuration()), /test-secret/);
  assert.deepEqual(await provider.generate({ instruction: '润色', scope, targetModel: 'ML307R' }), result);
  assert.equal(sent.url, env.DITA_AI_BASE_URL + '/chat/completions'); assert.equal(sent.redirect, 'error');
  assert.equal(sent.headers.authorization, 'Bearer test-secret'); assert.doesNotMatch(sent.body, /不应发送的其他段落/);
  const body = JSON.parse(sent.body); assert.equal(body.messages.length, 2); assert.equal(JSON.parse(body.messages[1].content).targetModel, 'ML307R');
  assert.ok(body.messages[0].content.includes(writingPolicy.text)); assert.deepEqual(JSON.parse(body.messages[1].content).conversation.instructions, []);
});
test('provider disables unconfigured/demo modes and rejects unsafe configuration without leaking secrets', () => {
  for (const settings of [{}, { ...env, DITA_AI_BASE_URL: 'http://model.example.test/v1' }, { ...env, DITA_AI_BASE_URL: 'https://user:secret@example.test/v1' }, { ...env, DITA_AI_BASE_URL: 'not a url secret' }, { ...env, DITA_AI_TOKEN_PARAMETER: 'wrong' }]) {
    const config = createAiProvider({ env: settings }).configuration(); assert.equal(config.available, false); assert.doesNotMatch(JSON.stringify(config), /secret/);
  }
  assert.equal(createAiProvider({ env, demoMode: true }).configuration().available, false);
  assert.equal(createAiProvider({ env: { DITA_AI_BASE_URL: 'http://127.0.0.1:11434/v1', DITA_AI_MODEL: 'local' } }).configuration().available, true);
});
test('provider rejects truncated, refused, non-JSON and oversized responses; upstream messages are not echoed', async () => {
  for (const value of [new Response('secret'), new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })), response({ ...result, edits: [{ id: 't99', before: '', after: 'bad' }] }), new Response('x'.repeat(256001)), new Response('test-secret echoed!', { status: 401 })]) {
    const provider = createAiProvider({ env, fetchImpl: async () => value });
    await assert.rejects(provider.generate({ instruction: '润色', scope }), e => !e.message.includes('test-secret'));
  }
});
test('provider bounds concurrency, aborts requests and releases slots after cancellation', async () => {
  const provider = createAiProvider({ env, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true })) });
  const a = new AbortController(), b = new AbortController();
  const first = assert.rejects(provider.generate({ instruction: '润色', scope }, a.signal), /取消/);
  const second = assert.rejects(provider.generate({ instruction: '润色', scope }, b.signal), /取消/);
  await assert.rejects(provider.generate({ instruction: '润色', scope }), e => e.status === 429);
  a.abort(); b.abort(); await Promise.all([first, second]);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(provider.generate({ instruction: '润色', scope }, aborted.signal), /取消/);
});
const scanEvidence = Array.from({ length: 8 }, (_, index) => ({ id: 'e' + index, path: 'chapter.dita', kind: 'p', conditions: [], text: '扫描证据 ' + index }));
const scanBatch = { phase: 'section', evidence: scanEvidence };
const scanReply = (content, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content } }] }));

test('scan accepts one complete fenced JSON result with a reasoning prelude and keeps evidence validation', async () => {
  const valid = { category: 'wording', summary: '核对表述', suggestion: '确认术语', evidence: [{ id: 'e0', quote: '扫描证据 0' }] };
  const content = '<think>已核对</think>\n\x60\x60\x60json\n' + JSON.stringify({ findings: [
    valid, { ...valid, evidence: [{ id: 'e1', quote: '不存在的引文' }] }
  ] }) + '\n\x60\x60\x60';
  const provider = createAiProvider({ env, fetchImpl: async () => scanReply(content, null) });
  assert.deepEqual(await provider.scan(scanBatch), { findings: [valid], omitted: 1 });
});

test('writing accepts complete JSON wrappers on a real HTTP note without relaxing source guards', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../examples/http_httpsusermanual/topics/r_https_example.dita'), 'utf8');
  const block = core.inspect(source).find(item => item.kind === 'note' && source.slice(item.start, item.end).includes('SSL相应参数设置'));
  const selected = core.target(source, block.start, block.end);
  const part = selected.parts.find(item => item.text.includes('SSL相应参数设置'));
  const answer = { summary: '统一表述', questions: [], edits: [{ id: part.id, before: part.text, after: part.text.replace('SSL相应参数设置', 'SSL相关参数设置') }] };
  for (const content of ['\x60\x60\x60json\n' + JSON.stringify(answer) + '\n\x60\x60\x60', '<think>核对原文</think>\n' + JSON.stringify(answer)]) {
    const provider = createAiProvider({ env, fetchImpl: async () => scanReply(content) });
    const actual = await provider.generate({ instruction: '仅把SSL相应参数设置改为SSL相关参数设置', scope: selected });
    assert.equal(core.applyResult(selected, actual).content, source.replace('SSL相应参数设置', 'SSL相关参数设置'));
  }
  for (const content of ['这是修改结果：' + JSON.stringify(answer), JSON.stringify(answer) + '\n' + JSON.stringify(answer), '\x60\x60\x60json\n' + JSON.stringify(answer), JSON.stringify({ ...answer, edits: [{ ...answer.edits[0], before: '过期原文' }] })]) {
    const provider = createAiProvider({ env, fetchImpl: async () => scanReply(content) });
    await assert.rejects(provider.generate({ instruction: '润色', scope: selected }));
  }
});

test('a truncated scan retries smaller sections and reports only successful evidence coverage', async () => {
  const sent = [];
  const provider = createAiProvider({ env, fetchImpl: async (_url, options) => {
    const evidence = JSON.parse(JSON.parse(options.body).messages[1].content).evidence;
    sent.push(evidence.map(item => item.id));
    if (evidence.length === 8) return scanReply('{"findings":[', 'length');
    return evidence[0].id === 'e0' ? response({ findings: [] }) : scanReply('invalid');
  } });
  const result = await provider.scan(scanBatch);
  assert.deepEqual(sent.map(batch => batch.length), [8, 4, 4]);
  assert.deepEqual(result.covered, ['e0', 'e1', 'e2', 'e3']);
  assert.deepEqual(result.findings, []);
  assert.match(result.failures[0], /扫描 JSON/);
});

test('scan rejects refusals and truncated cross-chapter comparisons without retrying or reporting coverage', async () => {
  let requests = 0;
  const provider = createAiProvider({ env, fetchImpl: async () => scanReply('{"findings":[]}', ++requests === 1 ? 'content_filter' : 'length') });
  await assert.rejects(provider.scan(scanBatch), /拒绝/);
  const cross = { phase: 'cross', command: 'AT+HTTP', evidence: scanEvidence.map((item, index) => ({ ...item, path: index < 4 ? 'chapter.dita' : 'example.dita' })) };
  await assert.rejects(provider.scan(cross), /长度上限/);
  assert.equal(requests, 2);
});
test('connection settings keep secrets server-side and never carry a key to a different endpoint', () => {
  const store = { load: () => null, save() {} }, settings = createAiSettings({ env, store });
  const input = { baseUrl: env.DITA_AI_BASE_URL, model: env.DITA_AI_MODEL, key: '', allowHttp: false, noAuth: false };
  assert.equal(settings.update(input).keyConfigured, true);
  assert.doesNotMatch(JSON.stringify(settings.configuration()), /test-secret/);
  assert.throws(() => settings.update({ ...input, baseUrl: 'https://another.example.test/v1' }), /密钥/);
  assert.equal(settings.configuration().baseUrl, env.DITA_AI_BASE_URL);
  assert.equal(settings.update({ ...input, baseUrl: 'https://another.example.test/v1', key: 'new-secret' }).keyConfigured, true);
  assert.equal(settings.update({ ...input, noAuth: true }).keyConfigured, false);
  assert.throws(() => createAiSettings({ env, demoMode: true, store }).update(input), /演示/);
});
test('followup requests include previous user requirements and the cumulative draft', async () => {
  let sent;
  const provider = createAiProvider({ env, fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return response(result); } });
  const previous = { summary: '缺少参数', questions: ['正确值是多少？'], edits: [] };
  await provider.generate({ scope, instruction: '已核实，改为 60 秒', conversation: { instructions: ['润色并修正超时值'], previousResult: previous } });
  const input = JSON.parse(sent.messages[1].content);
  assert.deepEqual(input.conversation.instructions, ['润色并修正超时值']); assert.deepEqual(input.conversation.previousResult.questions, previous.questions);
  assert.equal(input.instruction, '已核实，改为 60 秒');
});

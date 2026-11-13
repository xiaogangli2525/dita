'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { PROFILE, normalizeInput, chunksFor, createIndex, validate } = require('../public/knowledge-semantic');
const { flatten, mergeBooks } = require('../lib/knowledge-book');
const { createSearchEngine } = require('../public/knowledge-search');
const row = (text, manualId = 'a') => ({ manualId, manualTitle: 'HTTP', title: '参数', anchor: manualId + '-topic', text });
const countTokens = text => text.length + 2;
const vector = column => { const value = Array(512).fill(0); value[column] = 1; return value; };

test('semantic chunks keep exact chapter offsets, overlap and stable content binding', async () => {
  const records = [row('说明内容。'.repeat(180))], chunks = await chunksFor(records, countTokens);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.equal(chunk.anchor, 'a-topic');
    assert.ok(chunk.text.endsWith(records[0].text.slice(chunk.start, chunk.end)));
    assert.ok(chunk.end - chunk.start <= PROFILE.maxChunkChars);
  }
  const index = createIndex(chunks, chunks.map(() => vector(0)));
  assert.equal(validate(records, index).length, chunks.length * 512);
  assert.throws(() => validate([row(records[0].text + '新内容')], index), /正文不一致/);
  assert.throws(() => validate(records, { ...index, profile: { ...PROFILE, revision: 'other' } }), /不兼容/);
  assert.throws(() => validate(records, { ...index, vectors: index.vectors.slice(8) }), /长度无效/);
  assert.throws(() => validate(records, createIndex(chunks, chunks.map(() => Array(512).fill(0)))), /归一化/);
});

test('token-budget chunks cover long titles and full source while rejecting gaps and altered context', async () => {
  const records = [row('甲'.repeat(1800) + '文末特有内容'), row('', 'empty')];
  records[0].manualTitle = '手册'.repeat(160); records[0].title = '标题'.repeat(160);
  const chunks = await chunksFor(records, countTokens), index = createIndex(chunks, chunks.map(() => vector(0)));
  assert.ok(chunks.every(chunk => countTokens(chunk.text) <= PROFILE.tokenLimit));
  assert.ok(chunks.at(-1).text.endsWith('文末特有内容'));
  validate(records, index);
  const missing = { ...index, chunks: chunks.slice(0, -1) };
  assert.throws(() => validate(records, missing), /正文不一致/);
  assert.throws(() => validate(records, { ...index, chunks: chunks.map((chunk, i) => i === 1 ? { ...chunk, start: chunk.start + 1 } : chunk) }), /正文不一致/);
  assert.throws(() => validate(records, { ...index, chunks: chunks.map((chunk, i) => i === 0 ? { ...chunk, context: ['伪造标题', ''] } : chunk) }), /正文不一致/);
  assert.equal(normalizeInput('ＡＴ+MHTTPCFG'), 'at+mhttpcfg');
});

test('semantic manual packs merge without re-embedding and reject mixed profiles or duplicates', async () => {
  async function book(id) {
    const value = { schema: 1, model: 'MR380R', sdkVersion: 'v1', manuals: [{ id, title: id, entries: [{ title: '参数', anchor: 'topic', text: '完整参数说明' }] }] };
    const chunks = await chunksFor(flatten(value), countTokens); value.semantic = createIndex(chunks, chunks.map(() => vector(id === 'a' ? 0 : 1))); return value;
  }
  const a = await book('a'), b = await book('b'), combined = mergeBooks([a, b]);
  const values = validate(flatten(combined), combined.semantic);
  assert.equal(values[0], 1); assert.equal(values[513], 1);
  assert.throws(() => mergeBooks([a, a]), /重复手册/);
  assert.throws(() => mergeBooks([a, { ...b, model: 'ML307G' }]), /型号/);
  assert.throws(() => mergeBooks([a, { ...b, semantic: undefined }]), /同时包含/);
  assert.throws(() => mergeBooks([a, { ...b, semantic: { ...b.semantic, profile: { ...PROFILE, dtype: 'fp32' } } }]), /不兼容/);
});

test('short unknown Chinese fragments cannot satisfy keyword coverage through typo guesses', () => {
  const records = [{ manualId: 'webui', title: '前端定制开发', text: 'WebUI 首次运行，默认验证。' },
    { manualId: 'dialup', title: 'API说明', text: '再次设置默认参数，验证返回值。' }];
  const engine = createSearchEngine();
  assert.deepEqual(engine.search(records, engine.build(records), 'webui二次认证'), []);
});

test('local embedding runtime generates usable vectors while all HTTP access is disabled', { skip: !process.env.BLINK_MODELS }, async () => {
  const fetch = global.fetch;
  global.fetch = async () => { throw Error('Network use in offline test'); };
  try {
    const { createEncoder } = require('../lib/semantic-encoder');
    const encoder = createEncoder(), records = [row('HTTP 客户端超时参数 timeout 说明。')];
    const chunks = await encoder.chunksFor(records), vectors = await encoder.encode(chunks.map(chunk => chunk.text));
    assert.equal(validate(records, createIndex(chunks, vectors)).length, 512);
    const [query] = await encoder.encode(['如何配置超时'], true);
    assert.equal(query.length, 512);
    const commands = ['AT+MHTTPCFG', 'at+mhttpcfg', 'AT+MHTTPCFGG'];
    const [upper, lower, other] = await encoder.encode(commands);
    assert.deepEqual(upper, lower);
    assert.ok(Math.max(...upper.map((value, i) => Math.abs(value - other[i]))) > 0.01, 'different command spellings must retain different vectors');
    const technical = [row('参数 ' + 'AT+MHTTPCFG timeout=120 HTTP说明。'.repeat(100))];
    technical[0].manualTitle = '超长标题'.repeat(100);
    technical[0].title = 'AT+MHTTPCFG 参数参考'.repeat(30);
    const budgeted = await encoder.chunksFor(technical);
    assert.ok(budgeted.length > 1);
    for (const chunk of budgeted) {
      assert.equal(chunk.tokenCount, await encoder.countTokens(chunk.text));
      assert.ok(chunk.tokenCount <= PROFILE.tokenLimit);
    }
    assert.equal(budgeted.at(-1).end, technical[0].text.length);
    assert.equal(validate(technical, createIndex(budgeted, await encoder.encode(budgeted.map(chunk => chunk.text)))).length, budgeted.length * 512);
    await assert.rejects(() => encoder.encode(['字'.repeat(600)]), /Token 预算/);
    await assert.rejects(() => encoder.encode(['字'.repeat(500)], true), /缩短问题/);
  } finally { global.fetch = fetch; }
});


test('clear multi-term lexical evidence keeps priority over a merely similar chapter', async () => {
  const semantic = require('../lib/knowledge-semantic'), original = semantic.encoder.encode;
  semantic.encoder.encode = async () => [vector(0)];
  try {
    const records = [row('服务器文件下载到本地。'), { ...row('发送 HTTP 请求并保存响应。', 'b'), title: '发送请求' }];
    const chunks = await chunksFor(records, countTokens);
    const candidate = similarity => { const value = vector(0); value[0] = similarity; value[1] = Math.sqrt(1 - similarity ** 2); return value; };
    const index = createIndex(chunks, [candidate(0.56), candidate(0.8)]);
    const lexical = [{ position: 0, score: 62, reason: '章节关键词匹配', matchedTerms: ['服务器', '文件', '下载', '本地'] },
      { position: 1, score: 27, reason: '章节关键词匹配', matchedTerms: ['文件', '下载', '本地'] }];
    assert.equal((await semantic.search(records, index, '把服务器文件下载到本地', lexical))[0].position, 0);
    assert.equal((await semantic.search(records, index, '把服务器文件下载到本地', lexical, { semanticOnly: true }))[0].position, 1);
  } finally { semantic.encoder.encode = original; }
});

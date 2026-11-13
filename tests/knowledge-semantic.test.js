'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { PROFILE, chunksFor, createIndex, validate } = require('../public/knowledge-semantic');
const { flatten, mergeBooks } = require('../lib/knowledge-book');
const { createSearchEngine } = require('../public/knowledge-search');
const row = (text, manualId = 'a') => ({ manualId, manualTitle: 'HTTP', title: '参数', anchor: manualId + '-topic', text });
const vector = column => { const value = Array(512).fill(0); value[column] = 1; return value; };

test('semantic chunks keep exact chapter offsets, overlap and stable content binding', () => {
  const records = [row('说明内容。'.repeat(180))], chunks = chunksFor(records);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.equal(chunk.anchor, 'a-topic');
    assert.ok(chunk.text.endsWith(records[0].text.slice(chunk.start, chunk.end)));
    assert.ok(chunk.end - chunk.start <= PROFILE.chunkSize);
  }
  const index = createIndex(chunks, chunks.map(() => vector(0)));
  assert.equal(validate(records, index).length, chunks.length * 512);
  assert.throws(() => validate([row(records[0].text + '新内容')], index), /正文不一致/);
  assert.throws(() => validate(records, { ...index, profile: { ...PROFILE, revision: 'other' } }), /不兼容/);
  assert.throws(() => validate(records, { ...index, vectors: index.vectors.slice(8) }), /长度无效/);
  assert.throws(() => validate(records, createIndex(chunks, chunks.map(() => Array(512).fill(0)))), /归一化/);
});

test('semantic manual packs merge without re-embedding and reject mixed profiles or duplicates', () => {
  function book(id) {
    const value = { schema: 1, model: 'MR380R', sdkVersion: 'v1', manuals: [{ id, title: id, entries: [{ title: '参数', anchor: 'topic', text: '完整参数说明' }] }] };
    const chunks = chunksFor(flatten(value)); value.semantic = createIndex(chunks, chunks.map(() => vector(id === 'a' ? 0 : 1))); return value;
  }
  const a = book('a'), b = book('b'), combined = mergeBooks([a, b]);
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
    const chunks = chunksFor(records), vectors = await encoder.encode(chunks.map(chunk => chunk.text));
    assert.equal(validate(records, createIndex(chunks, vectors)).length, 512);
    const [query] = await encoder.encode(['如何配置超时'], true);
    assert.equal(query.length, 512);
  } finally { global.fetch = fetch; }
});

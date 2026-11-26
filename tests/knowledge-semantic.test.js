'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { PROFILE, normalizeInput, chunksFor, createIndex, validate } = require('../public/knowledge/knowledge-semantic');
const { flatten, mergeBooks } = require('../lib/knowledge-book');
const { createSearchEngine } = require('../public/knowledge/knowledge-search');
const row = (text, manualId = 'a') => ({ manualId, manualTitle: 'HTTP', title: '参数', anchor: manualId + '-topic', text });
const countTokens = text => text.length + 2;
const vector = column => { const value = Array(512).fill(0); value[column] = 1; return value; };

test('prepared reader search validates and decodes the index once for repeated queries', async t => {
  const semantic = require('../lib/knowledge-semantic');
  t.mock.method(semantic.encoder, 'encode', async () => [vector(0)]);
  const records = [row('使用本机日志定位连接问题。')], chunks = await chunksFor(records, countTokens);
  const index = createIndex(chunks, chunks.map(() => vector(0)));
  const encoded = index.vectors;
  let reads = 0;
  Object.defineProperty(index, 'vectors', { get() { reads++; return encoded; } });
  const search = semantic.createSearch(records, index);
  const first = await search('怎么查日志', []);
  assert.equal(first[0].position, 0);
  assert.deepEqual(await search('怎么查日志', []), first);
  assert.equal(reads, 1);
});

test('all retrieval modes preserve normalized numeric and error-code constraints without inference', async t => {
  const semantic = require('../lib/knowledge-semantic');
  t.mock.method(semantic.encoder, 'encode', async () => { throw Error('Exact queries must not load the model'); });
  const records = [{ ...row('HTTP error code 656，return -2，status 0x2f，1.25。'), module: 'HTTP', mode: 'AT' }];
  const chunks = await chunksFor(records, countTokens), index = createIndex(chunks, chunks.map(() => vector(0)));
  const engine = createSearchEngine(), lexicalIndex = engine.build(records);
  for (const query of ['HTTP返回99999是什么错误', 'HTTP error code 99999', 'HTTP status 0xFFFF', 'return -17', '0xFFFF', '-17', '1.2', 'ＨＴＴＰ ｅｒｒｏｒ ９９９９９']) {
    assert.equal(semantic.requiresLexical(query), true, query);
    const lexical = engine.search(records, lexicalIndex, query);
    assert.deepEqual(lexical, [], query);
    for (const semanticOnly of [true, false]) assert.deepEqual(await semantic.search(records, index, query, lexical, { semanticOnly }), [], query);
  }
  for (const query of ['HTTP error 656', 'HTTP status 0x2F', 'return -2', '1.25', '０ｘ２Ｆ']) {
    const lexical = engine.search(records, lexicalIndex, query);
    assert.equal(lexical.length, 1, query);
    assert.deepEqual(await semantic.search(records, index, query, lexical), lexical);
    assert.deepEqual(await semantic.search(records, index, query, lexical, { manualId: 'other' }), []);
  }
});

test('semantic evidence retains the winning structural block and linked-note anchors', async t => {
  const structure = require('../public/knowledge/knowledge-structure'), semantic = require('../lib/knowledge-semantic');
  t.mock.method(semantic.encoder, 'encode', async () => [vector(0)]);
  const values = { kind: 'table-row', section: ['连接配置'], context: ['参数：timeout'], text: '等待时间为 30 秒。', notes: [{ id: 'fn1', text: '重试前释放连接。' }] };
  const unit = { ...values, id: 'b-timeout', sourceAnchor: 'timeout-row', fingerprint: structure.fingerprint(values) };
  const record = { ...row(values.text), sourcePath: 'topics/http.dita' };
  record.structure = structure.seal(record.title, record.text, [unit]);
  const chunks = await chunksFor([record], countTokens), index = createIndex(chunks, [vector(0)]);
  const [hit] = await semantic.search([record], index, '连接等待多久', []);
  assert.equal(hit.chunk.unitId, unit.id); assert.equal(hit.chunk.sourceAnchor, 'timeout-row');
  assert.equal(hit.chunk.sourcePath, 'topics/http.dita'); assert.deepEqual(hit.chunk.noteIds, ['fn1']);
  assert.match(hit.excerpt, /参数：timeout/); assert.match(hit.excerpt, /重试前释放连接/);
});

test('semantic scope filters safely exclude legacy records without module or mode metadata', async t => {
  const semantic = require('../lib/knowledge-semantic');
  t.mock.method(semantic.encoder, 'encode', async () => [vector(0)]);
  const records = [row('连接超时参数说明'), { ...row('连接超时参数说明', 'b'), module: 'HTTP', mode: 'AT' }];
  const chunks = await chunksFor(records, countTokens), index = createIndex(chunks, chunks.map(() => vector(0)));
  for (const scope of [{ module: 'HTTP' }, { mode: 'AT' }, { module: 'http', mode: 'at' }]) {
    const hits = await semantic.search(records, index, '连接等待多久', [], scope);
    assert.deepEqual(hits.map(hit => hit.position), [1]);
  }
  assert.deepEqual(await semantic.search(records, index, '连接等待多久', [], { module: 'MQTT' }), []);
});

test('semantic chunk and title boundaries retain whole Unicode characters and complete coverage', async () => {
  const { legacyChunksFor, LEGACY_PROFILE } = require('../public/knowledge/knowledge-semantic'), structure = require('../public/knowledge/knowledge-structure');
  const records = [row('A😀'.repeat(500))];
  records[0].manualTitle = '😀'.repeat(60); records[0].title = '😀'.repeat(60);
  for (const structured of [false, true]) {
    if (structured) {
      const values = { kind: 'paragraph', section: [], context: [], text: records[0].text, notes: [] };
      records[0].structure = structure.seal(records[0].title, records[0].text, [{ ...values, id: 'b-unicode', sourceAnchor: 'a-topic', fingerprint: structure.fingerprint(values) }]);
    }
    for (const [builder, profile] of [[chunksFor, PROFILE], [legacyChunksFor, LEGACY_PROFILE]]) {
      const chunks = await builder(records, countTokens);
      assert.ok(chunks.length > 1);
      for (const chunk of chunks) {
        assert.equal(chunk.text.isWellFormed(), true);
        assert.ok(chunk.context.every(text => text.isWellFormed()));
        assert.ok(records[0].text.slice(chunk.start, chunk.end).isWellFormed());
      }
      validate(records, createIndex(chunks, chunks.map(() => vector(0)), profile));
      assert.equal(chunks[0].start, 0); assert.equal(chunks.at(-1).end, records[0].text.length);
    }
  }
});

test('previously exported legacy Unicode overlap offsets remain readable', () => {
  const { LEGACY_PROFILE } = require('../public/knowledge/knowledge-semantic');
  const records = [{ ...row('😀'.repeat(400)), manualTitle: 'H' }], context = ['H', '参数'];
  const chunks = [[0, 503], [443, 800]].map(([start, end]) => {
    const text = [...context, records[0].text.slice(start, end)].join('\n');
    return { position: 0, manualId: 'a', anchor: 'a-topic', start, end, context, tokenCount: countTokens(text), text };
  });
  assert.ok(validate(records, createIndex(chunks, chunks.map(() => vector(0)), LEGACY_PROFILE)).length);
});

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

test('Int8 indexes preserve signed vector direction and source binding, rejecting corrupted rows', async () => {
  const { compactIndex, COMPACT_SCHEMA, compatible, encodedVectorLength } = require('../public/knowledge/knowledge-semantic');
  const records = [row('完整的连接说明。')], chunks = await chunksFor(records, countTokens);
  const values = [0.3, -0.4, 0.1, ...Array(509).fill(0)], norm = Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0));
  const original = createIndex(chunks, [values.map(value => value / norm)]), originalBytes = original.vectors;
  const compact = compactIndex(records, original);
  assert.equal(compact.schema, COMPACT_SCHEMA);
  assert.ok(compatible(compact));
  assert.equal(compact.vectors.length, encodedVectorLength(chunks.length, COMPACT_SCHEMA));
  assert.equal(atob(compact.vectors).length * 4, atob(originalBytes).length);
  assert.equal(original.schema, 1);
  assert.equal(original.vectors, originalBytes);
  assert.throws(() => compactIndex(records, createIndex(chunks, [Array(512).fill(0)])), /归一化|非零峰值/);
  assert.equal(compactIndex(records, compact), compact);
  assert.deepEqual(compact.chunks, original.chunks);
  const decoded = validate(records, compact), source = validate(records, original);
  assert.ok(decoded[1] < 0);
  assert.ok(source.reduce((cosine, value, i) => cosine + value * decoded[i], 0) > 0.9999);
  assert.ok(Math.abs(decoded.reduce((sum, value) => sum + value ** 2, 0) - 1) < 0.000001);
  assert.throws(() => validate(records, { ...compact, vectors: compact.vectors.slice(4) }), /长度无效/);
  for (const byte of ['\x00', '\x80']) assert.throws(
    () => validate(records, { ...compact, vectors: btoa(byte.repeat(512)) }), /未按约定编码/);
  assert.throws(() => validate([{ ...records[0], text: '原文改变' }], compact), /正文不一致/);
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
  const compact = require('../public/knowledge/knowledge-semantic').compactIndex(flatten(b), b.semantic);
  const mixed = mergeBooks([a, { ...b, semantic: compact }]);
  assert.equal(mixed.semantic.schema, 1);
  assert.deepEqual(validate(flatten(mixed), mixed.semantic), values);
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
    const technical = [row('参数 ' + 'AT+MHTTPCFG timeout=120 HTTP说明😀。'.repeat(100))];
    technical[0].manualTitle = '超长标题😀'.repeat(100);
    technical[0].title = 'AT+MHTTPCFG 参数参考😀'.repeat(30);
    const budgeted = await encoder.chunksFor(technical);
    assert.ok(budgeted.length > 1);
    for (const chunk of budgeted) {
      assert.equal(chunk.tokenCount, await encoder.countTokens(chunk.text));
      assert.ok(chunk.tokenCount <= PROFILE.tokenLimit);
      assert.ok(chunk.text.isWellFormed()); assert.ok(chunk.context.every(text => text.isWellFormed()));
    }
    assert.equal(budgeted.at(-1).end, technical[0].text.length);
    assert.equal(validate(technical, createIndex(budgeted, await encoder.encode(budgeted.map(chunk => chunk.text)))).length, budgeted.length * 512);
    await assert.rejects(() => encoder.encode(['字'.repeat(600)]), /Token 预算/);
    await assert.rejects(() => encoder.encode(['字'.repeat(500)], true), /缩短问题/);
  } finally { global.fetch = fetch; }
});


test('UART aliases use the same vector query without rebuilding the index', async () => {
  const semantic = require('../lib/knowledge-semantic'), original = semantic.encoder.encode;
  const queries = [];
  semantic.encoder.encode = async inputs => { queries.push(...inputs); return [vector(0)]; };
  try {
    const records = [row('类型：UART，最大组数：4。')], chunks = await chunksFor(records, countTokens);
    const search = semantic.createSearch(records, createIndex(chunks, chunks.map(() => vector(0))));
    for (const query of ['支持多少串口', '支持多少串行口', '支持多少 UART']) {
      const [hit] = await search(query, [], { semanticOnly: true });
      assert.equal(hit?.position, 0);
      assert.equal(hit?.semanticScore, 1);
    }
    assert.deepEqual(queries, Array(3).fill('支持多少 uart'));
  } finally { semantic.encoder.encode = original; }
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


test('secondary authentication questions require the requested capability rather than a generic WebUI mention', async () => {
  const semantic = require('../lib/knowledge-semantic'), original = semantic.encoder.encode;
  semantic.encoder.encode = async () => [vector(0)];
  try {
    const records = [{ ...row('WebUI 后端认证与页面开发。', 'generic'), manualTitle: 'WebUI开发' },
      { ...row('WebUI 双因素认证配置步骤。', 'two-factor'), manualTitle: 'WebUI开发' }];
    const chunks = await chunksFor(records, countTokens), index = createIndex(chunks, chunks.map(() => vector(0)));
    const hits = await semantic.search(records, index, 'webui二次认证', []);
    assert.deepEqual(hits.map(hit => hit.position), [1]);
  } finally { semantic.encoder.encode = original; }
});

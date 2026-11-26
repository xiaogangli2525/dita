'use strict';
const { aborted } = require('./abort');
const { setImmediate: yieldTask } = require('node:timers/promises');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PROFILE, normalizeInput, chunksFor: prepareChunks, legacyChunksFor } = require('../public/knowledge/knowledge-semantic');

const ASSETS = Object.freeze(require('../public/knowledge/semantic-model-assets.json'));
function createEncoder(modelRoot = process.env.BLINK_MODELS || path.join(__dirname, '..', 'models')) {
  let loaded;
  async function check() {
    for (const [name, sha] of Object.entries(ASSETS)) {
      let bytes;
      try { bytes = await fs.readFile(path.join(modelRoot, PROFILE.model, name)); }
      catch (cause) { throw Error('离线模型组件未准备好，请使用包含模型的完整包', { cause }); }
      if (createHash('sha256').update(bytes).digest('hex') !== sha) throw Error('离线模型组件校验失败，请重新准备：' + name);
    }
    return PROFILE;
  }
  async function load() {
    await check();
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowRemoteModels = false; env.allowLocalModels = true;
    env.localModelPath = path.resolve(modelRoot) + path.sep;
    env.useFSCache = false;
    return pipeline('feature-extraction', PROFILE.model, { dtype: PROFILE.dtype, device: 'cpu',
      local_files_only: true, session_options: { intra_op_num_threads: 2 } });
  }
  async function extractor() {
    if (!loaded) loaded = load().catch(error => { loaded = null; throw error; });
    return loaded;
  }
  async function countTokens(text) {
    const model = await extractor();
    return model.tokenizer(normalizeInput(text), { truncation: false, padding: false }).input_ids.data.length;
  }
  async function chunksFor(records, { legacy = false, signal } = {}) {
    let calls = 0;
    return (legacy ? legacyChunksFor : prepareChunks)(records, async text => {
      if (++calls % 32 === 0) await yieldTask();
      aborted(signal); const count = await countTokens(text); aborted(signal); return count;
    });
  }
  async function encode(texts, query = false, { signal } = {}) {
    aborted(signal);
    if (!Array.isArray(texts) || !texts.length || texts.length > 32 || texts.some(text => typeof text !== 'string' || !text.trim() || text.length > PROFILE.maxInputChars)) throw Error('每批向量化须提供 1～32 个有效文本片段');
    const model = await extractor(), inputs = texts.map(text => normalizeInput(query ? PROFILE.queryPrefix + text : text));
    for (const text of inputs) {
      aborted(signal);
      if (await countTokens(text) > PROFILE.tokenLimit) throw Error(query ? '搜索内容超出模型 Token 预算，请缩短问题' : '语义片段超出模型 Token 预算，请重新分片');
    }
    const output = await model(inputs, { pooling: PROFILE.pooling, normalize: true, truncation: false });
    aborted(signal); return output.tolist();
  }
  return { check, encode, countTokens, chunksFor };
}
module.exports = { ASSETS, createEncoder };

'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PROFILE } = require('../public/knowledge-semantic');

const ASSETS = Object.freeze({
  'config.json': 'd4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f',
  'tokenizer.json': '48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26',
  'tokenizer_config.json': 'e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a',
  'special_tokens_map.json': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
  'onnx/model_quantized.onnx': '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc'
});
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
  async function encode(texts, query = false) {
    if (!Array.isArray(texts) || !texts.length || texts.length > 32 || texts.some(text => typeof text !== 'string' || !text.trim() || text.length > 1000)) throw Error('每批向量化须提供 1～32 个有效文本片段，每段不超过 1000 字符');
    if (!loaded) loaded = load().catch(error => { loaded = null; throw error; });
    const extractor = await loaded;
    const output = await extractor(texts.map(text => query ? PROFILE.queryPrefix + text : text),
      { pooling: PROFILE.pooling, normalize: true, truncation: true, max_length: 512 });
    return output.tolist();
  }
  return { check, encode };
}
module.exports = { ASSETS, createEncoder };

'use strict';
(function (root) {
  const PROFILE = Object.freeze({ id: 'bge-small-zh-int8-cls-v2', model: 'Xenova/bge-small-zh-v1.5',
    revision: '75c43b069aac4d136ba6bc1122f995fedcfd2781', dimensions: 512, dtype: 'q8',
    pooling: 'cls', normalize: true, normalization: 'nfkc-ascii-lower-v1', tokenLimit: 512,
    manualTitleTokens: 32, titleTokens: 64, maxChunkChars: 2048, overlap: 60,
    queryPrefix: '为这个句子生成表示以用于检索相关文章：' });
  const sourceText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeInput = text => text.normalize('NFKC').replace(/[A-Z]/g, char => char.toLowerCase());
  const compatible = index => !!index && index.schema === 1 && !!index.profile && Object.keys(PROFILE).every(name => index.profile[name] === PROFILE[name]);
  const chunkText = (context, body) => [...context, body].filter(Boolean).join('\n');

  // The caller supplies the model's exact tokenizer. Character counts alone cannot
  // bound WordPiece input, especially when titles contain long technical strings.
  async function chunksFor(records, countTokens) {
    if (typeof countTokens !== 'function') throw Error('生成语义片段需要模型分词器');
    const chunks = [];
    async function prefix(text, budget) {
      let low = 0, high = Math.min(text.length, 160);
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (await countTokens(text.slice(0, middle)) <= budget) low = middle; else high = middle - 1;
      }
      return text.slice(0, low);
    }
    for (const [position, record] of records.entries()) {
      const text = sourceText(record.text), context = [await prefix(String(record.manualTitle || ''), PROFILE.manualTitleTokens), await prefix(String(record.title || ''), PROFILE.titleTokens)];
      for (let start = 0; start < text.length;) {
        let low = start + 1, high = Math.min(text.length, start + PROFILE.maxChunkChars);
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (await countTokens(chunkText(context, text.slice(start, middle))) <= PROFILE.tokenLimit) low = middle; else high = middle - 1;
        }
        let end = low;
        if (end < text.length) {
          const boundary = Math.max(text.lastIndexOf('。', end - 1), text.lastIndexOf('；', end - 1), text.lastIndexOf(';', end - 1));
          if (boundary > start + (end - start) / 2) end = boundary + 1;
        }
        const content = chunkText(context, text.slice(start, end)), tokenCount = await countTokens(content);
        if (tokenCount > PROFILE.tokenLimit) throw Error('语义片段超出模型 Token 预算');
        chunks.push({ position, manualId: record.manualId, anchor: record.anchor, start, end, context, tokenCount, text: content });
        if (chunks.length > 12000) throw Error('语义索引超过 12000 个片段，请减少手册后重试');
        if (end === text.length) break;
        start = end - Math.min(PROFILE.overlap, end - start - 1);
      }
    }
    return chunks;
  }

  function validateChunks(records, chunks) {
    if (!Array.isArray(chunks) || chunks.length > 12000) throw Error('语义片段数据无效');
    let cursor = 0;
    for (const [position, record] of records.entries()) {
      const text = sourceText(record.text);
      let start = 0, complete = !text.length;
      while (cursor < chunks.length && chunks[cursor].position === position) {
        const chunk = chunks[cursor++], context = chunk.context;
        if (complete || chunk.manualId !== record.manualId || chunk.anchor !== record.anchor || chunk.start !== start ||
          !Number.isInteger(chunk.end) || chunk.end <= start || chunk.end > text.length || chunk.end - start > PROFILE.maxChunkChars ||
          !Array.isArray(context) || context.length !== 2 || context.some(value => typeof value !== 'string' || value.length > 160) ||
          !String(record.manualTitle || '').startsWith(context[0]) || !String(record.title || '').startsWith(context[1]) ||
          !Number.isInteger(chunk.tokenCount) || chunk.tokenCount < 2 || chunk.tokenCount > PROFILE.tokenLimit ||
          chunk.text !== chunkText(context, text.slice(start, chunk.end))) throw Error('语义索引与当前正文不一致，请重新生成');
        complete = chunk.end === text.length;
        start = chunk.end - Math.min(PROFILE.overlap, chunk.end - start - 1);
      }
      if (!complete) throw Error('语义索引与当前正文不一致，请重新生成');
    }
    if (cursor !== chunks.length) throw Error('语义索引与当前正文不一致，请重新生成');
  }

  function encodeVectors(vectors) {
    const bytes = new Uint8Array(vectors.length * PROFILE.dimensions * 4), view = new DataView(bytes.buffer);
    vectors.forEach((row, index) => {
      if (row.length !== PROFILE.dimensions) throw Error('向量维度不一致');
      row.forEach((value, column) => {
        if (!Number.isFinite(value)) throw Error('向量含无效数值');
        view.setFloat32((index * PROFILE.dimensions + column) * 4, value, true);
      });
    });
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  }

  function validate(records, index) {
    if (!compatible(index)) throw Error('语义索引模型或编码配置不兼容，请使用 --build-index 重新生成');
    validateChunks(records, index.chunks);
    const binary = atob(index.vectors || '');
    if (binary.length !== index.chunks.length * PROFILE.dimensions * 4) throw Error('语义向量数据长度无效');
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0)), view = new DataView(bytes.buffer);
    const vectors = new Float32Array(binary.length / 4);
    for (let i = 0; i < vectors.length; i++) {
      vectors[i] = view.getFloat32(i * 4, true);
      if (!Number.isFinite(vectors[i])) throw Error('语义向量数据含无效数值');
    }
    for (let offset = 0; offset < vectors.length; offset += PROFILE.dimensions) {
      let norm = 0;
      for (let i = 0; i < PROFILE.dimensions; i++) norm += vectors[offset + i] ** 2;
      if (Math.abs(norm - 1) > 0.01) throw Error('语义向量未按约定归一化，请重新生成');
    }
    return vectors;
  }

  function createIndex(chunks, vectors) {
    if (chunks.length > 12000 || vectors.length !== chunks.length) throw Error('语义片段与向量数量无效');
    return { schema: 1, profile: PROFILE, chunks, vectors: encodeVectors(vectors) };
  }

  const api = { PROFILE, sourceText, normalizeInput, compatible, chunksFor, createIndex, validate };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeSemantic = api;
})(typeof window === 'undefined' ? globalThis : window);

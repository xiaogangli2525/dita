'use strict';
(function (root) {
  const PROFILE = Object.freeze({ id: 'bge-small-zh-int8-cls-v1', model: 'Xenova/bge-small-zh-v1.5',
    revision: '75c43b069aac4d136ba6bc1122f995fedcfd2781', dimensions: 512, dtype: 'q8',
    pooling: 'cls', normalize: true, chunkSize: 360, overlap: 60,
    queryPrefix: '为这个句子生成表示以用于检索相关文章：' });

  function chunksFor(records) {
    const chunks = [];
    for (const [position, record] of records.entries()) {
      const text = String(record.text || '').replace(/\s+/g, ' ').trim();
      for (let start = 0; start < text.length;) {
        let end = Math.min(text.length, start + PROFILE.chunkSize);
        if (end < text.length) {
          const boundary = Math.max(text.lastIndexOf('。', end), text.lastIndexOf('；', end));
          if (boundary > start + PROFILE.chunkSize / 2) end = boundary + 1;
        }
        chunks.push({ position, manualId: record.manualId, anchor: record.anchor, start, end,
          text: [String(record.manualTitle || '').slice(0, 160), String(record.title || '').slice(0, 160), text.slice(start, end)].filter(Boolean).join('\n') });
        if (end === text.length) break;
        start = end - PROFILE.overlap;
      }
    }
    if (chunks.length > 12000) throw Error('语义索引超过 12000 个片段，请减少手册后重试');
    return chunks;
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
    if (!index || index.schema !== 1 || !index.profile || !Object.keys(PROFILE).every(name => index.profile[name] === PROFILE[name])) throw Error('语义索引模型或编码配置不兼容，请重新生成');
    const expected = chunksFor(records);
    if (JSON.stringify(expected) !== JSON.stringify(index.chunks)) throw Error('语义索引与当前正文不一致，请重新生成');
    const binary = atob(index.vectors || '');
    if (binary.length !== expected.length * PROFILE.dimensions * 4) throw Error('语义向量数据长度无效');
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
    return { schema: 1, profile: PROFILE, chunks, vectors: encodeVectors(vectors) };
  }

  const api = { PROFILE, chunksFor, createIndex, validate };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeSemantic = api;
})(typeof window === 'undefined' ? globalThis : window);

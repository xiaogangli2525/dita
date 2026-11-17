'use strict';
(function (root) {
  const structure = typeof module !== 'undefined' ? require('./knowledge-structure') : root.DitaKnowledgeStructure;
  const LEGACY_PROFILE = Object.freeze({ id: 'bge-small-zh-int8-cls-v2', model: 'Xenova/bge-small-zh-v1.5',
    revision: '75c43b069aac4d136ba6bc1122f995fedcfd2781', dimensions: 512, dtype: 'q8',
    pooling: 'cls', normalize: true, normalization: 'nfkc-ascii-lower-v1', tokenLimit: 512,
    manualTitleTokens: 32, titleTokens: 64, maxChunkChars: 2048, overlap: 60,
    queryPrefix: '为这个句子生成表示以用于检索相关文章：' });
  const PROFILE = Object.freeze({ ...LEGACY_PROFILE, id: 'bge-small-zh-int8-cls-v3', structure: 'published-blocks-v1', maxInputChars: 8192 });
  const sourceText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeInput = text => text.normalize('NFKC').replace(/[A-Z]/g, char => char.toLowerCase());
  const sameProfile = (index, profile) => !!index && index.schema === 1 && !!index.profile && Object.keys(profile).every(name => index.profile[name] === profile[name]);
  const compatible = index => sameProfile(index, PROFILE) || sameProfile(index, LEGACY_PROFILE);
  const chunkText = (context, body) => [...context, body].filter(Boolean).join('\n');

  // The caller supplies the model's exact tokenizer. Character counts alone cannot
  // bound WordPiece input, especially when titles contain long technical strings.
  async function legacyChunksFor(records, countTokens) {
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

  function validateLegacyChunks(records, chunks) {
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

  function unitsFor(record) {
    const source = structure.validate(record);
    if (source) return source.units;
    const text = sourceText(record.text);
    return text ? [{ id: 'legacy-' + structure.fingerprint(text), kind: 'legacy', text, section: [], context: [], notes: [], sourceAnchor: record.anchor || '', fingerprint: structure.fingerprint(text) }] : [];
  }
  const unitNotes = unit => unit.notes.map(note => '注脚：' + note.text).join('\n');
  const unitText = (context, body, notes) => [...context, body, notes].filter(Boolean).join('\n');
  async function chunksFor(records, countTokens) {
    if (typeof countTokens !== 'function') throw Error('生成语义片段需要模型分词器');
    const chunks = [];
    async function prefix(text, budget) {
      let end = Math.min(text.length, 160);
      while (end && await countTokens(text.slice(0, end)) > budget) end--;
      return text.slice(0, end);
    }
    for (const [position, record] of records.entries()) {
      const titles = [await prefix(String(record.manualTitle || ''), PROFILE.manualTitleTokens), await prefix(String(record.title || ''), PROFILE.titleTokens)];
      for (const unit of unitsFor(record)) {
        const context = [...titles, ...unit.section.filter(Boolean), ...unit.context.filter(Boolean)], notes = unitNotes(unit);
        if (await countTokens(unitText(context, '', notes)) >= PROFILE.tokenLimit || unitText(context, '', notes).length > PROFILE.maxInputChars - 32) throw Error(record.title + '：表头、条件或关联注脚超出模型预算，请核对该结构块：' + unit.id);
        for (let start = 0; start < unit.text.length;) {
          let low = start + 1, high = Math.min(unit.text.length, start + PROFILE.maxChunkChars);
          while (low < high) {
            const middle = Math.ceil((low + high) / 2), value = unitText(context, unit.text.slice(start, middle), notes);
            if (value.length <= PROFILE.maxInputChars && await countTokens(value) <= PROFILE.tokenLimit) low = middle; else high = middle - 1;
          }
          let end = low;
          if (end < unit.text.length) {
            const boundary = Math.max(unit.text.lastIndexOf('\n', end - 1), unit.text.lastIndexOf('。', end - 1), unit.text.lastIndexOf('；', end - 1));
            if (boundary >= start + (end - start) / 2) end = boundary + 1;
          }
          const text = unitText(context, unit.text.slice(start, end), notes), tokenCount = await countTokens(text);
          if (tokenCount > PROFILE.tokenLimit || text.length > PROFILE.maxInputChars) throw Error(record.title + '：结构片段超出模型预算');
          chunks.push({ position, manualId: record.manualId, anchor: record.anchor, unitId: unit.id, unitFingerprint: unit.fingerprint,
            sourcePath: record.sourcePath || '', sourceAnchor: unit.sourceAnchor, kind: unit.kind, section: unit.section, noteIds: unit.notes.map(note => note.id),
            start, end, context, tokenCount, text, split: start > 0 || end < unit.text.length });
          if (chunks.length > 12000) throw Error('语义索引超过 12000 个片段，请减少手册后重试');
          if (end === unit.text.length) break;
          start = unit.kind === 'legacy' ? end - Math.min(PROFILE.overlap, end - start - 1) : end;
        }
      }
    }
    return chunks;
  }
  function validateStructuredChunks(records, chunks) {
    if (!Array.isArray(chunks) || chunks.length > 12000) throw Error('语义片段数据无效');
    let cursor = 0;
    for (const [position, record] of records.entries()) for (const unit of unitsFor(record)) {
      let start = 0;
      do {
        const chunk = chunks[cursor++], context = chunk?.context;
        const validContext = Array.isArray(context) && context.length === 2 + unit.section.filter(Boolean).length + unit.context.filter(Boolean).length &&
          context.every(value => typeof value === 'string') && context[0].length <= 160 && context[1].length <= 160 &&
          String(record.manualTitle || '').startsWith(context[0]) && String(record.title || '').startsWith(context[1]) &&
          JSON.stringify(context.slice(2)) === JSON.stringify([...unit.section.filter(Boolean), ...unit.context.filter(Boolean)]);
        if (!chunk || !validContext || chunk.position !== position || chunk.manualId !== record.manualId || chunk.anchor !== record.anchor ||
          chunk.unitId !== unit.id || chunk.unitFingerprint !== unit.fingerprint || chunk.sourcePath !== (record.sourcePath || '') || chunk.sourceAnchor !== unit.sourceAnchor || chunk.kind !== unit.kind ||
          JSON.stringify(chunk.section) !== JSON.stringify(unit.section) || JSON.stringify(chunk.noteIds) !== JSON.stringify(unit.notes.map(note => note.id)) ||
          chunk.start !== start || !Number.isInteger(chunk.end) || chunk.end <= start || chunk.end > unit.text.length || chunk.end - start > PROFILE.maxChunkChars ||
          !Number.isInteger(chunk.tokenCount) || chunk.tokenCount < 2 || chunk.tokenCount > PROFILE.tokenLimit || chunk.text.length > PROFILE.maxInputChars ||
          chunk.text !== unitText(context, unit.text.slice(start, chunk.end), unitNotes(unit)) || chunk.split !== (start > 0 || chunk.end < unit.text.length)) throw Error('语义索引与当前结构或正文不一致，请重新生成');
        if (chunk.end === unit.text.length) break;
        start = unit.kind === 'legacy' ? chunk.end - Math.min(PROFILE.overlap, chunk.end - start - 1) : chunk.end;
      } while (start < unit.text.length);
    }
    if (cursor !== chunks.length) throw Error('语义索引与当前结构或正文不一致，请重新生成');
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
    return encodeBytes(bytes);
  }
  function encodeBytes(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  }

  function validate(records, index) {
    if (!compatible(index)) throw Error('语义索引模型或编码配置不兼容，请使用 --build-index 重新生成');
    if (index.profile.id === LEGACY_PROFILE.id) validateLegacyChunks(records, index.chunks); else validateStructuredChunks(records, index.chunks);
    const binary = atob(index.vectors || '');
    if (binary.length !== index.chunks.length * PROFILE.dimensions * 4) throw Error('语义向量数据长度无效');
    const vectors = new Float32Array(binary.length / 4);
    const bytes = new Uint8Array(vectors.buffer), view = new DataView(vectors.buffer);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
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

  function createIndex(chunks, vectors, profile = PROFILE) {
    if (chunks.length > 12000 || vectors.length !== chunks.length) throw Error('语义片段与向量数量无效');
    return { schema: 1, profile, chunks, vectors: encodeVectors(vectors) };
  }

  function combineIndexes(groups, indexes) {
    if (!groups.length || groups.length !== indexes.length || groups.length > 30) throw Error('组合向量的手册数量无效');
    const profile = indexes[0]?.profile?.id === LEGACY_PROFILE.id ? LEGACY_PROFILE : PROFILE;
    const count = indexes.reduce((sum, index) => sum + (index?.chunks?.length || 0), 0);
    if (count > 12000) throw Error('语义索引超过 12000 个片段，请减少手册后重试');
    let recordsOffset = 0, offset = 0;
    // Legacy input may omit padding or contain whitespace accepted by atob.
    // Normalize that case so capacity estimates still match canonical base64.
    const single = indexes.length === 1 && typeof indexes[0].vectors === 'string' &&
      indexes[0].vectors.length === 4 * Math.ceil(count * profile.dimensions * 4 / 3) && !/\s/.test(indexes[0].vectors);
    const chunks = [], bytes = single ? null : new Uint8Array(count * profile.dimensions * 4), view = bytes && new DataView(bytes.buffer);
    for (const [i, records] of groups.entries()) {
      const index = indexes[i];
      if (index?.profile?.id !== profile.id) throw Error('合并包的分片配置不一致，请统一重建');
      const values = validate(records, index);
      if (view) for (let j = 0; j < values.length; j++) { view.setFloat32(offset, values[j], true); offset += 4; }
      chunks.push(...index.chunks.map(chunk => ({ ...chunk, position: chunk.position + recordsOffset })));
      recordsOffset += records.length;
    }
    return { schema: 1, profile, chunks, vectors: bytes ? encodeBytes(bytes) : indexes[0].vectors };
  }

  const api = { PROFILE, LEGACY_PROFILE, sourceText, normalizeInput, compatible, chunksFor, legacyChunksFor, unitsFor, createIndex, validate, combineIndexes };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeSemantic = api;
})(typeof window === 'undefined' ? globalThis : window);

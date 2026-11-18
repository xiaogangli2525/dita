'use strict';
(function (root) {
  const data = typeof module !== 'undefined' ? require('./knowledge-semantic') : root.DitaKnowledgeSemantic;
  function active(signal, current) { if (signal?.aborted || !current()) throw Object.assign(Error('已取消向量生成'), { name: 'AbortError' }); }
  const inputManual = manual => ({ id: manual.id, title: manual.title, entries: manual.entries });
  async function stream(api, endpoint, body, { signal, current, onProgress, onEstimate, onManual }) {
    active(signal, current);
    const response = await api.request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!response.ok) throw Error(await api.error(response));
    if (!response.body) throw Error('向量生成响应不完整，请重试');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '', received = 0, result;
    function consume(line) {
      active(signal, current); let value;
      try { value = JSON.parse(line); } catch (cause) { throw Error('向量生成响应格式无效，请重试', { cause }); }
      if (result) throw Error('向量生成响应包含重复结果');
      if (value.type === 'error') throw Error(value.message || '向量生成失败');
      if (value.type === 'result') result = value;
      else if (value.type === 'progress') onProgress(value);
      else if (value.type === 'estimate' && onEstimate) onEstimate(value);
      else if (value.type === 'manual' && onManual) onManual(value);
      else throw Error('向量生成响应格式无效，请重试');
    }
    try {
      while (true) {
        active(signal, current); const { done, value } = await reader.read(); active(signal, current);
        if (done) { pending += decoder.decode(); break; }
        received += value.byteLength; if (received > 128 * 1024 * 1024) throw Error('单份手册向量响应过大，请减少发布范围');
        pending += decoder.decode(value, { stream: true });
        let end; while ((end = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, end); pending = pending.slice(end + 1); if (line.trim()) consume(line); }
      }
      if (pending.trim()) consume(pending);
      if (!result) throw Error('向量生成中断，未收到完整结果，请重试');
      return result;
    } finally {
      await reader.cancel().catch(cause => { if (cause.name !== 'AbortError' && !signal?.aborted) console.warn('向量响应读取器关闭失败', cause.name); });
      reader.releaseLock();
    }
  }
  async function estimate({ api, manuals, model, force = false, signal, current = () => true, onProgress = () => {} }) {
    return stream(api, '/api/knowledge/estimate', { manuals: manuals.map(inputManual), model, force, profile: data.PROFILE.id }, { signal, current, onProgress });
  }
  async function generate({ api, manuals, model, force = false, signal, current = () => true, onProgress = () => {} }) {
    const indexes = [], groups = [], warnings = [];
    const stats = { reusedManuals: 0, rebuiltManuals: 0, totalManuals: manuals.length, totalChunks: 0 };
    for (const [position, manual] of manuals.entries()) {
      active(signal, current); onProgress({ ...stats, position: position + 1, manual: manual.title });
      const records = manual.entries.map(entry => ({ ...entry, manualId: manual.id, manualTitle: manual.title }));
      const result = await stream(api, '/api/knowledge/semantic', { manual: inputManual(manual), model, force, profile: data.PROFILE.id }, {
        signal, current, onProgress: value => onProgress({ ...stats, position: position + 1, manual: manual.title, done: value.done, total: value.total })
      });
      if (!['cache', 'generated', 'embedded'].includes(result.source) || !Array.isArray(result.warnings) || result.warnings.some(item => typeof item !== 'string') ||
          result.index?.schema !== 1 || result.index.profile?.id !== data.PROFILE.id) throw Error('向量生成响应不兼容，请刷新工作台后重试');
      data.validate(records, result.index);
      active(signal, current); groups.push(records); indexes.push(result.index); warnings.push(...result.warnings);
      stats[result.source === 'generated' ? 'rebuiltManuals' : 'reusedManuals']++; stats.totalChunks += result.index.chunks.length;
      if (stats.totalChunks > 12000) throw Error('语义索引超过 12000 个片段，请减少手册后重试');
      onProgress({ ...stats, position: position + 1, manual: manual.title, source: result.source });
    }
    active(signal, current); return { index: data.combineIndexes(groups, indexes), stats, warnings: [...new Set(warnings)] };
  }
  async function publish({ api, manuals, model, archiveOverhead, compact = false, force = false, signal, current = () => true, onProgress = () => {}, onEstimate = () => {} }) {
    const groups = [], indexes = [], stats = { reusedManuals: 0, rebuiltManuals: 0, totalManuals: manuals.length, totalChunks: 0 };
    let estimate;
    const result = await stream(api, '/api/knowledge/publish', { manuals: manuals.map(inputManual), model, force, archiveOverhead, profile: data.PROFILE.id, ...(compact ? { compact } : {}) }, {
      signal, current, onProgress,
      onEstimate(value) {
        if (estimate || (value.schema ?? 1) !== (compact ? data.COMPACT_SCHEMA : 1) ||
            JSON.stringify(value.profile) !== JSON.stringify(data.PROFILE) || !Number.isSafeInteger(value.chunks) || value.chunks < 0 ||
            value.chunks > 12000 || !Number.isSafeInteger(value.bytes) || value.bytes < 0) throw Error('语义容量核算结果无效');
        onEstimate(value); estimate = value;
      },
      onManual(value) {
        const manual = manuals[indexes.length];
        if (!estimate || !manual || value.manualId !== manual.id || !['cache', 'generated'].includes(value.source) ||
            value.index?.schema !== 1 || value.index.profile?.id !== data.PROFILE.id) throw Error('向量生成响应与发布集合不一致');
        const records = manual.entries.map(entry => ({ ...entry, manualId: manual.id, manualTitle: manual.title }));
        data.validate(records, value.index);
        stats[value.source === 'generated' ? 'rebuiltManuals' : 'reusedManuals']++; stats.totalChunks += value.index.chunks.length;
        if (stats.totalChunks > 12000) throw Error('语义索引超过 12000 个片段，请减少手册后重试');
        groups.push(records); indexes.push(value.index);
      }
    });
    if (!estimate || indexes.length !== manuals.length || stats.totalChunks !== estimate.chunks || Object.keys(stats).some(key => stats[key] !== result.stats?.[key]) || !Array.isArray(result.warnings) || result.warnings.some(value => typeof value !== 'string')) throw Error('向量生成中断或结果不完整，请重新导出');
    active(signal, current);
    return { index: data.combineIndexes(groups, indexes), stats, warnings: result.warnings };
  }
  const api = { generate, estimate, publish };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeIndex = api;
})(typeof window === 'undefined' ? globalThis : window);

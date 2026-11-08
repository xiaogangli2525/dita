'use strict';
(function (root) {
  const core = typeof module !== 'undefined' ? require('./ai-scan-core') : root.DitaAiScanCore;
  const findingKey = finding => finding.category + ':' + finding.evidence.map(ref => ref.id).sort().join(',');

  function mergeResult(batch, result, previous = null) {
    if (!result || !Array.isArray(result.findings) || result.findings.length > core.limits.items * 10) throw Error('扫描建议格式无效');
    // Server recovery can combine several individually validated model replies.
    const checked = { findings: [], omitted: 0 };
    for (let index = 0; index < result.findings.length; index += 10) {
      const part = core.validateFindings({ findings: result.findings.slice(index, index + 10) }, batch);
      checked.findings.push(...part.findings); checked.omitted += part.omitted;
    }
    const failures = result.failures || [];
    if (!Array.isArray(failures) || failures.some(value => typeof value !== 'string')) throw Error('扫描批次的失败说明无效');
    const ids = new Set(batch.evidence.map(item => item.id));
    const covered = result.covered || (failures.length ? [] : [...ids]);
    if (!Array.isArray(covered) || covered.some(id => !ids.has(id))) throw Error('扫描覆盖范围无效');
    const findings = new Map((previous?.findings || []).map(finding => [findingKey(finding), finding]));
    for (const finding of checked.findings) findings.set(findingKey(finding), finding);
    const combined = [...new Set([...(previous?.covered || []), ...covered])];
    const errors = [...failures];
    if (batch.phase === 'section' && combined.length !== ids.size && !errors.length) errors.push('仍有正文片段未完成');
    return { findings: [...findings.values()], covered: combined, failures: errors,
      omitted: (previous?.omitted || 0) + (Number.isInteger(result.omitted) && result.omitted >= 0 ? result.omitted : 0) + checked.omitted };
  }

  function createScanStore(storage) {
    const memory = new Map();
    let warning = storage ? '' : '扫描进度暂时仅保存在本页，浏览器存储不可用。';
    const key = snapshot => 'dita.ai-scan.v1:' + JSON.stringify([snapshot.root, snapshot.branch, snapshot.path]);
    const context = snapshot => JSON.stringify([snapshot.project, snapshot.projectContent,
      /\.ditamap$/i.test(snapshot.path) ? snapshot.content : '', snapshot.noteRules?.expectedContent]);
    function failed(error) {
      warning = '扫描进度暂时仅保存在本页，浏览器存储不可用。';
      console.warn('扫描进度存储失败', error);
    }
    function load(snapshot, batches, profile) {
      const outcomes = new Map();
      let discarded = 0;
      try {
        const raw = memory.get(key(snapshot)) || storage?.getItem(key(snapshot));
        if (!raw) return { outcomes, discarded, restored: false };
        const saved = JSON.parse(raw);
        if (saved.schema !== 1 || !Array.isArray(saved.outcomes) || !Array.isArray(saved.sources)) throw Error('扫描进度格式无效');
        if (saved.context !== context(snapshot) || saved.profile !== profile) {
          return { outcomes, discarded: saved.outcomes.length, restored: true };
        }
        const sources = new Map(saved.sources);
        const indexed = new Map(saved.outcomes.map(item => [JSON.stringify(item.batch), item]));
        batches.forEach((batch, index) => {
          const item = indexed.get(JSON.stringify(batch));
          if (!item) return;
          if (batch.evidence.some(ref => sources.get(ref.path) !== snapshot.files.get(ref.path)?.current)) { discarded++; return; }
          try {
            const result = item.result && mergeResult(batch, item.result);
            if (!result && typeof item.error !== 'string') throw Error('扫描批次进度无效');
            outcomes.set(index, { result, error: item.error || '', status: result && !result.failures.length ? 'done' : 'failed' });
          } catch (error) { discarded++; failed(error); }
        });
        return { outcomes, discarded: saved.outcomes.length - outcomes.size, restored: true };
      } catch (error) { failed(error); return { outcomes, discarded, restored: false }; }
    }
    function save(run) {
      try {
        const sources = [...run.snapshot.files].map(([path, file]) => [path, file.current]);
        const outcomes = [...run.outcomes].map(([index, outcome]) => ({ batch: run.batches[index], ...outcome }));
        const raw = JSON.stringify({ schema: 1, context: context(run.snapshot), profile: run.profile, sources, outcomes });
        memory.set(key(run.snapshot), raw);
        storage?.setItem(key(run.snapshot), raw);
      } catch (error) { failed(error); }
    }
    return { load, save, get warning() { return warning; } };
  }
  const api = { createScanStore, mergeResult, findingKey };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaAiScanStore = api;
})(typeof window === 'undefined' ? globalThis : window);

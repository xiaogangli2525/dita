'use strict';
(function (root) {
  const diff = typeof module !== 'undefined' ? require('./diff-core') : root.DitaDiffCore;

  // Baseline positions distinguish identical edits in different paragraphs.
  // New-line numbers are omitted so unrelated insertions do not reopen a decision.
  function changeKeys(baseline, current) {
    let offset = 0;
    return diff.groupDiffRows(diff.lineDiff(baseline, current), 0).map(group => {
      const start = offset;
      offset += group.rows.filter(row => row.type !== 'new').length;
      return group.type === 'changed' ? JSON.stringify([start, group.rows.map(row => [row.type, row.text])]) : null;
    });
  }

  function createReviewStore(storage) {
    const memory = new Map();
    let warning = storage ? '' : '审阅进度暂时仅保存在本页，浏览器存储不可用。';
    const key = (scope, file) => 'dita.review.v1:' + JSON.stringify([scope.root, scope.currentBranch, file.path]);
    function failed(error) {
      warning = '审阅进度暂时仅保存在本页，浏览器存储不可用。';
      console.warn('审阅进度存储失败', error);
    }
    function restore(scope, file) {
      const empty = () => ({ baseline: file.baseline, current: file.current, decisions: new Map() });
      if (!scope.root) return empty();
      try {
        const name = key(scope, file);
        const raw = memory.get(name) || storage?.getItem(name);
        if (!raw) return empty();
        const saved = JSON.parse(raw);
        if (saved.schema !== 1 || saved.baseline !== file.baseline || typeof saved.current !== 'string' ||
            !Array.isArray(saved.decisions) || saved.decisions.some(entry => !Array.isArray(entry) ||
              !Number.isInteger(entry[0]) || !['accept', 'reject'].includes(entry[1]))) return empty();
        const decisions = new Map(saved.decisions);
        if (diff.applyDiffGroups(saved.baseline, saved.current, decisions, 0, 'accept') === file.current) {
          return { baseline: saved.baseline, current: saved.current, decisions };
        }
        const accepted = new Set(changeKeys(saved.baseline, saved.current)
          .filter((value, index) => value && decisions.get(index) === 'accept'));
        const rebased = new Map();
        changeKeys(file.baseline, file.current).forEach((value, index) => {
          if (value && accepted.has(value)) rebased.set(index, 'accept');
        });
        return { baseline: file.baseline, current: file.current, decisions: rebased };
      } catch (error) { failed(error); return empty(); }
    }
    function save(scope, file, baseline, current, decisions) {
      if (!scope.root) return;
      try {
        const name = key(scope, file);
        if (decisions.size) {
          const raw = JSON.stringify({ schema: 1, baseline, current, decisions: [...decisions] });
          memory.set(name, raw);
          storage?.setItem(name, raw);
        } else {
          memory.delete(name);
          storage?.removeItem(name);
        }
      } catch (error) { failed(error); }
    }
    return { restore, save, get warning() { return warning; } };
  }
  const api = { createReviewStore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaReviewStore = api;
})(typeof window === 'undefined' ? globalThis : window);

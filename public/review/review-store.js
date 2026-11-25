// @ts-check
'use strict';
(function (root) {
  const diff = typeof module !== 'undefined' ? require('../diff-core') : root.DitaDiffCore;
  /** @typedef {import('./review-contracts').StoredReview} StoredReview */
  /** @typedef {import('./review-contracts').ReviewScope} ReviewScope */
  /** @typedef {import('../data-contracts').ReviewDecision} ReviewDecision */
  /** @param {unknown} value @returns {value is StoredReview} */
  function validRecord(value) {
    return !!value && typeof value === 'object' && 'schema' in value && value.schema === 1 &&
      'baseline' in value && typeof value.baseline === 'string' && 'current' in value && typeof value.current === 'string' &&
      'decisions' in value && Array.isArray(value.decisions) && value.decisions.every(entry => Array.isArray(entry) && entry.length === 2 &&
        Number.isInteger(entry[0]) && entry[0] >= 0 && (entry[1] === 'accept' || entry[1] === 'reject'));
  }

  // Baseline positions distinguish identical edits in different paragraphs.
  // New-line numbers are omitted so unrelated insertions do not reopen a decision.
  /** @param {string} baseline @param {string} current */
  function changeKeys(baseline, current) {
    let offset = 0;
    return diff.groupDiffRows(diff.lineDiff(baseline, current), 0).map(group => {
      const start = offset;
      offset += group.rows.filter(row => row.type !== 'new').length;
      return group.type === 'changed' ? JSON.stringify([start, group.rows.map(row => [row.type, row.text])]) : null;
    });
  }

  /** @param {import('./review-contracts').ReviewStorage | null | undefined} storage
   * @returns {import('./review-contracts').ReviewProgress} */
  function createReviewStore(storage) {
    /** @type {Map<string, string | null>} */
    const memory = new Map();
    /** @type {Map<string, string | null>} */
    const observed = new Map();
    let warning = storage ? '' : '审阅进度暂时仅保存在本页，浏览器存储不可用。';
    /** @param {ReviewScope} scope @param {{path: string}} file */
    const key = (scope, file) => 'dita.review.v1:' + JSON.stringify([scope.root, scope.currentBranch, file.path]);
    /** @param {unknown} error */
    function failed(error) {
      warning = '审阅进度暂时仅保存在本页，浏览器存储不可用。';
      console.warn('审阅进度存储失败', error);
    }
    /** @param {ReviewScope} scope @param {{path: string}} file */
    function isCurrent(scope, file) {
      const name = key(scope, file);
      if (!storage || !observed.has(name)) return true;
      try { return storage.getItem(name) === observed.get(name); }
      catch (error) { failed(error); return true; }
    }
    /** @param {ReviewScope} scope @param {Pick<import('../data-contracts').DocumentState, 'path' | 'baseline' | 'current'>} file
     * @returns {import('./review-contracts').ReviewSnapshot} */
    function restore(scope, file) {
      /** @returns {import('./review-contracts').ReviewSnapshot} */
      const empty = () => ({ baseline: file.baseline, current: file.current, decisions: new Map() });
      if (!scope.root) return empty();
      const name = key(scope, file);
      try {
        const shared = storage?.getItem(name) ?? null;
        if (observed.has(name) && shared !== observed.get(name)) memory.delete(name);
        observed.set(name, shared);
      } catch (error) { failed(error); }
      try {
        const raw = memory.has(name) ? memory.get(name) : observed.get(name);
        if (!raw) return empty();
        const saved = /** @type {unknown} */ (JSON.parse(raw));
        if (!validRecord(saved) || saved.baseline !== file.baseline) return empty();
        const decisions = new Map(saved.decisions);
        if (diff.applyDiffGroups(saved.baseline, saved.current, decisions, 0, 'accept') === file.current) {
          return { baseline: saved.baseline, current: saved.current, decisions };
        }
        const accepted = new Set(changeKeys(saved.baseline, saved.current)
          .filter((value, index) => value && decisions.get(index) === 'accept'));
        /** @type {Map<number, ReviewDecision>} */
        const rebased = new Map();
        changeKeys(file.baseline, file.current).forEach((value, index) => {
          if (value && accepted.has(value)) rebased.set(index, 'accept');
        });
        return { baseline: file.baseline, current: file.current, decisions: rebased };
      } catch (error) { failed(error); return empty(); }
    }
    /** @param {ReviewScope} scope @param {{path: string}} file @param {string} baseline @param {string} current
     * @param {ReadonlyMap<number, ReviewDecision>} decisions */
    function save(scope, file, baseline, current, decisions) {
      if (!scope.root) return;
      if (!isCurrent(scope, file)) {
        warning = '另一窗口已更新审阅进度，请重新核对后操作。';
        return;
      }
      const name = key(scope, file);
      const raw = decisions.size ? JSON.stringify({ schema: 1, baseline, current, decisions: [...decisions] }) : null;
      try {
        if (storage) {
          if (raw !== null) storage.setItem(name, raw); else storage.removeItem(name);
          observed.set(name, raw); memory.delete(name); warning = '';
        } else memory.set(name, raw);
      } catch (error) {
        if (!observed.has(name)) {
          try { observed.set(name, storage?.getItem(name) ?? null); }
          catch { /* The local backup still works when reads fail too. */ }
        }
        memory.set(name, raw); failed(error);
      }
    }
    /** @param {ReviewScope} scope @param {Pick<import('../data-contracts').DocumentState, 'path' | 'baseline' | 'current'>} file
     * @param {string} previous */
    function rebaseEdit(scope, file, previous) {
      if (!scope.root || previous === file.current || !isCurrent(scope, file)) return;
      const name = key(scope, file);
      if (observed.has(name) && !(memory.has(name) ? memory.get(name) : observed.get(name))) return;
      const before = restore(scope, { ...file, current: previous });
      if (!before.decisions.size) return;
      if (file.current === file.baseline) {
        save(scope, file, file.baseline, file.current, new Map());
        return;
      }
      const after = restore(scope, file);
      if (after.decisions.size < before.decisions.size) save(scope, file, after.baseline, after.current, after.decisions);
    }
    return { restore, save, isCurrent, rebaseEdit, get warning() { return warning; } };
  }
  const api = { createReviewStore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaReviewStore = api;
})(typeof window === 'undefined' ? globalThis : window);

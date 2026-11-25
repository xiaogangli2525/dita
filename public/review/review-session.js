// @ts-check
'use strict';
(function (root) {
  const diff = typeof module !== 'undefined' ? require('../diff-core') : root.DitaDiffCore;
  /** @typedef {import('./review-contracts').ReviewFrame} ReviewFrame */
  /** @typedef {import('../data-contracts').DocumentState} DocumentState */
  /** @typedef {import('../data-contracts').ReviewDecision} ReviewDecision */
  /** @typedef {import('../data-contracts').ReviewKey} ReviewKey */
  /** @param {import('./review-contracts').ReviewUIState} state */
  function clearReviewState(state) {
    state.reviewGroups = new Map(); state.reviewDecisions = new Map();
    state.reviewPath = ''; state.reviewBaseline = ''; state.reviewCurrent = '';
  }
  /** @param {{state: import('./review-contracts').ReviewState, progress: import('./review-contracts').ReviewProgress}} ports */
  function createReviewSession({ state, progress }) {
    /** @type {WeakMap<DocumentState, import('./review-contracts').ReviewSnapshot & {scope: string}>} */
    const manual = new WeakMap();
    const scopeKey = () => JSON.stringify([state.root, state.currentBranch]);
    let topicScope = '';
    /** @param {DocumentState | null | undefined} file */
    function resetTopic(file) {
      clearReviewState(state); topicScope = scopeKey();
      if (!file) return;
      const saved = progress.restore(state, file);
      state.reviewPath = file.path; state.reviewBaseline = saved.baseline; state.reviewCurrent = saved.current;
      state.reviewDecisions = new Map(saved.decisions);
    }
    /** @param {DocumentState} file @param {boolean} inManual @returns {ReviewFrame} */
    function frame(file, inManual) {
      const saved = manual.get(file);
      return Object.freeze({ file, inManual, rootPath: state.activePath, root: state.root, branch: state.currentBranch,
        baseline: inManual ? saved?.baseline ?? file.baseline : state.reviewBaseline,
        current: inManual ? saved?.current ?? file.current : state.reviewCurrent,
        keyFor: inManual ? (/** @type {number} */ index) => `${file.path}::${index}` : (/** @type {number} */ index) => index });
    }
    /** @param {Pick<ReviewFrame, 'file' | 'inManual'>} target @param {ReadonlyMap<ReviewKey, ReviewDecision>} [source] */
    function decisionsFor(target, source = state.reviewDecisions) {
      /** @type {Map<number, ReviewDecision>} */
      const decisions = new Map();
      const prefix = target.file.path + '::';
      for (const [key, decision] of source) {
        const index = target.inManual ? typeof key === 'string' && key.startsWith(prefix) ? Number(key.slice(prefix.length)) : NaN : key;
        if (typeof index === 'number' && Number.isInteger(index) && index >= 0) decisions.set(index, decision);
      }
      return decisions;
    }
    /** @param {DocumentState | null | undefined} file @param {boolean} inManual */
    function canReuse(file, inManual) {
      if (!file || (inManual ? manual.get(file)?.scope !== scopeKey() : state.reviewPath !== file.path || topicScope !== scopeKey())) return false;
      const target = frame(file, inManual);
      return progress.isCurrent(state, file) && target.baseline === file.baseline && (target.current === file.current ||
        diff.applyDiffGroups(target.baseline, target.current, decisionsFor(target), 0, 'accept') === file.current);
    }
    /** @param {readonly DocumentState[]} files @param {boolean} force */
    function prepareManual(files, force) {
      state.reviewGroups = new Map();
      for (const file of files) if (force || !canReuse(file, true)) {
        const saved = progress.restore(state, file); manual.set(file, { ...saved, scope: scopeKey() });
        for (const key of state.reviewDecisions.keys()) if (typeof key === 'string' && key.startsWith(file.path + '::')) state.reviewDecisions.delete(key);
        for (const [index, decision] of saved.decisions) state.reviewDecisions.set(`${file.path}::${index}`, decision);
      }
    }
    /** @param {ReviewFrame} target @param {number} [context] @returns {import('./review-contracts').DiffGroup[]} */
    function groups(target, context = 3) {
      return target.baseline === target.current ? [] : diff.groupDiffRows(diff.lineDiff(target.baseline, target.current), context);
    }
    /** @param {ReviewFrame} target @param {number} index @param {import('./review-contracts').DiffGroup} group */
    function registerGroup(target, index, group) {
      const key = target.keyFor(index);
      state.reviewGroups.set(key, target.inManual ? { ...group, topicPath: target.file.path } : group);
      return { key, number: target.inManual ? index + 1 : state.reviewGroups.size, decision: state.reviewDecisions.get(key) };
    }
    /** @param {ReviewFrame} target */
    function isCurrent(target) {
      const latest = frame(target.file, target.inManual);
      return state.root === target.root && state.currentBranch === target.branch && state.activePath === target.rootPath &&
        state.filesMap.get(target.file.path) === target.file && latest.baseline === target.baseline && latest.current === target.current &&
        canReuse(target.file, target.inManual);
    }
    /** @typedef {ReadonlyMap<number, ReviewDecision | null>} ReviewUpdates */
    /** @typedef {(file: DocumentState, content: string) => void} ValidateCandidate */
    /** @param {ReadonlyMap<ReviewFrame,ReviewUpdates>} batch
     * @param {import('./review-contracts').ReviewWriter} write @param {ValidateCandidate} [validate] */
    function decideBatch(batch, write, validate) {
      let decisions = state.reviewDecisions;
      const prepared = [];
      // Build and validate every result before touching a buffer or its history.
      for (const [target, updates] of batch) {
        if (!isCurrent(target)) throw new Error('原文已变化，请重新核对所选变更块。');
        if (!updates.size) continue;
        const changed = groups(target, 0), before = new Map(decisions), after = new Map(before);
        for (const [index, decision] of updates) {
          if (!Number.isInteger(index) || changed[index]?.type !== 'changed' || decision !== null && decision !== 'accept' && decision !== 'reject') throw new Error('审阅决定或变更块无效。');
          const key = target.keyFor(index);
          if (decision === null) after.delete(key); else after.set(key, decision);
        }
        const content = diff.applyDiffGroups(target.baseline, target.current, decisionsFor(target, after), 0, 'accept');
        validate?.(target.file, content);
        prepared.push({ target, content, before, after });
        decisions = after;
      }
      let written = false;
      for (const { target, content, before, after } of prepared) {
        const previousContent = target.file.current;
        state.reviewDecisions = after;
        try {
          const historyMeta = { reviewDecisionsBefore: before, reviewDecisionsAfter: new Map(after), reviewInManual: target.inManual,
            reviewSource: { baseline: target.baseline, current: target.current } };
          written = write(target.file, content, { historyMeta }) || written;
          progress.save(state, target.file, target.baseline, target.current, decisionsFor(target, after));
        } catch (error) {
          if (target.file.current === previousContent) state.reviewDecisions = before;
          throw error;
        }
      }
      return written;
    }
    /** @param {ReviewFrame} target @param {ReviewUpdates} updates
     * @param {import('./review-contracts').ReviewWriter} write @param {ValidateCandidate} [validate] */
    function decide(target, updates, write, validate) {
      return decideBatch(new Map([[target, updates]]), write, validate);
    }
    /** Restore only this document's decisions; other Topics may have newer history.
     * @param {ReadonlyMap<ReviewKey, ReviewDecision>} decisions @param {DocumentState} file @param {boolean} [sourceInManual]
     * @param {import('../data-contracts').HistoryMeta['reviewSource']} [source] */
    function restoreDecisions(decisions, file, sourceInManual, source) {
      const inManual = /\.ditamap$/i.test(state.activePath), prefix = file.path + '::';
      const selected = decisionsFor({ file, inManual: sourceInManual ?? inManual }, decisions);
      if (source && source.baseline === file.baseline &&
          diff.applyDiffGroups(source.baseline, source.current, selected, 0, 'accept') === file.current) {
        progress.save(state, file, source.baseline, source.current, selected);
      }
      const next = new Map(state.reviewDecisions);
      for (const key of next.keys()) if (typeof key === 'string' ? key.startsWith(prefix) : state.reviewPath === file.path) next.delete(key);
      for (const [index, decision] of selected) next.set(inManual ? prefix + index : index, decision);
      state.reviewDecisions = next;
    }
    return { resetTopic, frame, decisionsFor, canReuse, prepareManual, groups, registerGroup, isCurrent, decide, decideBatch, restoreDecisions,
      clearGroups: () => { state.reviewGroups = new Map(); },
      /** @param {ReviewKey} key */
      decision: key => state.reviewDecisions.get(key), get groupCount() { return state.reviewGroups.size; } };
  }
  const api = { createReviewSession, clearReviewState };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaReviewSession = api;
})(typeof window === 'undefined' ? globalThis : window);

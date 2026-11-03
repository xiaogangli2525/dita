// @ts-check
'use strict';
(function (root) {
  /** @param {{path:string,content:string,baseline?:string,gitStatus?:string}} input
   * @returns {import('./data-contracts').DocumentState} */
  function createDocument({ path, content, baseline = content, gitStatus = 'unknown' }) {
    if (typeof path !== 'string' || !path || typeof content !== 'string' || typeof baseline !== 'string') throw new TypeError('文档路径和内容须为字符串');
    return { path, current: content, disk: content, baseline, gitStatus, dirty: false };
  }
  /** @param {import('./data-contracts').DocumentState} file
   * @returns {import('./data-contracts').DocumentSnapshot} */
  function snapshotDocument(file) {
    return Object.freeze({ path: file.path, current: file.current, disk: file.disk,
      baseline: file.baseline, gitStatus: file.gitStatus, dirty: file.current !== file.disk });
  }
  /** @param {import('./data-contracts').DocumentState} file
   * @returns {import('./data-contracts').DocumentHistory} */
  function historyOf(file) { return file.history || (file.history = { undo: [], redo: [] }); }
  /** @param {import('./data-contracts').DocumentState | null | undefined} file */
  function breakHistoryGroup(file) { if (file?.history) file.history.openGroup = null; }
  /** @param {import('./data-contracts').DocumentState} file
   * @param {string} content
   * @param {{record?:boolean,historyMeta?:import('./data-contracts').HistoryMeta,group?:import('./data-contracts').HistoryGroup}} [options] */
  function editDocument(file, content, { record = true, historyMeta, group } = {}) {
    if (!file || content === file.current && !historyMeta) return false;
    const history = historyOf(file);
    if (record) {
      const previous = history.undo.at(-1);
      const merge = group && history.openGroup === previous && previous?.group?.key === group.key && previous.after === file.current &&
        (group.composition || group.time !== undefined && previous.group.time !== undefined && group.time >= previous.group.time && group.time - previous.group.time <= 900 && previous.group.afterCursor === group.beforeCursor);
      if (merge) { previous.after = content; previous.selectionAfter = historyMeta?.selectionAfter; previous.group = group; }
      else history.undo.push({ before: file.current, after: content, ...(historyMeta || {}), ...(group ? { group } : {}) });
      const cancelled = merge && previous.before === content;
      if (cancelled) history.undo.pop();
      history.openGroup = group && !cancelled ? history.undo.at(-1) : null;
      if (history.undo.length > 100) history.undo.shift();
      history.redo.length = 0;
    }
    file.current = content;
    file.dirty = content !== file.disk;
    if (file.gitStatus === 'unknown') file.gitStatus = 'modified';
    return true;
  }
  /** @param {import('./data-contracts').DocumentState} file
   * @param {'undo'|'redo'} direction */
  function travelHistory(file, direction) {
    breakHistoryGroup(file);
    const history = historyOf(file);
    const entry = history[direction].pop();
    if (!entry) return null;
    history[direction === 'undo' ? 'redo' : 'undo'].push(entry);
    file.current = direction === 'undo' ? entry.before : entry.after;
    file.dirty = file.current !== file.disk;
    return entry;
  }
  /** Advance the acknowledged disk base without bypassing editor history.
   * @param {import('./data-contracts').DocumentState} file
   * @param {import('./data-contracts').SaveAcknowledgement} result
   * @param {boolean} replaceWorking */
  function acknowledgeSave(file, result, replaceWorking) {
    if (!result || typeof result.content !== 'string' || result.path !== undefined && result.path !== file.path || result.created !== undefined && typeof result.created !== 'boolean') throw TypeError('保存响应与文档不匹配');
    if (replaceWorking) file.current = result.content;
    file.disk = result.content; file.dirty = file.current !== file.disk;
    file.gitStatus = result.created ? 'untracked' : 'modified';
  }
  // Save acknowledgements advance disk, never a newer working buffer.
  /** @param {(request:import('./data-contracts').SaveRequest)=>Promise<import('./data-contracts').SaveAcknowledgement>} send */
  function createSaveCoordinator(send) {
    /** @type {WeakMap<import('./data-contracts').DocumentState,Promise<import('./data-contracts').SaveResult>>} */
    const pending = new WeakMap();
    /** @param {import('./data-contracts').DocumentState} file
     * @param {import('./data-contracts').SaveRequest} [submitted] */
    return function save(file, submitted) {
      breakHistoryGroup(file);
      const existing = pending.get(file); if (existing) return existing;
      const snapshot = Object.freeze({ ...(submitted || { path: file.path, content: file.current, expectedContent: file.disk }) });
      if (snapshot.path !== file.path || typeof snapshot.content !== 'string' || typeof snapshot.expectedContent !== 'string') return Promise.reject(new TypeError('保存请求与文档不匹配'));
      const operation = Promise.resolve().then(() => send(snapshot)).then(result => {
        acknowledgeSave(file, result, file.current === snapshot.content);
        return { ...result, clean: !file.dirty };
      }).finally(() => pending.delete(file));
      pending.set(file, operation);
      return operation;
    };
  }

  // Provider-independent boundary for future AI edits. A proposal has no write
  // capability and must be accepted against the exact document it was based on.
  /** @param {{file:import('./data-contracts').DocumentState | undefined,workspaceToken:string,content:string,instruction?:string}} input
   * @param {(xml:string)=>unknown} validate
   * @returns {import('./data-contracts').PendingProposal} */
  function createProposal({ file, workspaceToken, content, instruction = '' }, validate) {
    if (!file || !workspaceToken) throw new Error('请先打开工作区和文档');
    validate(content);
    return Object.freeze({ path: file.path, workspaceToken, before: file.current,
      after: content, instruction, status: 'pending' });
  }
  /** @param {import('./data-contracts').Proposal} proposal
   * @param {{file:import('./data-contracts').DocumentState | undefined,workspaceToken:string}} target
   * @param {(xml:string)=>unknown} validate
   * @param {(file:import('./data-contracts').DocumentState,xml:string)=>unknown} commit
   * @returns {import('./data-contracts').AppliedProposal} */
  function applyProposal(proposal, { file, workspaceToken }, validate, commit) {
    if (proposal.status !== 'pending' || !file || proposal.workspaceToken !== workspaceToken ||
        proposal.path !== file.path || proposal.before !== file.current) {
      throw new Error('文档已变化，请基于最新内容重新生成修改提案');
    }
    validate(proposal.after);
    commit(file, proposal.after); // Reuses the editor's undo history; never saves.
    return Object.freeze({ ...proposal, status: 'applied' });
  }
  const api = { createDocument, snapshotDocument, editDocument, travelHistory, historyOf, breakHistoryGroup, createSaveCoordinator, acknowledgeSave, createProposal, applyProposal };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DitaDocumentStore = api;
})(typeof window === 'undefined' ? globalThis : window);

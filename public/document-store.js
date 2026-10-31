'use strict';
(function (root) {
  function historyOf(file) { return file.history || (file.history = { undo: [], redo: [] }); }
  function editDocument(file, content, { record = true, historyMeta } = {}) {
    if (!file || content === file.current && !historyMeta) return false;
    const history = historyOf(file);
    if (record) {
      history.undo.push({ before: file.current, after: content, ...(historyMeta || {}) });
      if (history.undo.length > 100) history.undo.shift();
      history.redo.length = 0;
    }
    file.current = content;
    file.dirty = content !== file.disk;
    return true;
  }
  function travelHistory(file, direction) {
    const history = historyOf(file);
    const entry = history[direction].pop();
    if (!entry) return null;
    history[direction === 'undo' ? 'redo' : 'undo'].push(entry);
    file.current = direction === 'undo' ? entry.before : entry.after;
    file.dirty = file.current !== file.disk;
    return entry;
  }
  // Save acknowledgements advance disk, never a newer working buffer.
  function createSaveCoordinator(send) {
    const pending = new WeakMap();
    return function save(file, submitted) {
      if (pending.has(file)) return pending.get(file);
      const snapshot = submitted || { path: file.path, content: file.current, expectedContent: file.disk };
      const operation = Promise.resolve().then(() => send(snapshot)).then(result => {
        if (file.current === snapshot.content) file.current = result.content;
        file.disk = result.content;
        file.dirty = file.current !== file.disk;
        file.gitStatus = 'modified';
        return { ...result, clean: !file.dirty };
      }).finally(() => pending.delete(file));
      pending.set(file, operation);
      return operation;
    };
  }

  // Provider-independent boundary for future AI edits. A proposal has no write
  // capability and must be accepted against the exact document it was based on.
  function createProposal({ file, workspaceToken, content, instruction = '' }, validate) {
    if (!file || !workspaceToken) throw new Error('请先打开工作区和文档');
    validate(content);
    return Object.freeze({ path: file.path, workspaceToken, before: file.current,
      after: content, instruction, status: 'pending' });
  }
  function applyProposal(proposal, { file, workspaceToken }, validate, commit) {
    if (proposal.status !== 'pending' || !file || proposal.workspaceToken !== workspaceToken ||
        proposal.path !== file.path || proposal.before !== file.current) {
      throw new Error('文档已变化，请基于最新内容重新生成修改提案');
    }
    validate(proposal.after);
    commit(file, proposal.after); // Reuses the editor's undo history; never saves.
    return Object.freeze({ ...proposal, status: 'applied' });
  }
  const api = { editDocument, travelHistory, historyOf, createSaveCoordinator, createProposal, applyProposal };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DitaDocumentStore = api;
})(typeof window === 'undefined' ? globalThis : window);

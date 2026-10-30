'use strict';
(function (root) {
  // Save acknowledgements advance disk, never a newer working buffer.
  function createSaveCoordinator(send) {
    const pending = new WeakMap();
    return function save(file) {
      if (pending.has(file)) return pending.get(file);
      const snapshot = { path: file.path, content: file.current, expectedContent: file.disk };
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
  const api = { createSaveCoordinator, createProposal, applyProposal };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DitaDocumentStore = api;
})(typeof window === 'undefined' ? globalThis : window);

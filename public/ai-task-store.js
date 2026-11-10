'use strict';
(function (root) {
  const core = typeof module !== 'undefined' ? require('./ai-edit-core') : root.DitaAiEditCore;
  const conversations = typeof module !== 'undefined' ? require('./ai-conversation') : root.DitaAiConversation;
  const limit = 1000000;
  const text = (value, size) => typeof value === 'string' && value.length <= size;
  const relative = value => text(value, 512) && value && !value.includes('\\') && !value.split('/').some(part => !part || part === '.' || part === '..');
  const invalid = () => { throw Error('AI 任务备份格式无效'); };
  function normalize(value, identity) {
    if (!value || !text(identity.root, 4000) || !identity.root || !text(identity.branch, 512) || !relative(identity.path) ||
        !relative(value.filePath) || !['selection', 'topic', 'manual'].includes(value.scope) ||
        !text(value.reply, 6000) || !text(value.search, 200) || !text(value.model, 100) ||
        !Array.isArray(value.transcript) || value.transcript.length > 24) invalid();
    let target = null, scope = null, history = null;
    if (value.target) {
      const item = value.target;
      if (!relative(item.path) || !text(item.source, core.LIMITS.source) || !['range', 'document'].includes(item.kind) ||
          !text(item.query || '', 200)) invalid();
      scope = item.kind === 'document' ? core.documentTarget(item.source, item.query || '') : core.target(item.source, item.start, item.end);
      target = { path: item.path, source: scope.source, start: scope.start, end: scope.end, kind: item.kind, query: item.query || '' };
      history = conversations.validate(scope, value.history);
    } else if (value.history || value.proposal) invalid();
    if (typeof value.proposal !== 'boolean' || value.proposal && !history?.previousResult?.edits.length) invalid();
    const transcript = value.transcript.map(item => {
      if (item?.kind === 'applied' && text(item.text, 500)) return { kind: 'applied', text: item.text };
      if (item?.kind !== 'turn' || !text(item.instruction, 6000) || !text(item.summary, 4000) ||
          !Array.isArray(item.questions) || item.questions.length > 12 || item.questions.some(question => !text(question, 1500)) ||
          !text(item.blockedReason || '', 2000)) invalid();
      return { kind: 'turn', instruction: item.instruction, summary: item.summary, questions: [...item.questions], blockedReason: item.blockedReason || '' };
    });
    let manual = null;
    if (value.manual) {
      if (!relative(value.manual.path) || value.manual.stamp !== null && !/^[a-f0-9]{64}$/.test(value.manual.stamp)) invalid();
      manual = { path: value.manual.path, stamp: value.manual.stamp };
    }
    const result = { schema: 1, ...identity, filePath: value.filePath, scope: value.scope, reply: value.reply, search: value.search, model: value.model,
      target, history, transcript, proposal: value.proposal, manual, fromScan: value.fromScan === true };
    Object.defineProperty(result, 'selected', { value: scope && { path: target.path, ...scope } });
    return result;
  }
  function fingerprint(snapshot, digest) {
    return digest(JSON.stringify([snapshot.path, snapshot.content, snapshot.project, snapshot.projectContent,
      snapshot.projectError, snapshot.noteRules?.expectedContent, [...snapshot.files].sort(([a], [b]) => a.localeCompare(b)).map(([path, file]) => [path, file.current])]));
  }
  function createTaskStore(storage) {
    const memory = new Map(), damaged = new Set();
    let warning = storage ? '' : 'AI 任务仅保留在本页，浏览器存储不可用。';
    const key = identity => 'dita.ai-task.v1:' + JSON.stringify([identity.root, identity.branch, identity.path]);
    function failed() { warning = 'AI 任务备份不可用或空间不足，当前任务仅保留在本页。'; }
    function load(identity) {
      const name = key(identity);
      try {
        const raw = memory.get(name) || storage?.getItem(name);
        if (!raw) return null;
        if (raw.length > limit) invalid();
        const value = JSON.parse(raw);
        if (value.schema !== 1 || value.root !== identity.root || value.branch !== identity.branch || value.path !== identity.path) invalid();
        return normalize(value, identity);
      } catch { damaged.add(name); warning = 'AI 任务备份无法读取，原始数据已保留；新的任务暂存本页，可点“新任务”清除此文档的旧备份。'; return null; }
    }
    function save(identity, value) {
      const name = key(identity);
      try {
        const raw = JSON.stringify(normalize(value, identity));
        if (raw.length > limit) throw Error('AI 任务过大');
        memory.set(name, raw);
        if (!damaged.has(name)) { storage?.setItem(name, raw); if (storage) warning = ''; }
      } catch { failed(); }
    }
    function remove(identity) {
      const name = key(identity); memory.delete(name);
      try { storage?.removeItem(name); damaged.delete(name); if (storage) warning = ''; }
      catch { failed(); }
    }
    return { load, save, remove, get warning() { return warning; } };
  }
  const api = { createTaskStore, fingerprint };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaAiTaskStore = api;
})(typeof window === 'undefined' ? globalThis : window);

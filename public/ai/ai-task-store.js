// @ts-check
'use strict';
(function (root) {
  /** @typedef {{root: string, branch: string, path: string}} TaskIdentity */
  /** @typedef {import('./ai-contracts').AiTarget} AiTarget */
  /** @typedef {import('./ai-contracts').AiConversation} AiConversation */
  /** @typedef {{path: string, source: string, start: number, end: number, kind: 'range' | 'document', query: string}} StoredTarget */
  const core = typeof module !== 'undefined' ? require('./ai-edit-core') : root.DitaAiEditCore;
  const conversations = typeof module !== 'undefined' ? require('./ai-conversation') : root.DitaAiConversation;
  const limit = 1000000;
  /** @param {unknown} value @returns {value is Record<string, unknown>} */
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  /** @param {unknown} value @param {number} size @returns {value is string} */
  const text = (value, size) => typeof value === 'string' && value.length <= size;
  /** @param {unknown} value @returns {value is string} */
  const relative = value => text(value, 512) && value.length > 0 && !value.includes('\\') && !value.split('/').some(part => !part || part === '.' || part === '..');
  /** @returns {never} */
  function invalid() { throw Error('AI 任务备份格式无效'); }
  /** @param {unknown} value @param {TaskIdentity} identity */
  function normalize(value, identity) {
    if (!isRecord(value) || !text(identity.root, 4000) || !identity.root || !text(identity.branch, 512) || !relative(identity.path) ||
        !relative(value.filePath) || value.scope !== 'selection' && value.scope !== 'topic' && value.scope !== 'manual' ||
        !text(value.reply, 6000) || !text(value.search, 200) || !text(value.model, 100) ||
        !Array.isArray(value.transcript) || value.transcript.length > 24) invalid();
    /** @type {StoredTarget | null} */
    let target = null;
    /** @type {AiTarget | null} */
    let scope = null;
    /** @type {AiConversation | null} */
    let history = null;
    if (value.target) {
      const item = value.target;
      if (!isRecord(item) || !relative(item.path) || !text(item.source, core.LIMITS.source) ||
          item.kind !== 'range' && item.kind !== 'document') invalid();
      const query = item.query || '';
      if (!text(query, 200)) invalid();
      if (item.kind === 'document') scope = core.documentTarget(item.source, query);
      else {
        if (typeof item.start !== 'number' || typeof item.end !== 'number') invalid();
        scope = core.target(item.source, item.start, item.end);
      }
      target = { path: item.path, source: scope.source, start: scope.start, end: scope.end, kind: item.kind, query };
      history = conversations.validate(scope, value.history);
    } else if (value.history || value.proposal) invalid();
    if (typeof value.proposal !== 'boolean' || value.proposal && !history?.previousResult?.edits.length) invalid();
    const transcript = value.transcript.map(/** @param {unknown} item */ item => {
      if (!isRecord(item)) invalid();
      if (item.kind === 'applied' && text(item.text, 500)) return { kind: /** @type {const} */ ('applied'), text: item.text };
      const blockedReason = item.blockedReason || '';
      if (item.kind !== 'turn' || !text(item.instruction, 6000) || !text(item.summary, 4000) ||
          !Array.isArray(item.questions) || item.questions.length > 12 || item.questions.some(question => !text(question, 1500)) ||
          !text(blockedReason, 2000)) invalid();
      return { kind: /** @type {const} */ ('turn'), instruction: item.instruction, summary: item.summary, questions: [...item.questions], blockedReason };
    });
    /** @type {{path: string, stamp: string | null} | null} */
    let manual = null;
    if (value.manual) {
      const item = value.manual;
      if (!isRecord(item) || !relative(item.path) || item.stamp !== null && (typeof item.stamp !== 'string' || !/^[a-f0-9]{64}$/.test(item.stamp))) invalid();
      manual = { path: item.path, stamp: item.stamp };
    }
    const { root: workspaceRoot, branch, path } = identity;
    const result = { schema: 1, root: workspaceRoot, branch, path, filePath: value.filePath, scope: value.scope, reply: value.reply, search: value.search, model: value.model,
      target, history, transcript, proposal: value.proposal, manual, fromScan: value.fromScan === true };
    const selected = scope && target ? { path: target.path, ...scope } : null;
    return /** @type {typeof result & {readonly selected: typeof selected}} */ (Object.defineProperty(result, 'selected', { value: selected }));
  }
  /** @param {import('../data-contracts').ManualSnapshot} snapshot @param {(value: string) => Promise<string>} digest */
  function fingerprint(snapshot, digest) {
    return digest(JSON.stringify([snapshot.path, snapshot.content, snapshot.project, snapshot.projectContent,
      snapshot.projectError, snapshot.noteRules?.expectedContent, [...snapshot.files].sort(([a], [b]) => a.localeCompare(b)).map(([path, file]) => [path, file.current])]));
  }
  /** @param {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined} storage */
  function createTaskStore(storage) {
    /** @type {Map<string, string>} */
    const memory = new Map();
    /** @type {Set<string>} */
    const damaged = new Set();
    let warning = storage ? '' : 'AI 任务仅保留在本页，浏览器存储不可用。';
    /** @param {TaskIdentity} identity */
    const key = identity => 'dita.ai-task.v1:' + JSON.stringify([identity.root, identity.branch, identity.path]);
    function failed() { warning = 'AI 任务备份不可用或空间不足，当前任务仅保留在本页。'; }
    /** @param {TaskIdentity} identity */
    function load(identity) {
      const name = key(identity);
      try {
        const raw = memory.get(name) || storage?.getItem(name);
        if (!raw) return null;
        if (raw.length > limit) invalid();
        /** @type {unknown} */
        const value = JSON.parse(raw);
        if (!isRecord(value) || value.schema !== 1 || value.root !== identity.root || value.branch !== identity.branch || value.path !== identity.path) invalid();
        return normalize(value, identity);
      } catch { damaged.add(name); warning = 'AI 任务备份无法读取，原始数据已保留；新的任务暂存本页，可点“新任务”清除此文档的旧备份。'; return null; }
    }
    /** @param {TaskIdentity} identity @param {unknown} value */
    function save(identity, value) {
      const name = key(identity);
      try {
        const raw = JSON.stringify(normalize(value, identity));
        if (raw.length > limit) throw Error('AI 任务过大');
        memory.set(name, raw);
        if (!damaged.has(name)) { storage?.setItem(name, raw); if (storage) warning = ''; }
      } catch { failed(); }
    }
    /** @param {TaskIdentity} identity */
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

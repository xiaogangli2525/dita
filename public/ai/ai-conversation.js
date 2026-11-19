// @ts-check
'use strict';
(function (root) {
  const core = typeof module !== 'undefined' ? require('./ai-edit-core') : root.DitaAiEditCore;
  const LIMITS = Object.freeze({ turns: 12, instructions: 24000 });
  /** @param {string} message @returns {never} */
  function fail(message) { throw Object.assign(new Error(message), { status: 400 }); }
  /** @param {import('./ai-contracts').AiResult} result */
  function copyResult(result) {
    return Object.freeze({ summary: result.summary, questions: Object.freeze([...result.questions]),
      edits: Object.freeze(result.edits.map(edit => Object.freeze({ id: edit.id, before: edit.before, after: edit.after }))),
      ...(result.blockedReason ? { blockedReason: result.blockedReason } : {}) });
  }
  /** Model context contains all user requirements and the last cumulative draft,
   * not an ever-growing copy of the same XML or a server-side chat session.
   * @param {import('./ai-contracts').AiTarget} scope
   * @param {unknown} value
   * @param {string} [nextInstruction]
   * @returns {import('./ai-contracts').AiConversation} */
  function validate(scope, value = { instructions: [] }, nextInstruction) {
    if (!value || typeof value !== 'object' || !('instructions' in value) || !Array.isArray(value.instructions) || value.instructions.length > LIMITS.turns || value.instructions.some(text => typeof text !== 'string' || !text.trim() || text.length > core.LIMITS.instruction)) fail('AI 对话上下文无效，请开始新任务');
    /** @type {string[]} */
    const instructions = [...value.instructions];
    if (nextInstruction !== undefined) {
      if (typeof nextInstruction !== 'string' || !nextInstruction.trim() || nextInstruction.length > core.LIMITS.instruction) fail('请输入本轮修改要求');
      if (instructions.length >= LIMITS.turns) fail('本次对话已达 12 轮，请先应用需要保留的修改，再开始新任务');
    }
    if (instructions.join('').length + (nextInstruction?.length || 0) > LIMITS.instructions) fail('本次对话内容过长，请先应用需要保留的修改，再开始新任务');
    let previousResult;
    if ('previousResult' in value && value.previousResult !== undefined) {
      previousResult = /** @type {import('./ai-contracts').AiResult} */ (value.previousResult);
      core.applyResult(scope, previousResult);
      previousResult = copyResult(previousResult);
      if (JSON.stringify(previousResult).length > 64000) fail('上一轮提案过长，请缩小修改范围后开始新任务');
    }
    if (!instructions.length && previousResult || instructions.length && !previousResult) fail('AI 对话缺少对应的上一轮结果，请开始新任务');
    return Object.freeze({ instructions: Object.freeze(instructions), ...(previousResult ? { previousResult } : {}) });
  }
  /** @param {import('./ai-contracts').AiTarget} scope @param {import('./ai-contracts').AiConversation} [seed] */
  function create(scope, seed) {
    const initial = validate(scope, seed);
    /** @type {readonly import('./ai-contracts').AiTurn[]} */
    let turns = Object.freeze([]);
    /** @param {string} [nextInstruction] */
    function context(nextInstruction) {
      return validate(scope, { instructions: [...initial.instructions, ...turns.map(turn => turn.instruction)], previousResult: turns.at(-1)?.result || initial.previousResult }, nextInstruction);
    }
    /** @param {string} instruction @param {import('./ai-contracts').AiResult} result */
    function record(instruction, result) {
      context(instruction); core.applyResult(scope, result);
      turns = Object.freeze([...turns, Object.freeze({ instruction, result: copyResult(result) })]);
    }
    return Object.freeze({ context, record, get turns() { return turns; } });
  }
  const api = { LIMITS, validate, create };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaAiConversation = api;
})(typeof window === 'undefined' ? globalThis : window);

// @ts-check
'use strict';
const core = require('../public/ai-edit-core');
const conversationCore = require('../public/ai-conversation');
const writingPolicy = require('./ai-writing-policy');
/** @param {string} message @param {number} [status] */
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const SYSTEM = writingPolicy.text + `\n当前文字接口的输出协议：
输出 JSON 对象 {"summary":"已完成的具体修改或缺少的信息","questions":["尚缺的关键技术信息"],"edits":[{"id":"原片段 ID","before":"该片段原文，逐字一致","after":"修改后的纯文字"}],"blockedReason":"超出当前文字修订范围的具体原因（没有则省略）"}。
每项 edit 对应 document.parts 一个完整文本片段，不能返回 XML/HTML/Markdown 标记。未改变的片段不要返回。新增章节、型号条件、跨段落结构等当前无法完成的操作，直接在 blockedReason 说明限制和可执行路径，不要反复提问或声称已经修改。无须追问时 questions 为空。`;

/** @param {{env?:Record<string,string|undefined>,fetchImpl?:typeof fetch,demoMode?:boolean}} [options] */
function createAiProvider({ env = process.env, fetchImpl = fetch, demoMode = false } = {}) {
  /** @type {URL | undefined} */
  let endpoint;
  let reason = '', active = 0;
  const model = String(env.DITA_AI_MODEL || '').trim(), key = String(env.DITA_AI_API_KEY || '');
  const timeout = Math.max(1000, Math.min(120000, Number(env.DITA_AI_TIMEOUT_MS) || 60000));
  const tokenParameter = env.DITA_AI_TOKEN_PARAMETER || 'max_tokens';
  try {
    if (demoMode) throw Error('演示模式不连接模型；请在本地工作区启动服务后配置 AI。');
    if (!env.DITA_AI_BASE_URL || !model) throw Error('尚未配置模型。请展开“模型连接设置”填写接口、模型名和 Key，或通过服务端环境配置。');
    const base = new URL(env.DITA_AI_BASE_URL);
    if (base.username || base.password || base.search || base.hash || !['https:', 'http:'].includes(base.protocol)) throw Error('模型接口地址无效，请检查服务端配置。');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol === 'http:' && !local && env.DITA_AI_ALLOW_HTTP !== '1') throw Error('模型接口需要 HTTPS；内网 HTTP 接口需显式设置 DITA_AI_ALLOW_HTTP=1。');
    if (!key && !local && env.DITA_AI_NO_AUTH !== '1') throw Error('模型接口尚未配置密钥。无鉴权内网服务需显式设置 DITA_AI_NO_AUTH=1。');
    if (!['max_tokens', 'max_completion_tokens'].includes(tokenParameter)) throw Error('DITA_AI_TOKEN_PARAMETER 配置无效。');
    if (model.length > 150) throw Error('模型名称过长。');
    endpoint = new URL(base.href.replace(/\/$/, '') + '/chat/completions');
  } catch (e) { reason = e instanceof Error && !(e instanceof TypeError) ? e.message : '模型接口地址无效，请检查服务端配置。'; }
  /** @returns {import('../public/ai-contracts').AiConfiguration} */
  function configuration() { return { available: Boolean(endpoint), model: endpoint ? model : '', destination: endpoint ? endpoint.origin : '', message: reason,
    baseUrl: endpoint ? endpoint.href.replace(/\/chat\/completions$/, '') : '', keyConfigured: Boolean(key), rulesVersion: writingPolicy.version }; }
  /** @param {{instruction:string,targetModel?:string,scope:import('../public/ai-contracts').AiTarget,conversation?:import('../public/ai-contracts').AiConversation}} request
   * @param {AbortSignal} [signal]
   * @returns {Promise<import('../public/ai-contracts').AiResult>} */
  async function generate({ instruction, targetModel = '', scope, conversation }, signal) {
    if (!endpoint) throw error(reason, 503);
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > core.LIMITS.instruction || typeof targetModel !== 'string' || targetModel.length > 100) throw error('请输入有效的问题描述和目标型号');
    const history = conversationCore.validate(scope, conversation, instruction);
    if (active >= 2) throw error('已有两个 AI 请求正在处理，请稍后重试', 429);
    const controller = new AbortController(), cancel = () => controller.abort();
    if (signal?.aborted) throw error('AI 请求已取消', 499);
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, timeout); timer.unref?.(); active++;
    try {
      const document = { kind: scope.kind, conditions: scope.conditions, partial: Boolean(scope.truncated), parts: scope.parts.map(({ id, text, conditions, blockKind }) => ({ id, text, ...(conditions ? { conditions } : {}), ...(blockKind ? { blockKind } : {}) })) };
      const body = { model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify({ instruction, targetModel, document, conversation: history }) }],
        [tokenParameter]: 4096, stream: false, ...(env.DITA_AI_JSON_MODE === '0' ? {} : { response_format: { type: 'json_object' } }) };
      const response = await fetchImpl(endpoint.href, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify(body), signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        const message = [401, 403].includes(response.status) ? '模型接口鉴权失败，请检查服务端密钥和权限' : response.status === 429 ? '模型接口繁忙或额度不足，请稍后重试' : '模型接口请求失败，请检查地址、模型及 JSON/输出长度参数兼容性';
        throw error(message + '（HTTP ' + response.status + '）', 502);
      }
      const reader = response.body?.getReader(); if (!reader) throw error('模型接口返回空响应', 502);
      let size = 0; const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > 256000) { await reader.cancel(); throw error('模型响应过大，请缩小修改范围', 502); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      let envelope, result;
      try {
        envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const choice = envelope.choices?.[0];
        if (choice?.finish_reason !== 'stop' || choice.message?.refusal || typeof choice.message?.content !== 'string') throw Error('incomplete');
        result = JSON.parse(choice.message.content);
      } catch { throw error('模型未返回完整的修订 JSON，已保留原文，请重试或调整模型配置', 502); }
      core.applyResult(scope, result); // Validate independently of the provider's JSON mode.
      return result;
    } catch (e) {
      if (controller.signal.aborted) throw error(signal?.aborted ? 'AI 请求已取消' : 'AI 请求超时，请重试或缩小范围', signal?.aborted ? 499 : 504);
      if (e instanceof Error && 'status' in e) throw e;
      // Upstream bodies/errors can contain credentials or document text.
      throw error('无法连接模型服务，请检查服务端地址和网络配置', 502);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); active--; }
  }
  return { configuration, generate };
}
module.exports = { createAiProvider };

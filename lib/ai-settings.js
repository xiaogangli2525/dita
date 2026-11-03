'use strict';
const { createAiProvider } = require('./ai-provider');
// Connection state belongs to the running local service, never browser storage,
// project configuration, document source or an API response.
function createAiSettings({ env = process.env, demoMode = false } = {}) {
  let values = { ...env }, provider = createAiProvider({ env: values, demoMode }), active = 0;
  function configuration() { return { ...provider.configuration(), editable: !demoMode, allowHttp: values.DITA_AI_ALLOW_HTTP === '1', noAuth: values.DITA_AI_NO_AUTH === '1' }; }
  function update(input) {
    const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
    if (demoMode) fail('演示模式不保存模型连接，请在本地工作区配置');
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.baseUrl !== 'string' || input.baseUrl.length > 2000 || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 150 || typeof input.key !== 'string' || input.key.length > 8192 || typeof input.allowHttp !== 'boolean' || typeof input.noAuth !== 'boolean') fail('请填写有效的接口地址、模型名和连接选项');
    // A blank key retains the old one only for the exact same endpoint. Changing
    // destinations must never forward the old provider's secret implicitly.
    const base = input.baseUrl.trim().replace(/\/$/, '');
    const key = input.noAuth ? '' : input.key || (base === String(values.DITA_AI_BASE_URL || '').replace(/\/$/, '') ? values.DITA_AI_API_KEY : '');
    const next = { ...values, DITA_AI_BASE_URL: base, DITA_AI_MODEL: input.model.trim(), DITA_AI_API_KEY: key,
      DITA_AI_ALLOW_HTTP: input.allowHttp ? '1' : '', DITA_AI_NO_AUTH: input.noAuth ? '1' : '' };
    const candidate = createAiProvider({ env: next, demoMode });
    if (!candidate.configuration().available) fail(candidate.configuration().message);
    values = next; provider = candidate;
    return configuration();
  }
  async function generate(...args) {
    if (active >= 2) throw Object.assign(new Error('已有两个 AI 请求正在处理，请稍后重试'), { status: 429 });
    const captured = provider; active++;
    try { return await captured.generate(...args); } finally { active--; }
  }
  return { configuration, update, generate };
}
module.exports = { createAiSettings };

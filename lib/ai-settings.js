'use strict';
const { createAiProvider } = require('./ai-provider');
const { createAiConfigStore } = require('./ai-config-store');
// Credentials are kept in the local server user's private configuration, never
// browser/project storage. The store is injected in tests; demo mode never reads it.
function createAiSettings({ env = process.env, demoMode = false, store = createAiConfigStore(env) } = {}) {
  let values = { ...env }, active = 0, persisted = false, loadError = '';
  function settings(value) {
    return { ...env, DITA_AI_BASE_URL: value.baseUrl, DITA_AI_MODEL: value.model, DITA_AI_API_KEY: value.key,
      DITA_AI_ALLOW_HTTP: value.allowHttp ? '1' : '', DITA_AI_NO_AUTH: value.noAuth ? '1' : '' };
  }
  if (!demoMode) {
    try { const saved = store.load(); if (saved) { values = settings(saved); persisted = true; } }
    catch (error) { loadError = error.message; }
  }
  let provider = createAiProvider({ env: values, demoMode });
  function configuration() { return { ...provider.configuration(), ...(loadError ? { available: false, message: loadError } : {}), editable: !demoMode, persisted, allowHttp: values.DITA_AI_ALLOW_HTTP === '1', noAuth: values.DITA_AI_NO_AUTH === '1' }; }
  function update(input) {
    const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
    if (demoMode) fail('演示模式不保存模型连接，请在本地工作区配置');
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.baseUrl !== 'string' || input.baseUrl.length > 2000 || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 150 || typeof input.key !== 'string' || input.key.length > 8192 || typeof input.allowHttp !== 'boolean' || typeof input.noAuth !== 'boolean') fail('请填写有效的接口地址、模型名和连接选项');
    // A blank key retains the old one only for the exact same endpoint. Changing
    // destinations must never forward the old provider's secret implicitly.
    const base = input.baseUrl.trim().replace(/\/$/, '');
    const key = input.noAuth ? '' : input.key || (base === String(values.DITA_AI_BASE_URL || '').replace(/\/$/, '') ? values.DITA_AI_API_KEY : '');
    const saved = { baseUrl: base, model: input.model.trim(), key: key || '', allowHttp: input.allowHttp, noAuth: input.noAuth };
    const next = settings(saved);
    const candidate = createAiProvider({ env: next, demoMode });
    if (!candidate.configuration().available) fail(candidate.configuration().message);
    store.save(saved);
    values = next; provider = candidate; persisted = true; loadError = '';
    return configuration();
  }
  async function generate(...args) {
    if (loadError) throw Object.assign(new Error(loadError), { status: 503 });
    if (active >= 2) throw Object.assign(new Error('已有两个 AI 请求正在处理，请稍后重试'), { status: 429 });
    const captured = provider; active++;
    try { return await captured.generate(...args); } finally { active--; }
  }
  return { configuration, update, generate };
}
module.exports = { createAiSettings };

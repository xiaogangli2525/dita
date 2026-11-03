'use strict';
const core = require('../public/ai-edit-core');
const { readJson, sendJson } = require('./http-utils');
function createAiHandler({ provider, workspace }) {
  async function json(req) {
    try { return await readJson(req); }
    catch (error) { if (error instanceof SyntaxError) throw Object.assign(new Error('AI 请求 JSON 格式无效'), { status: 400 }); throw error; }
  }
  return async (req, res, pathname) => {
    if (req.method === 'GET' && pathname === '/api/ai/config') { sendJson(res, 200, provider.configuration()); return true; }
    if (req.method === 'PUT' && pathname === '/api/ai/config') { sendJson(res, 200, provider.update(await json(req))); return true; }
    if (req.method !== 'POST' || pathname !== '/api/ai/propose') return false;
    const token = workspace.token, controller = new AbortController();
    const close = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', close);
    try {
      const body = await json(req);
      if (!body || typeof body !== 'object' || typeof body.source !== 'string') throw Object.assign(new Error('AI 请求内容无效'), { status: 400 });
      if (body.targetKind !== undefined && !['document', 'range'].includes(body.targetKind) || body.query !== undefined && (typeof body.query !== 'string' || body.query.length > 200)) throw Object.assign(new Error('AI 修改范围无效'), { status: 400 });
      const scope = body.targetKind === 'document' ? core.documentTarget(body.source, body.query) : core.target(body.source, body.start, body.end);
      const result = await provider.generate({ instruction: body.instruction, targetModel: body.targetModel, scope, conversation: body.conversation }, controller.signal);
      if (token !== workspace.token) { res.setHeader('x-workspace-stale', '1'); throw Object.assign(new Error('工作区已切换，已丢弃旧 AI 请求'), { status: 409 }); }
      if (!res.destroyed) sendJson(res, 200, result);
    } finally { res.off('close', close); }
    return true;
  };
}
module.exports = { createAiHandler };

'use strict';
const { createTemplateStore } = require('./template-store');
const { readJson, sendJson } = require('./http-utils');
function createTemplateHandler({ demoMode = false } = {}) {
  const store = createTemplateStore({ memory: demoMode });
  return async (req, res, pathname) => {
    if (pathname !== '/api/templates') return false;
    if (req.method === 'GET') sendJson(res, 200, await store.list());
    else if (req.method === 'POST') sendJson(res, 201, await store.save(await readJson(req)));
    else sendJson(res, 405, { error: '不支持此模板操作' });
    return true;
  };
}
module.exports = { createTemplateHandler };

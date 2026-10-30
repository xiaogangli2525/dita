'use strict';
(function (root) {
  function createWorkspaceClient(nativeFetch) {
    let token = '';
    let generation = 0;
    function adopt(next) { token = next; generation++; }
    async function request(url, options = {}) {
      const started = generation;
      const headers = new Headers(options.headers || {});
      if (token) headers.set('x-workspace-token', token);
      const response = await nativeFetch(url, { ...options, headers });
      const check = () => {
        if (started !== generation) throw new Error('工作区已切换，已忽略旧请求');
      };
      check();
      // Body decoding is asynchronous too: guard it, not just fetch completion.
      for (const method of ['text', 'json', 'blob']) {
        const read = response[method].bind(response);
        response[method] = async () => { const data = await read(); check(); return data; };
      }
      if (response.status === 409 && response.headers.get('x-workspace-stale') === '1') {
        throw new Error('工作区已在其他窗口切换。请先下载保留未保存内容，再刷新页面。');
      }
      return response;
    }
    async function error(response) {
      const body = await response.text();
      try { return JSON.parse(body).error || body; } catch { return body || `HTTP ${response.status}`; }
    }
    return { request, adopt, error, get token() { return token; } };
  }
  if (typeof module !== 'undefined') module.exports = { createWorkspaceClient };
  else root.DitaWorkspaceClient = createWorkspaceClient(root.fetch.bind(root));
})(typeof window === 'undefined' ? globalThis : window);

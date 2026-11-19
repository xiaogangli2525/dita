// @ts-check
'use strict';
(function (root) {
  /** @param {typeof fetch} nativeFetch */
  function createWorkspaceClient(nativeFetch) {
    let token = '';
    let generation = 0;
    /** @param {string} next */
    function adopt(next) { token = next; generation++; }
    /** @param {string} url @param {RequestInit} [options] */
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
      /** @template T @param {() => Promise<T>} read */
      const guarded = read => async () => { const data = await read(); check(); return data; };
      response.text = guarded(response.text.bind(response));
      response.json = guarded(response.json.bind(response));
      response.blob = guarded(response.blob.bind(response));
      if (response.status === 409 && response.headers.get('x-workspace-stale') === '1') {
        throw new Error('工作区已在其他窗口切换。请先下载保留未保存内容，再刷新页面。');
      }
      return response;
    }
    /** @param {Response} response */
    async function error(response) {
      const body = await response.text();
      try {
        /** @type {unknown} */
        const value = JSON.parse(body);
        if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string' && value.error) return value.error;
      } catch { /* Some endpoints return a plain-text error. */ }
      return body || `HTTP ${response.status}`;
    }
    return { request, adopt, error, get token() { return token; } };
  }
  if (typeof module !== 'undefined') module.exports = { createWorkspaceClient };
  else root.DitaWorkspaceClient = createWorkspaceClient(root.fetch.bind(root));
})(typeof window === 'undefined' ? globalThis : window);

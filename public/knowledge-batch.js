'use strict';
(function (root) {
  function createBatchCapture(A) {
    async function collect(recipe, model, signal) {
      const workspace = A.api.token;
      async function post(endpoint, body) {
        if (signal?.aborted) throw Error('已取消核对');
        const response = await A.api.request('/api/knowledge/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
        if (!response.ok) throw Error(await A.api.error(response)); return response.json();
      }
      const bundle = await post('capture', { ...recipe, model });
      const { snapshot, texts, assets } = root.DitaKnowledgeSourceData.hydrate(bundle);
      function current() {
        if (signal?.aborted || workspace !== A.api.token) return false;
        if (recipe.revision || A.state.root !== snapshot.root) return true;
        for (const [path, text] of texts) { const file = A.state.filesMap.get(path); if (file && (file.dirty || file.current !== text)) return false; }
        return true;
      }
      if (!current()) throw Error('此手册有未保存或变化的编辑内容，请先保存后重新核对');
      const isolated = {
        ditaCore: A.ditaCore, manual: { ...root.DitaManualDomain, capture: async () => snapshot, current,
          verifyRules: async () => { if (!current()) throw Error('编辑内容已变化，请重新核对'); } },
        api: { token: snapshot.workspace, error: A.api.error, async request(url) {
          const parsed = new URL(url, 'http://snapshot.invalid'), path = parsed.searchParams.get('path');
          if (parsed.pathname === '/api/provenance') return Response.json(bundle.provenance);
          if (parsed.pathname === '/api/file' && texts.has(path)) return new Response(texts.get(path));
          if (parsed.pathname === '/api/asset' && assets.has(path)) {
            const bytes = Uint8Array.from(atob(assets.get(path)), char => char.charCodeAt(0));
            return new Response(bytes, { headers: { 'content-type': /\.svg$/i.test(path) ? 'image/svg+xml' : 'image/' + path.split('.').pop() } });
          }
          return Response.json({ error: '发布快照未包含文件：' + path }, { status: 404 });
        } }
      };
      const result = await root.DitaKnowledgeCapture.createCapture(isolated).collect(recipe.path, { model, version: recipe.version, filterPath: recipe.filterPath, prefixes: recipe.prefixes }, signal);
      async function verify() {
        if (!current()) throw Error('编辑内容已变化，请保存后重新核对');
        await post('verify', bundle.receipt);
        if (!current()) throw Error('编辑内容已变化，请重新核对');
      }
      await verify();
      const part = { ...result.part, source: { ...result.part.source, revision: recipe.revision || '', assets: bundle.receipt.files.filter(file => assets.has(file.path)) } };
      return { part, current, verify };
    }
    return { collect };
  }
  root.DitaKnowledgeBatch = { createBatchCapture };
})(window);

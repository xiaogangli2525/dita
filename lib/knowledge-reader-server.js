'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { bookFromPath, flatten } = require('./knowledge-book');
const { sendJson, sendText, readJson } = require('./http-utils');
const { createSearchEngine } = require('../public/knowledge/knowledge-search');
const { renderPage } = require('../public/knowledge/knowledge-reader');
const { assertReadable } = require('../public/knowledge/knowledge-limits');
const vectors = require('../public/knowledge/knowledge-semantic');
const semantic = require('./knowledge-semantic');

async function startReader(input) {
  const source = path.resolve(input);
  if (/\.zip$/i.test(source)) throw Error('请先解压知识库，再用 --kb 指向 docs 目录');
  const directory = (await fs.stat(source)).isDirectory() ? source : path.dirname(source);
  const docs = await fs.realpath(await fs.stat(path.join(directory, 'docs', 'index.html')).then(() => path.join(directory, 'docs'), () => directory));
  const html = bookFromPath(path.join(docs, 'index.html'));
  const book = bookFromPath(path.join(docs, 'knowledge.json'));
  const records = flatten(book);
  const identity = data => JSON.stringify([data.model, data.sdkVersion, flatten(data).map(row => [row.manualId, row.anchor, row.title, row.text])]);
  if (identity(book) !== identity(html)) throw Error('阅读页与知识库正文版本不一致，请重新解压同一份包');
  if (!vectors.compatible(book.semantic)) throw Error('请用附带兼容语义索引的知识库启动阅读器');
  const searchSemantic = semantic.createSearch(records, book.semantic);
  const engine = createSearchEngine(), index = engine.build(records), page = renderPage(html, { localSemantic: true });
  const script = page.slice(page.lastIndexOf('<script>') + '<script>'.length, page.lastIndexOf('</script>'));
  const scriptHash = createHash('sha256').update(script.replace(/\r\n?/g, '\n')).digest('base64');
  const manuals = new Set(book.manuals.map(manual => manual.id).filter(id => /^m-[a-f0-9]{12,64}$/.test(id)));
  let url, searching = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    res.setHeader('x-frame-options', 'DENY');
    try {
      if (!url || req.headers.host !== new URL(url).host) { sendJson(res, 403, { error: '仅支持本机阅读地址' }); return; }
      if (req.method === 'GET' && ['/', '/index.html'].includes(req.url)) {
        res.setHeader('content-security-policy', "script-src 'sha256-" + scriptHash + "'; frame-ancestors 'none'");
        sendText(res, 200, page, 'text/html'); return;
      }
      const download = /^\/manuals\/(m-[a-f0-9]{12,64})\.html$/.exec(req.url || '');
      if (req.method === 'GET' && download && manuals.has(download[1])) {
        const name = download[1] + '.html', file = path.join(docs, 'manuals', name);
        const stat = await fs.lstat(file);
        if (!stat.isFile() || await fs.realpath(file) !== file) { sendJson(res, 404, { error: '手册文件不存在' }); return; }
        assertReadable(stat.size);
        res.setHeader('content-disposition', 'attachment; filename="' + name + '"');
        sendText(res, 200, await fs.readFile(file, 'utf8'), 'text/html'); return;
      }
      if (req.method !== 'POST' || req.url !== '/search') { sendJson(res, 404, { error: '未找到页面' }); return; }
      if (req.headers.origin !== url || req.headers['content-type'] !== 'application/json') { sendJson(res, 403, { error: '请求必须来自本机阅读页' }); return; }
      const { query, manualId = '', module = '', mode = '' } = await readJson(req, 4096) || {};
      if (typeof query !== 'string' || !query.trim() || query.length > 200 ||
          ![manualId, module, mode].every(value => typeof value === 'string' && value.length <= 160) ||
          (manualId && !manuals.has(manualId))) { sendJson(res, 400, { error: '搜索条件无效' }); return; }
      if (searching) { sendJson(res, 429, { error: '上一条语义查询尚未结束，请稍后重试' }); return; }
      searching = true;
      try {
        const lexical = engine.search(records, index, query, manualId, 50, { module, mode });
        const hits = await searchSemantic(query, lexical, { manualId, module, mode, limit: 40 });
        sendJson(res, 200, { hits, searchMode: semantic.requiresLexical(query) ? 'lexical' : 'hybrid' });
      } finally { searching = false; }
    } catch (error) {
      if (!res.headersSent && !res.destroyed) sendJson(res, error.code === 'ENOENT' ? 404 : error.status || (error instanceof SyntaxError ? 400 : 500), { error: error.message });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { url = 'http://127.0.0.1:' + server.address().port; resolve(); });
  });
  return { server, url };
}
module.exports = { startReader };

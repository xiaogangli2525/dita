'use strict';
const fs = require('fs/promises');
const path = require('path');
const { sendJson, sendText, readJson } = require('./http-utils');
const { handleWorkspaceTools } = require('./workspace-tools');
const { handlePdfExport } = require('./pdf-export');
const gitError = (message, status = 400) => Object.assign(new Error(message), { status });

// One identity/origin guard precedes every business route. The supplied
// workspace exposes live getters so all services observe the same root/token.
function createApiHandler({ workspace, git, documents, maps, port, publicOrigin, demoMode = false }) {
  const { checkedResolve, walkFileTree, readXmlFile, writeXmlFile, relativePath, isDitaLike } = documents;
  const { parseXml, childElement, textOf, mapNodeToTree, applyMapOperation } = maps;
  const { runGit, listRepositories, listBranches, gitWorktreeStatus, gitInfo } = git;
  return async function handleApi(req, res, pathname, searchParams) {
    const suppliedToken = req.headers['x-workspace-token'];
    const bootstrap = pathname === '/api/repos' || pathname === '/api/workspace' || pathname === '/api/asset';
    if ((suppliedToken && suppliedToken !== workspace.token) || (!suppliedToken && !bootstrap)) {
      res.setHeader('x-workspace-stale', '1');
      throw gitError('Workspace changed. Reload before continuing.', 409);
    }
    const origin = req.headers.origin;
    const allowed = ['http://127.0.0.1:' + port, 'http://localhost:' + port];
    if (publicOrigin) allowed.push(publicOrigin);
    // The demo contains only disposable sample documents and supports a preview proxy.
    if (demoMode && origin) {
      try { if (new URL(origin).host === req.headers.host) allowed.push(origin); } catch {}
    }
    // Same-origin browser requests (especially GET) often omit the Origin header.
    // Reject only when Origin IS present but does not match (cross-origin CSRF).
    if (origin && !allowed.includes(origin)) {
      sendJson(res, 403, { error: 'Forbidden origin' });
      return;
    }
    if (await handlePdfExport(req, res, pathname, { readJson })) return;
    if (await handleWorkspaceTools(req, res, pathname, searchParams, { root: workspace.root, readJson, sendJson, checkedResolve, readXmlFile, walkFileTree, runGit, gitWorktreeStatus })) return;
    if (req.method === 'GET' && pathname === '/api/repos') {
      const repositories = await listRepositories();
      sendJson(res, 200, { root: workspace.repositoriesRoot, repositories, current: workspace.root });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/branches') {
      const git = await listBranches();
      sendJson(res, 200, { root: workspace.root, current: git.current, branches: git.branches });
      return;
    }

    if (req.method === 'POST' && (pathname === '/api/repository' || pathname === '/api/branch')) {
      const body = await readJson(req);
      if (pathname === '/api/repository') {
        sendJson(res, 200, await workspace.selectRepository(body.repository));
        return;
      }

      await git.switchBranch(body.branch);
      workspace.rotateToken();
      sendJson(res, 200, await workspace.snapshot());
      return;
    }

    if (req.method === 'GET' && pathname === '/api/workspace') {
      sendJson(res, 200, await workspace.snapshot());
      return;
    }

    if (req.method === 'GET' && pathname === '/api/tree') {
      const files = await walkFileTree();
      sendJson(res, 200, { root: workspace.root, tree: files });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/git') {
      const info = await gitInfo(searchParams.get('path'));
      sendJson(res, 200, info || { available: false, status: 'no-git', content: '' });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/attributes') {
      const files = await walkFileTree();
      const attrValues = new Map();
      const PROFILING_ATTRS = ['platform', 'audience', 'product', 'otherprops', 'rev'];
      const collectAttrs = async nodes => {
        for (const node of nodes) {
          if (node.type === 'file' && /\.(dita|xml)$/i.test(node.path)) {
            try {
              const content = await fs.readFile(path.join(workspace.root, node.path), 'utf8');
              for (const attr of PROFILING_ATTRS) {
                const re = new RegExp(attr + '="([^"]*)"', 'g');
                let m;
                while ((m = re.exec(content))) {
                  if (!attrValues.has(attr)) attrValues.set(attr, new Set());
                  m[1].split(/\s+/).forEach(v => { if (v.trim()) attrValues.get(attr).add(v.trim()); });
                }
              }
            } catch (e) { console.warn('api error:', e.message); }
          }
          if (node.children) await collectAttrs(node.children);
        }
      };
      await collectAttrs(files);
      const result = {};
      for (const [attr, values] of attrValues) result[attr] = [...values].sort();
      sendJson(res, 200, { attributes: result });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/asset') {
      const asset = await checkedResolve(searchParams.get('path'));
      const stat = await fs.stat(asset);
      if (!stat.isFile()) throw Object.assign(new Error('Asset not found'), { status: 404 });
      const ext = path.extname(asset).toLowerCase();
      const allowedExts = ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
      if (!allowedExts.includes(ext)) throw Object.assign(new Error('Unsupported asset type'), { status: 403 });
      const type = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.bmp' ? 'image/bmp' : ext === '.webp' ? 'image/webp' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" });
      res.end(await fs.readFile(asset));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/map/resolve') {
      const body = await readJson(req);
      const file = await checkedResolve(body.path);
      if (!/\.ditamap$/i.test(file)) throw gitError('Not a DITA map');
      const parsed = parseXml(String(body.content ?? ''));
      if (!['map', 'bookmap'].includes(parsed.root.name)) throw gitError('Not a DITA map');
      sendJson(res, 200, { path: body.path, name: path.basename(file),
        title: textOf(childElement(childElement(parsed.root, 'booktitle'), 'mainbooktitle')).trim() || textOf(childElement(parsed.root, 'title')).trim() || path.basename(file),
        children: mapNodeToTree(parsed.root, body.path) });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/map/operation') {
      const body = await readJson(req);
      const mapFile = await checkedResolve(body.path);
      const stat = await fs.stat(mapFile);
      if (!stat.isFile() || !/\.ditamap$/i.test(mapFile)) throw Object.assign(new Error('Not a DITA map file'), { status: 404 });
      const content = body.content == null ? await readXmlFile(mapFile) : String(body.content);
      const result = await applyMapOperation(content, relativePath(mapFile), {
        operation: body.operation,
        sourcePath: body.sourcePath,
        href: body.href,
        title: body.title
      });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/file') {
      const file = await checkedResolve(searchParams.get('path'));
      const stat = await fs.stat(file);
      if (!stat.isFile() || !isDitaLike(file)) throw Object.assign(new Error('Not a DITA/XML file'), { status: 404 });
      sendText(res, 200, await readXmlFile(file), 'application/xml');
      return;
    }

    // Save As creates a new DITA/XML document in the configured workspace.  The
    // client can opt into replacing an existing file after confirming with the
    // user; by default an existing path is rejected to prevent accidental data
    // loss.
    if (req.method === 'POST' && pathname === '/api/file') {
      const body = await readJson(req);
      const requestedPath = String(body.path || '').replace(/\\/g, '/');
      if (!isDitaLike(requestedPath)) {
        throw Object.assign(new Error('Save As path must end with .dita, .ditamap, or .xml'), { status: 400 });
      }
      const file = await checkedResolve(requestedPath, { create: true });
      const parent = await fs.stat(path.dirname(file)).catch(() => null);
      if (!parent?.isDirectory()) {
        throw Object.assign(new Error('Save As directory does not exist'), { status: 400 });
      }
      const existing = await fs.stat(file).catch(() => null);
      if (existing?.isDirectory()) {
        throw Object.assign(new Error('Save As target is a directory'), { status: 400 });
      }
      if (existing?.isFile() && body.overwrite !== true) {
        throw Object.assign(new Error('File already exists'), { status: 409 });
      }
      const content = String(body.content ?? '');
      const parsed = parseXml(content);
      if (!parsed.root) throw Object.assign(new Error('XML has no root element'), { status: 400 });
      if (existing?.isFile() && (typeof body.expectedContent !== 'string' || body.expectedContent !== await readXmlFile(file))) {
        throw gitError('File changed since it was read. Reopen before overwriting.', 409);
      }
      await writeXmlFile(file, content, { createOnly: !existing });
      const saved = await readXmlFile(file);
      sendJson(res, 201, { saved: true, created: !existing, path: relativePath(file), content: saved });
      return;
    }

    if (req.method === 'PUT' && pathname === '/api/file') {
      const body = await readJson(req);
      const file = await checkedResolve(body.path);
      const stat = await fs.stat(file);
      if (!stat.isFile() || !isDitaLike(file)) throw Object.assign(new Error('Not a DITA/XML file'), { status: 404 });
      const content = String(body.content ?? '');
      const parsed = parseXml(content);
      if (!parsed.root) throw Object.assign(new Error('XML has no root element'), { status: 400 });
      if (typeof body.expectedContent !== 'string' || body.expectedContent !== await readXmlFile(file)) {
        throw gitError('文件已在磁盘上变化。请下载保留当前修改，再重新打开文件进行比较。', 409);
      }
      await writeXmlFile(file, content);
      const saved = await readXmlFile(file);
      sendJson(res, 200, { saved: true, content: saved });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}
module.exports = { createApiHandler };

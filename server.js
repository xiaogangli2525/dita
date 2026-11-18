'use strict';

const http = require('http');
const path = require('path');
const referencePaths = require('./public/reference-paths');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');
const { createWorkspaceLock } = require('./lib/workspace-lock');
const workspaceLock = createWorkspaceLock();
const { createGitService } = require('./lib/git-service');
const { createRemoteRepositories } = require('./lib/remote-repositories');
const { createApiHandler } = require('./lib/api-router');
const { sendJson, sendText } = require('./lib/http-utils');
let workspaceToken = randomUUID();

const PORT = Number(process.env.PORT || 5050);
const HOST = process.env.HOST || '127.0.0.1';
const knowledgeReads = new Set(['/api/knowledge/catalog', '/api/knowledge/capture', '/api/knowledge/verify']);
let DOCS_ROOT = path.resolve(process.env.DOCS_ROOT || path.join(__dirname, '..', 'repo_ml353a'));
const DEFAULT_DOCS_ROOT = DOCS_ROOT;
const REPOSITORIES_ROOT = path.resolve(process.env.REPOSITORIES_ROOT || path.dirname(DEFAULT_DOCS_ROOT));
const PUBLIC_ROOT = path.join(__dirname, 'public');

function safeResolve(relativePath) {
  const clean = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('\0')) {
    throw Object.assign(new Error('Invalid path'), { status: 400 });
  }
  const resolved = path.resolve(DOCS_ROOT, clean);
  const rootWithSep = DOCS_ROOT.endsWith(path.sep) ? DOCS_ROOT : DOCS_ROOT + path.sep;
  if (resolved !== DOCS_ROOT && !resolved.startsWith(rootWithSep)) {
    throw Object.assign(new Error('Path escapes the configured DITA root'), { status: 403 });
  }
  return resolved;
}

function relativePath(absolutePath) {
  return path.relative(DOCS_ROOT, absolutePath).replace(/\\/g, '/');
}

const { readXmlFile, writeXmlFile, resolveWorkspacePath } = require('./lib/document-files');
const { createDocumentBatch } = require('./lib/document-batch');
const documentBatch = createDocumentBatch();
async function checkedResolve(relative, options) {
  safeResolve(relative);
  return resolveWorkspacePath(DOCS_ROOT, relative, options);
}

const git = createGitService({ getRoot: () => DOCS_ROOT, repositoriesRoot: REPOSITORIES_ROOT, checkedResolve });
const remoteRepositories = createRemoteRepositories({ getRoot: () => DOCS_ROOT, repositoriesRoot: REPOSITORIES_ROOT, runGit: git.runGit });
const { gitInfo, listRepositories, listBranches, gitWorktreeStatus, resolveSelectedRepository } = git;

const { createMapReader, resolveMapHref: resolveHref } = require('./lib/map-reader');
const { editMap } = require('./lib/map-operations');

function isDitaLike(fileName) {
  return /\.(dita|ditamap|xml)$/i.test(fileName);

}
const { decodeEntities, parseXml, serializeXmlNode, serializeXmlDocument, elementChildren, childElement, textOf } = require('./lib/xml-tree');

async function walkFileTree(current = '') {
  const entries = await fs.readdir(path.join(DOCS_ROOT, current), { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, 'en', { numeric: true });
  });
  const result = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.isSymbolicLink()) continue;
    const relative = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const children = await walkFileTree(relative);
      if (children.length) result.push({ type: 'directory', path: relative, name: entry.name, children });
    } else if (isDitaLike(entry.name)) {
      result.push({ type: 'file', path: relative, name: entry.name });
    }
  }
  return result;
}

const mapReader = createMapReader();
const mapRefTitle = mapReader.title, mapNodeToTree = mapReader.children;

async function validateTopicHref(mapPath, requestHref, dependencies = {}) {
  if (dependencies.resolveTopicHref) return dependencies.resolveTopicHref(mapPath, requestHref);
  const clean = String(requestHref || '').replace(/\\/g, '/');
  const resolved = referencePaths.resolve(mapPath, clean);
  if (!resolved || resolved.self) throw Object.assign(new Error('Topic path must be relative to the current Map'), { status: 400 });
  const target = await checkedResolve(resolved.path);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile() || !isDitaLike(target)) throw Object.assign(new Error('Topic file not found'), { status: 404 });
  const mapDirectory = path.dirname(safeResolve(mapPath));
  const relative = path.relative(mapDirectory, target).replace(/\\/g, '/');
  if (relative === '..' || relative.startsWith('../')) throw Object.assign(new Error('Topic path escapes the map directory'), { status: 400 });
  return relative.split('/').map(encodeURIComponent).join('/') + resolved.suffix;
}

async function applyMapOperation(content, mapPath, request, dependencies = {}) {
  const result = await editMap(content, request, href => validateTopicHref(mapPath, href, dependencies));
  const parsed = parseXml(result.content);
  return {
    original: content,
    ...result,
    map: {
      path: mapPath,
      name: path.basename(mapPath),
      title: textOf(childElement(childElement(parsed.root, 'booktitle'), 'mainbooktitle')).trim() || textOf(childElement(parsed.root, 'title')).trim() || path.basename(mapPath),
      children: mapNodeToTree(parsed.root, mapPath)
    }
  };
}


async function buildMapTrees(files) {
  const maps = [];
  async function collect(nodes) {
    for (const node of nodes) {
      if (node.type === 'directory') await collect(node.children);
      else if (/\.ditamap$/i.test(node.path)) maps.push(node.path);
    }
  }
  await collect(files);
  const trees = [];
  for (const mapPath of maps) {
    try {
      const text = await readXmlFile(await checkedResolve(mapPath));
      const parsed = parseXml(text);
      trees.push({
        path: mapPath,
        name: path.basename(mapPath),
        title: textOf(childElement(childElement(parsed.root, 'booktitle'), 'mainbooktitle')).trim() || textOf(childElement(parsed.root, 'title')).trim() || path.basename(mapPath),
        children: mapNodeToTree(parsed.root, mapPath)
      });
    } catch (error) {
      console.warn(`Map parse failed: ${mapPath}: ${error.message}`);
      trees.push({ path: mapPath, name: path.basename(mapPath), title: `${path.basename(mapPath)}（解析失败：${error.message}）`, children: [] });
    }
  }
  return trees;
}

async function buildWorkspace() {
  const exists = await fs.stat(DOCS_ROOT).then(stat => stat.isDirectory()).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
  if (exists) await documentBatch.recover(DOCS_ROOT);
  const files = exists ? await walkFileTree() : [];
  const maps = await buildMapTrees(files);
  const git = exists ? await listBranches().catch(() => ({ current: '', branches: [] })) : { current: '', branches: [] };
  return { root: DOCS_ROOT, workspaceToken, capabilities: { persistence: 'filesystem', git: true, pdf: true, remoteGit: true }, files, maps, currentBranch: git.current, branches: git.branches };
}

async function selectRepository(value) {
  const nextRoot = await resolveSelectedRepository(value), previousRoot = DOCS_ROOT;
  DOCS_ROOT = nextRoot;
  let result;
  try { result = await buildWorkspace(); }
  catch (error) { DOCS_ROOT = previousRoot; throw error; }
  workspaceToken = randomUUID(); result.workspaceToken = workspaceToken;
  return result;
}
const handleApi = createApiHandler({
  workspace: {
    get root() { return DOCS_ROOT; }, get token() { return workspaceToken; }, repositoriesRoot: REPOSITORIES_ROOT,
    snapshot: buildWorkspace, selectRepository, rotateToken: () => { workspaceToken = randomUUID(); }
  },
  git, remoteRepositories, documentBatch,
  documents: { checkedResolve, walkFileTree, readXmlFile, writeXmlFile, relativePath, isDitaLike },
  maps: { parseXml, childElement, textOf, mapNodeToTree, applyMapOperation },
  port: PORT, publicOrigin: process.env.PUBLIC_ORIGIN, bindHost: HOST, demoMode: process.env.DITA_DEMO_MODE === '1'
});

async function serveStatic(res, relative) {
  const vendor = { '/vendor/docx/docx.js': 'index.umd.cjs', '/vendor/docx/math.js': 'math.umd.cjs', '/vendor/docx/html.js': 'html.umd.cjs' };
  if (Object.hasOwn(vendor, relative)) {
    sendText(res, 200, await fs.readFile(path.join(path.dirname(require.resolve('docx')), vendor[relative]), 'utf8'), 'text/javascript');
    return true;
  }
  const file = path.resolve(PUBLIC_ROOT, '.' + relative);
  const rootWithSep = PUBLIC_ROOT.endsWith(path.sep) ? PUBLIC_ROOT : PUBLIC_ROOT + path.sep;
  if (file !== PUBLIC_ROOT && !file.startsWith(rootWithSep)) return false;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream';
    sendText(res, 200, await fs.readFile(file, 'utf8'), type);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      // Model work uses immutable input. Knowledge source reads also touch
      // working files, so they wait for a batch save before capturing them.
      const readsKnowledgeSource = knowledgeReads.has(url.pathname);
      if ((url.pathname.startsWith('/api/knowledge/') && !readsKnowledgeSource) ||
          ['/api/ai/propose', '/api/ai/scan', '/api/ai/config'].includes(url.pathname)) {
        await handleApi(req, res, url.pathname, url.searchParams); return;
      }
      const write = url.pathname === '/api/workspace' || req.method !== 'GET' && !readsKnowledgeSource && url.pathname !== '/api/export/pdf';
      await workspaceLock(write, () => handleApi(req, res, url.pathname, url.searchParams));
      return;
    }
    if (await serveStatic(res, url.pathname === '/' ? '/index.html' : url.pathname)) return;
    sendText(res, 404, 'Not found', 'text/plain');
  } catch (error) {
    const status = Number(error.status || (error.code === 'ENOENT' ? 404 : 500));
    sendJson(res, status, { error: error.message || 'Internal server error' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`DITA lite client: http://${HOST}:${PORT}`);
    console.log(`DITA root: ${DOCS_ROOT}`);
  });
}

module.exports = { server, gitInfo, parseXml, decodeEntities, elementChildren, childElement, textOf, resolveHref, mapRefTitle, mapNodeToTree, serializeXmlNode, serializeXmlDocument, applyMapOperation, readXmlFile, writeXmlFile, listRepositories, listBranches, gitWorktreeStatus, resolveSelectedRepository, setDocsRoot: value => { DOCS_ROOT = path.resolve(value); } };



'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { existsSync, readdirSync, statSync } = require('fs');
const { randomUUID } = require('crypto');
const { createWorkspaceLock } = require('./lib/workspace-lock');
const workspaceLock = createWorkspaceLock();
const { createGitService } = require('./lib/git-service');
const { createApiHandler } = require('./lib/api-router');
const { sendJson, sendText } = require('./lib/http-utils');
let workspaceToken = randomUUID();

const PORT = Number(process.env.PORT || 5050);
const HOST = process.env.HOST || '127.0.0.1';
let DOCS_ROOT = path.resolve(process.env.DOCS_ROOT || path.join(__dirname, '..', 'repo_ml353a'));
const DEFAULT_DOCS_ROOT = DOCS_ROOT;
const REPOSITORIES_ROOT = path.resolve(process.env.REPOSITORIES_ROOT || path.dirname(DEFAULT_DOCS_ROOT));
const PUBLIC_ROOT = path.join(__dirname, 'public');
const gitError = (message, status = 400) => Object.assign(new Error(message), { status });

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
async function checkedResolve(relative, options) {
  safeResolve(relative);
  return resolveWorkspacePath(DOCS_ROOT, relative, options);
}

const git = createGitService({ getRoot: () => DOCS_ROOT, repositoriesRoot: REPOSITORIES_ROOT, checkedResolve });
const { runGit, gitInfo, listRepositories, listBranches, gitWorktreeStatus, resolveSelectedRepository } = git;

const MAP_REFERENCE_TAGS = new Set(["map", "bookmap", "topicref", "topichead", "topicgroup", "chapter", "appendix", "notices", "preface", "part", "frontmatter", "backmatter", "booklists"]);

function isDitaLike(fileName) {
  return /\.(dita|ditamap|xml)$/i.test(fileName);

}
const { decodeEntities, parseXml, serializeXmlNode, serializeXmlDocument, elementChildren, childElement, textOf } = require('./lib/xml-tree');

function mapElementChildren(node) {
  return node?.children.filter(child => child.type === 'element') || [];
}

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

function findFileInSubdirs(dir, basename) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === basename) return full;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== '.git') {
        const found = findFileInSubdirs(path.join(dir, entry.name), basename);
        if (found) return found;
      }
    }
  } catch (e) { console.warn('findFileInSubdirs error:', e.message); }
  return null;
}

function resolveHref(mapPath, href) {
  const mapDirectory = path.dirname(mapPath);
  const decoded = decodeURIComponent(href.split('#')[0].split('?')[0]);
  const absolute = path.resolve(DOCS_ROOT, mapDirectory, decoded);
  const relative = relativePath(absolute);
  if (relative.startsWith('..')) return null;
  if (existsSync(absolute) && statSync(absolute).isFile()) return relative;
  const parentDir = path.dirname(absolute);
  const basename = path.basename(absolute);
  if (existsSync(parentDir) && statSync(parentDir).isDirectory()) {
    const found = findFileInSubdirs(parentDir, basename);
    if (found) { const rel = relativePath(found); if (!rel.startsWith('..')) return rel; }
  }
  return relative;
}

function mapRefTitle(node, fallback) {
  const title = childElement(node, 'title');
  const topicmeta = childElement(node, 'topicmeta');
  const navtitle = topicmeta ? childElement(topicmeta, 'navtitle') : null;
  return (navtitle && textOf(navtitle).trim()) || (title && textOf(title).trim()) || node.attrs.navtitle || fallback;
}

function mapNodeToTree(node, mapPath, sourcePath = '', processingRole = 'normal') {
  processingRole = node.attrs['processing-role'] || processingRole;
  const tree = [];
  let childIndex = -1;
  for (const child of node.children) {
    if (child.type === 'element') {
      childIndex++;
      const refNames = ['topicref', 'topichead', 'topicgroup', 'chapter', 'appendix', 'notices', 'preface', 'part', 'frontmatter', 'backmatter', 'booklists'];
      if (refNames.includes(child.name)) {
        const childSourcePath = sourcePath ? `${sourcePath}.${childIndex}` : String(childIndex);
        const childRole = child.attrs['processing-role'] || processingRole;
        const children = mapNodeToTree(child, mapPath, childSourcePath, childRole);
        const href = child.attrs.href ? resolveHref(mapPath, child.attrs.href) : null;
        const fallback = href ? path.basename(href) : (children.length ? child.name : child.name);
        const entry = {
          type: href ? 'file' : 'container',
          title: mapRefTitle(child, fallback),
          path: href || child.attrs.href || '',
          sourcePath: childSourcePath,
          processingRole: childRole,
          children
        };
        if (href || children.length || !child.attrs.href) tree.push(entry);
      }
    }
  }
  return tree;
}

function locateMapNode(root, sourcePath) {
  if (sourcePath === '' || sourcePath == null) return root;
  const segments = String(sourcePath).split('.');
  if (!segments.length || segments.some(segment => !/^\d+$/.test(segment))) return null;
  let node = root;
  for (const segment of segments) {
    node = mapElementChildren(node)[Number(segment)];
    if (node?.type !== 'element') return null;
  }
  return node;
}

function mapNodeParent(root, sourcePath) {
  if (sourcePath === '' || sourcePath == null) return null;
  const segments = String(sourcePath).split('.');
  const parentPath = segments.slice(0, -1).join('.');
  return locateMapNode(root, parentPath);
}

function sourcePathOf(root, target) {
  function walk(node, currentPath = '') {
    if (node === target) return currentPath;
    const elements = mapElementChildren(node);
    for (let index = 0; index < elements.length; index++) {
      const child = elements[index];
      const childPath = currentPath ? `${currentPath}.${index}` : String(index);
      const found = walk(child, childPath);
      if (found != null) return found;
    }
    return null;
  }
  return walk(root);
}

function addMapChild(parent, node, after = null) {
  if (after) parent.children.splice(parent.children.indexOf(after) + 1, 0, node);
  else parent.children.push(node);
}

function removeMapNode(parent, node) {
  parent.children.splice(parent.children.indexOf(node), 1);
}

function previousElementSibling(parent, node) {

  const index = parent.children.indexOf(node);
  for (let i = index - 1; i >= 0; i--) {
    const child = parent.children[i];
    if (child?.type === 'element' && MAP_REFERENCE_TAGS.has(child.name)) return child;
  }
  return null;
}

function nextElementSibling(parent, node) {
  const index = parent.children.indexOf(node);
  for (let i = index + 1; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child?.type === 'element' && MAP_REFERENCE_TAGS.has(child.name)) return child;
  }
  return null;
}


async function validateTopicHref(mapPath, requestHref, dependencies = {}) {
  if (dependencies.resolveTopicHref) return dependencies.resolveTopicHref(mapPath, requestHref);
  const clean = String(requestHref || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('\0')) throw Object.assign(new Error('Topic path is required'), { status: 400 });
  const target = await checkedResolve(clean);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile() || !isDitaLike(target)) throw Object.assign(new Error('Topic file not found'), { status: 404 });
  const mapDirectory = path.dirname(safeResolve(mapPath));
  const relative = path.relative(mapDirectory, target).replace(/\\/g, '/');
  if (relative.startsWith('..')) throw Object.assign(new Error('Topic path escapes the map directory'), { status: 400 });
  return relative;
}

async function applyMapOperation(content, mapPath, request, dependencies = {}) {
  const parsed = parseXml(content);
  if (!MAP_REFERENCE_TAGS.has(parsed.root.name)) throw Object.assign(new Error('Not a DITA map'), { status: 400 });
  const operation = String(request.operation || '');
  const sourcePath = request.sourcePath == null ? '' : String(request.sourcePath);
  const selected = locateMapNode(parsed.root, sourcePath);
  if (!selected) throw Object.assign(new Error('Selected map node was not found'), { status: 404 });
  let nextSelected = selected;
  const parent = mapNodeParent(parsed.root, sourcePath);

  if (operation === 'addTopicref' || operation === 'addTopichead') {
    const isTopicref = operation === 'addTopicref';
    const node = { type: 'element', name: isTopicref ? 'topicref' : 'topichead', attrs: {}, children: [] };
    if (isTopicref) node.attrs.href = await validateTopicHref(mapPath, request.href, dependencies);
    else {
      const title = String(request.title || '').trim();
      if (!title) throw Object.assign(new Error('Topic heading title is required'), { status: 400 });
      node.children.push({ type: 'element', name: 'title', attrs: {}, children: [{ type: 'text', value: title }] });
    }
    const targetParent = selected === parsed.root || (!selected.attrs.href && MAP_REFERENCE_TAGS.has(selected.name)) ? selected : (parent || parsed.root);
    addMapChild(targetParent, node, targetParent === parent ? selected : null);
    nextSelected = node;
  } else if (operation === 'moveUp' || operation === 'moveDown') {
    if (!parent) throw Object.assign(new Error('Cannot move the map root'), { status: 400 });
    const sibling = operation === 'moveUp' ? previousElementSibling(parent, selected) : nextElementSibling(parent, selected);
    if (!sibling) throw Object.assign(new Error(operation === 'moveUp' ? 'Node is already first' : 'Node is already last'), { status: 409 });
    removeMapNode(parent, selected);
    parent.children.splice(parent.children.indexOf(sibling) + (operation === 'moveUp' ? 0 : 1), 0, selected);
  } else if (operation === 'promote') {
    if (!parent || parent === parsed.root) throw Object.assign(new Error('Node cannot be promoted further'), { status: 409 });
    const parentSourcePath = sourcePathOf(parsed.root, parent);
    const grandparent = mapNodeParent(parsed.root, parentSourcePath || '');
    if (!grandparent) throw Object.assign(new Error('Parent node was not found'), { status: 404 });
    removeMapNode(parent, selected);
    grandparent.children.splice(grandparent.children.indexOf(parent) + 1, 0, selected);
  } else if (operation === 'demote') {
    if (!parent) throw Object.assign(new Error('Cannot demote the map root'), { status: 400 });
    const sibling = previousElementSibling(parent, selected);
    if (!sibling) throw Object.assign(new Error('No previous sibling can contain this node'), { status: 409 });
    removeMapNode(parent, selected);
    sibling.children.push(selected);
  } else if (operation === 'remove') {
    if (!parent) throw Object.assign(new Error('Cannot remove the map root'), { status: 400 });
    removeMapNode(parent, selected);
    nextSelected = parsed.root;
  } else {
    throw Object.assign(new Error('Unsupported map operation'), { status: 400 });
  }

  const nextSourcePath = nextSelected === parsed.root ? '' : (sourcePathOf(parsed.root, nextSelected) || '');
  return {
    original: content,
    content: serializeXmlDocument(parsed),
    selectedSourcePath: nextSourcePath,
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
  const files = await walkFileTree();
  const maps = await buildMapTrees(files);
  const git = await listBranches();
  return { root: DOCS_ROOT, workspaceToken, capabilities: { persistence: 'filesystem', git: true, pdf: true }, files, maps, currentBranch: git.current, branches: git.branches };
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
  git,
  documents: { checkedResolve, walkFileTree, readXmlFile, writeXmlFile, relativePath, isDitaLike },
  maps: { parseXml, childElement, textOf, mapNodeToTree, applyMapOperation },
  port: PORT, publicOrigin: process.env.PUBLIC_ORIGIN, demoMode: process.env.DITA_DEMO_MODE === '1'
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
      await workspaceLock(req.method !== 'GET' && url.pathname !== '/api/export/pdf', () => handleApi(req, res, url.pathname, url.searchParams));
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



'use strict';

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { existsSync, readdirSync, statSync } = require('fs');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { createWorkspaceLock } = require('./lib/workspace-lock');
const workspaceLock = createWorkspaceLock();
let workspaceToken = randomUUID();

const PORT = Number(process.env.PORT || 5050);
const HOST = process.env.HOST || '127.0.0.1';
let DOCS_ROOT = path.resolve(process.env.DOCS_ROOT || path.join(__dirname, '..', 'repo_ml353a'));
const DEFAULT_DOCS_ROOT = DOCS_ROOT;
const REPOSITORIES_ROOT = path.resolve(process.env.REPOSITORIES_ROOT || path.dirname(DEFAULT_DOCS_ROOT));
const PUBLIC_ROOT = path.join(__dirname, 'public');
const MAX_BODY_SIZE = 5 * 1024 * 1024;

function cleanGitError(error) {
  const detail = String(error.stderr || error.stdout || error.message || '').trim();
  return detail || error.message || 'Git command failed';
}

function gitError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function runGitOnce(executable, args, options) {
  const output = path.join(os.tmpdir(), `dita-git-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  let handle;
  try {
    handle = await fs.open(output, 'w');
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: options.cwd,
        windowsHide: true,
        stdio: ['ignore', handle.fd, 'pipe']
      });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Git command timed out')); }, 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(Object.assign(new Error(`Git command failed with exit code ${code}`), { code, stderr }));
      });
    });
    return await fs.readFile(output, options.binary ? undefined : 'utf8');
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(output, { force: true }).catch(() => {});
  }
}

async function runGit(args, options = {}) {
  try {
    const git = await findGitExecutable();
    return await runGitOnce(git, args, { cwd: options.cwd || DOCS_ROOT, binary: options.binary });
  } catch (error) {
    throw Object.assign(new Error(cleanGitError(error)), { status: Number(options.errorStatus || 500) });
  }
}


async function findGitExecutable() {
  if (process.env.GIT_EXECUTABLE) return process.env.GIT_EXECUTABLE;
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'), 'C:\\Program Files\\Git\\cmd\\git.exe', 'git.exe', 'git']
    : ['git'];
  for (const candidate of candidates) {
    const available = await new Promise(resolve => {
      const child = spawn(candidate, ['--version'], { windowsHide: true, stdio: 'ignore' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.kill();
        resolve(true);
      });
    });
    if (available) return candidate;
  }
  throw gitError('Git executable not available', 500);
}
async function gitRoot(target = DOCS_ROOT) {
  const stdout = await runGit(['rev-parse', '--show-toplevel'], { cwd: target, errorStatus: 404 });
  return path.resolve(stdout.trim());
}

async function isGitRepository(directory) {
  try {
    const root = await gitRoot(directory);
    return { ok: true, root };
  } catch {
    return { ok: false, root: null };
  }
}

async function resolveSelectedRepository(value) {
  const target = await fs.realpath(path.resolve(String(value || '')));
  const repositoriesRoot = await fs.realpath(REPOSITORIES_ROOT);
  const parent = path.dirname(target);
  if (target !== repositoriesRoot && parent !== repositoriesRoot) {
    throw gitError('Repository must be a direct child of the repositories root', 403);
  }
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isDirectory()) throw gitError('Repository directory not found', 404);
  const info = await isGitRepository(target);
  if (!info.ok) throw gitError('Selected directory is not a Git repository', 400);
  return target;
}

async function listRepositories() {
  const entries = await fs.readdir(REPOSITORIES_ROOT, { withFileTypes: true });
  const repositories = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const absolute = path.join(REPOSITORIES_ROOT, entry.name);
    const info = await isGitRepository(absolute);
    if (info.ok) repositories.push({ path: absolute, name: path.basename(absolute) });
  }
  repositories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return repositories;
}

async function listBranches() {
  let current = '';
  try {
    current = (await runGit(['branch', '--show-current'])).trim();
  } catch {
    current = '';
  }
  const stdout = await runGit(['for-each-ref', '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:iso8601)', 'refs/heads']);
  const branches = stdout.split(/\r?\n/).filter(Boolean).map(line => {
    const [name, commit, date = ''] = line.split('\t');
    return { name, commit, date, current: name === current };
  });
  return { current: current || '(detached)', branches };
}

async function gitWorktreeStatus() {
  const stdout = await runGit(['status', '--porcelain']);
  return { clean: !stdout.trim(), changes: stdout.trim() ? stdout.trim().split(/\r?\n/) : [] };
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, body, type = 'text/plain') {
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readJson(req) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > MAX_BODY_SIZE) {
    throw Object.assign(new Error('Request body is too large'), { status: 413 });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_SIZE) {
      throw Object.assign(new Error('Request body is too large'), { status: 413 });
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  return JSON.parse(raw.toString('utf8'));
}

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

const { readXmlFile, writeXmlFile, decodeXmlBuffer, resolveWorkspacePath } = require('./lib/document-files');
async function checkedResolve(relative, options) {
  safeResolve(relative);
  return resolveWorkspacePath(DOCS_ROOT, relative, options);
}

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

async function gitInfo(relativeFilePath) {
  try {
    const absolute = await checkedResolve(relativeFilePath);
    const root = await gitRoot(path.dirname(absolute));
    const gitRelative = path.relative(root, absolute).replace(/\\/g, '/');
    let status = 'unknown';
    try {
      const statusResult = await runGit(['status', '--porcelain', '--', gitRelative], { cwd: root });
      status = statusResult.trim() ? statusResult.trim().slice(0, 2) : 'clean';
    } catch {
      status = 'unknown';
    }
    try {
      const content = decodeXmlBuffer(await runGit(['show', `HEAD:${gitRelative}`], { cwd: root, binary: true }));
      return { available: true, status, content };
    } catch {
      return { available: false, status, content: '' };
    }
  } catch {
    return null;
  }
}
async function buildWorkspace() {
  const files = await walkFileTree();
  const maps = await buildMapTrees(files);
  const git = await listBranches();
  return { root: DOCS_ROOT, workspaceToken, files, maps, currentBranch: git.current, branches: git.branches };
}

async function handleApi(req, res, pathname, searchParams) {
  const suppliedToken = req.headers['x-workspace-token'];
  const bootstrap = pathname === '/api/repos' || pathname === '/api/workspace' || pathname === '/api/asset';
  if ((suppliedToken && suppliedToken !== workspaceToken) || (!suppliedToken && !bootstrap)) {
    res.setHeader('x-workspace-stale', '1');
    throw gitError('Workspace changed. Reload before continuing.', 409);
  }
  const origin = req.headers.origin;
  const allowed = ['http://127.0.0.1:' + PORT, 'http://localhost:' + PORT];
  if (process.env.PUBLIC_ORIGIN) allowed.push(process.env.PUBLIC_ORIGIN);
  // The demo contains only disposable sample documents and supports a preview proxy.
  if (process.env.DITA_DEMO_MODE === '1' && origin) {
    try { if (new URL(origin).host === req.headers.host) allowed.push(origin); } catch {}
  }
  // Same-origin browser requests (especially GET) often omit the Origin header.
  // Reject only when Origin IS present but does not match (cross-origin CSRF).
  if (origin && !allowed.includes(origin)) {
    sendJson(res, 403, { error: 'Forbidden origin' });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/repos') {
    const repositories = await listRepositories();
    sendJson(res, 200, { root: REPOSITORIES_ROOT, repositories, current: DOCS_ROOT });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/branches') {
    const git = await listBranches();
    sendJson(res, 200, { root: DOCS_ROOT, current: git.current, branches: git.branches });
    return;
  }

  if (req.method === 'POST' && (pathname === '/api/repository' || pathname === '/api/branch')) {
    const body = await readJson(req);
    if (pathname === '/api/repository') {
      const nextRoot = await resolveSelectedRepository(body.repository);
      const previousRoot = DOCS_ROOT;
      DOCS_ROOT = nextRoot;
      let workspace;
      try { workspace = await buildWorkspace(); }
      catch (error) { DOCS_ROOT = previousRoot; throw error; }
      workspaceToken = randomUUID();
      workspace.workspaceToken = workspaceToken;
      sendJson(res, 200, workspace);
      return;
    }

    const branch = String(body.branch || '').trim();
    if (!branch || /[\r\n\0^:?*[\\]/.test(branch) || branch.startsWith('-') || branch === '.' || branch === '..') {
      throw gitError('Invalid branch name');
    }
    const branches = await listBranches();
    if (!branches.branches.some(item => item.name === branch)) throw gitError('Branch not found', 404);
    const status = await gitWorktreeStatus();
    if (!status.clean) {
      throw gitError('工作区有尚未提交的修改。请先提交或暂存（git stash），再切换分支；当前内容已保留。', 409);
    }
    await runGit(['switch', branch]);
    workspaceToken = randomUUID();
    sendJson(res, 200, await buildWorkspace());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/workspace') {
    sendJson(res, 200, await buildWorkspace());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/tree') {
    const files = await walkFileTree();
    sendJson(res, 200, { root: DOCS_ROOT, tree: files });
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
            const content = await fs.readFile(path.join(DOCS_ROOT, node.path), 'utf8');
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
    const allowedExts = ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.bmp'];
    if (!allowedExts.includes(ext)) throw Object.assign(new Error('Unsupported asset type'), { status: 403 });
    const type = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.bmp' ? 'image/bmp' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
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
}

async function serveStatic(res, relative) {
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
      await workspaceLock(req.method !== 'GET', () => handleApi(req, res, url.pathname, url.searchParams));
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



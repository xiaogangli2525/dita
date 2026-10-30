'use strict';

const http = require('http');
const path = require('path');
const os = require('os');
const iconv = require('iconv-lite');
const fs = require('fs/promises');
const { existsSync, readdirSync, statSync } = require('fs');
const { spawn } = require('child_process');

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
        stdio: ['ignore', handle.fd, 'ignore']
      });
      child.once('error', reject);
      child.once('exit', code => {
        if (code === 0) resolve();
        else reject(Object.assign(new Error(`Git command failed with exit code ${code}`), { code }));
      });
    });
    return await fs.readFile(output, 'utf8');
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(output, { force: true }).catch(() => {});
  }
}

async function runGit(args, options = {}) {
  try {
    const git = await findGitExecutable();
    return await runGitOnce(git, args, { cwd: options.cwd || DOCS_ROOT });
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
  const target = path.resolve(String(value || ''));
  const parent = path.dirname(target);
  const allowedParents = [REPOSITORIES_ROOT, path.dirname(REPOSITORIES_ROOT)];
  if (target !== REPOSITORIES_ROOT && !allowedParents.includes(parent)) {
    throw gitError('Repository must be a direct child of the repositories root', 403);
  }
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isDirectory()) throw gitError('Repository directory not found', 404);
  const info = await isGitRepository(target);
  if (!info.ok) throw gitError('Selected directory is not a Git repository', 400);
  return info.root === path.dirname(REPOSITORIES_ROOT) ? target : info.root;
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

function normalizeEncodingName(encoding) {
  const name = String(encoding || '').trim().toLowerCase();
  if (name === 'utf8' || name === 'utf-8') return 'utf-8';
  if (['gb2312', 'gbk', 'cp936'].includes(name)) return 'gb18030';
  return name || null;
}

async function readXmlFile(file) {
  const buffer = await fs.readFile(file);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }

  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  const declared = /encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1];
  const candidates = [...new Set([normalizeEncodingName(declared), 'utf-8', 'gb18030'].filter(Boolean))];

  for (const candidate of candidates) {
    try {
      const text = new TextDecoder(candidate, { fatal: true }).decode(buffer);
      if (candidate === 'utf-8' && text.includes('\uFFFD')) continue;
      return text;
    } catch {
      // Try the next supported encoding candidate.
    }
  }

  return buffer.toString('utf-8');
}

async function writeXmlFile(file, content) {
  const declared = /encoding\s*=\s*["']([^"']+)["']/i.exec(content)?.[1];
  const encoding = normalizeEncodingName(declared);
  if (encoding && encoding !== 'utf-8') {
    await fs.writeFile(file, iconv.encode(content, encoding));
  } else {
    await fs.writeFile(file, content, 'utf8');
  }
}

const MAP_REFERENCE_TAGS = new Set(["map", "bookmap", "topicref", "topichead", "topicgroup", "chapter", "appendix", "notices", "preface", "part", "frontmatter", "backmatter", "booklists"]);

function isDitaLike(fileName) {
  return /\.(dita|ditamap|xml)$/i.test(fileName);

}
function decodeEntities(value) {
  return String(value).replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|lt|gt|quot|apos|amp);/g, (m, dec, hex) => {
    try {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
    } catch (e) {
      return m;
    }
    if (m === '&lt;') return '<';
    if (m === '&gt;') return '>';
    if (m === '&quot;') return String.fromCharCode(34);
    if (m === '&apos;') return String.fromCharCode(39);
    if (m === '&amp;') return '&';
    return m;
  });
}

function parseAttributes(source) {
  const attrs = {};
  const attrPattern = /([A-Za-z_:][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrPattern.exec(source))) {
    attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function findTagEnd(text, start) {
  let i = start;
  let inQuote = null;
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else {
      if (ch === '"' || ch === "'") inQuote = ch;
      else if (ch === '>') return i;
    }
    i++;
  }
  return -1;
}

function parseXml(text) {
  let cursor = 0;
  let declaration = null;
  let doctype = null;
  let root = null;
  const stack = [];

  function error(message, index = cursor) {
    const line = text.slice(0, index).split(/\r?\n/).length;
    throw Object.assign(new Error(`${message} at line ${line}`), { status: 400 });
  }

  function skipMisc() {
    while (cursor < text.length) {
      const whitespace = /^\s*/.exec(text.slice(cursor))[0].length;
      cursor += whitespace;
      if (text.startsWith('<?xml', cursor)) {
        const end = text.indexOf('?>', cursor);
        if (end < 0) error('Unterminated XML declaration');
        declaration = text.slice(cursor, end + 2);
        cursor = end + 2;
      } else if (text.startsWith('<!--', cursor)) {
        const end = text.indexOf('-->', cursor);
        if (end < 0) error('Unterminated comment');
        cursor = end + 3;
      } else if (text.startsWith('<!DOCTYPE', cursor)) {
        let end = text.indexOf('>', cursor);
        if (end < 0) error('Unterminated DOCTYPE');
        if (text.slice(cursor, end).includes('[')) {
          let balance = 0;
          for (let i = cursor; i < text.length; i++) {
            if (text[i] === '[') balance++;
            if (text[i] === ']') balance--;
            if (balance === 0 && text[i] === '>') {
              end = i;
              break;
            }
          }
          if (balance !== 0) error('Unterminated DOCTYPE internal subset');
        }
        doctype = text.slice(cursor, end + 1);
        cursor = end + 1;
      } else if (text.startsWith('<?', cursor)) {
        const end = text.indexOf('?>', cursor);
        if (end < 0) error('Unterminated processing instruction');
        cursor = end + 2;
      } else {
        return;
      }
    }
  }

  skipMisc();
  while (cursor < text.length) {
    if (text.startsWith('<!--', cursor)) {
      const end = text.indexOf('-->', cursor);
      if (end < 0) error('Unterminated comment');
      if (stack.length) stack[stack.length - 1].children.push({ type: "comment", value: text.slice(cursor + 4, end) });
      cursor = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', cursor)) {
      const end = text.indexOf(']]>', cursor);
      if (end < 0) error('Unterminated CDATA section');
      const data = text.slice(cursor + 9, end);
      if (stack.length) stack[stack.length - 1].children.push({ type: 'text', value: data, cdata: true });
      else error('CDATA outside root element');
      cursor = end + 3;
      continue;
    }
    if (text.startsWith('<?', cursor)) {
      const end = text.indexOf('?>', cursor);
      if (end < 0) error("Unterminated processing instruction");
      if (stack.length) stack[stack.length - 1].children.push({ type: "pi", value: text.slice(cursor + 2, end) });
      if (end < 0) error('Unterminated processing instruction');
      cursor = end + 2;
      continue;
    }
    if (text.startsWith('</', cursor)) {
      const end = text.indexOf('>', cursor);
      if (end < 0) error('Unterminated end tag');
      const name = text.slice(cursor + 2, end).trim();
      const parent = stack.pop();
      if (!parent || parent.name !== name) error(`Mismatched end tag </${name}>`);
      cursor = end + 1;
      continue;
    }
    if (text.startsWith('<', cursor)) {
      const end = findTagEnd(text, cursor);
      if (end < 0) error('Unterminated start tag');
      const source = text.slice(cursor + 1, end).trimStart();
      const selfClosing = source.endsWith('/');
      const tagSource = selfClosing ? source.slice(0, -1).trimEnd() : source.trimEnd();
      const match = /^([A-Za-z_:][\w.:-]*)(?:\s+([\s\S]*))?$/.exec(tagSource.trim());
      if (!match) error('Invalid start tag: ' + JSON.stringify(tagSource.trim()));
      const node = {
        type: 'element',
        name: match[1],
        attrs: parseAttributes(match[2] || ''),
        children: []
      };
      if (!root) root = node;
      else stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
      cursor = end + 1;
      continue;
    }

    const nextTag = text.indexOf('<', cursor);
    if (nextTag < 0) {
      if (!stack.length && !text.slice(cursor).trim()) break;
      error('Text outside root element');
    }
    const value = text.slice(cursor, nextTag);
    if (!stack.length) {
      if (!value.trim()) {
        cursor = nextTag;
        continue;
      }
      error('Text outside root element');
    }
    if (stack.length) {
      const value = text.slice(cursor, nextTag);
      if (value) stack[stack.length - 1].children.push({ type: 'text', value: decodeEntities(value) });
    }
    cursor = nextTag;
  }
  if (stack.length) error(`Unclosed element <${stack[stack.length - 1].name}>`);
  if (!root) error('No root element');
  return { declaration, doctype, root };
}

function encodeXmlText(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function encodeXmlAttribute(value) {
  return encodeXmlText(value).replace(/"/g, "&quot;");
}

function hasSignificantChildren(node) {
  return node.children.some(child => {
    if (child.type === "text") return Boolean(child.value.trim() || child.cdata);
    return true;
  });
}

function serializeXmlNode(node, level = 0) {
  if (node.type === "text") return node.cdata ? `<![CDATA[${node.value}]]>` : encodeXmlText(node.value);
  if (node.type === "comment") return `<!--${node.value}-->`;
  if (node.type === "pi") return `<?${node.value}?>`;
  if (node.type !== "element") throw new Error(`Cannot serialize XML node type: ${node.type}`);

  const attributes = Object.entries(node.attrs || {}).map(([name, value]) => ` ${name}="${encodeXmlAttribute(value)}"`).join("");
  const children = node.children.filter(child => child.type !== "text" || child.value.trim() || child.cdata);
  if (!hasSignificantChildren(node)) return `${"  ".repeat(level)}<${node.name}${attributes}/>`;

  const inline = node.children.some(child => child.type === "text" && child.value.trim());
  if (inline) return `${"  ".repeat(level)}<${node.name}${attributes}>${children.map(child => serializeXmlNode(child, 0)).join("")}</${node.name}>`;
  return [
    `${"  ".repeat(level)}<${node.name}${attributes}>`,
    ...children.map(child => serializeXmlNode(child, level + 1)),
    `${"  ".repeat(level)}</${node.name}>`
  ].join("\n");
}

function serializeXmlDocument(parsed) {
  const declaration = parsed.declaration || `<?xml version="1.0" encoding="UTF-8"?>`;
  return `${declaration}\n${parsed.doctype ? `${parsed.doctype}\n` : ""}${serializeXmlNode(parsed.root)}\n`;
}


function elementChildren(node, names) {
  return node.children.filter(child => child.type === 'element' && names.includes(child.name));
}

function mapElementChildren(node) {
  return node?.children.filter(child => child.type === 'element') || [];
}

function childElement(node, name) {
  return node?.children.find(child => child.type === 'element' && child.name === name) || null;
}

function textOf(node) {
  if (!node || node.type !== 'element') return '';
  return node.children.map(child => child.type === 'text' ? child.value : child.type === 'element' ? textOf(child) : '').join('');
}

async function walkFileTree(current = '') {
  const entries = await fs.readdir(path.join(DOCS_ROOT, current), { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name, 'en', { numeric: true });
  });
  const result = [];
  for (const entry of entries) {
    if (entry.name === '.git') continue;
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

function mapNodeToTree(node, mapPath, sourcePath = '') {
  const tree = [];
  let childIndex = 0;
  for (const child of node.children) {
    if (child.type === 'element') {
      childIndex++;
      const refNames = ['topicref', 'topichead', 'topicgroup', 'chapter', 'appendix', 'notices', 'preface', 'part', 'frontmatter', 'backmatter', 'booklists'];
      if (refNames.includes(child.name)) {
        const childSourcePath = sourcePath ? `${sourcePath}.${childIndex}` : String(childIndex);
        const children = mapNodeToTree(child, mapPath, childSourcePath);
        const href = child.attrs.href ? resolveHref(mapPath, child.attrs.href) : null;
        const fallback = href ? path.basename(href) : (children.length ? child.name : child.name);
        const entry = {
          type: href ? 'file' : 'container',
          title: mapRefTitle(child, fallback),
          path: href || child.attrs.href || '',
          sourcePath: childSourcePath,
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
  const target = safeResolve(clean);
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
      const text = await readXmlFile(safeResolve(mapPath));
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
    const absolute = safeResolve(relativeFilePath);
    let root = path.dirname(absolute);
    let gitRelative = path.basename(absolute);
    while (path.dirname(root) !== root && !existsSync(path.join(root, '.git'))) {
      root = path.dirname(root);
      gitRelative = `${path.basename(root)}/${gitRelative}`;
    }
    if (path.dirname(root) === root) return { available: false, status: 'no-git', content: '' };
    let status = 'unknown';
    try {
      const statusResult = await runGit(['status', '--porcelain', '--', gitRelative], { cwd: root });
      status = statusResult.trim() ? statusResult.trim().slice(0, 2) : 'clean';
    } catch {
      status = 'unknown';
    }
    try {
      const content = await runGit(['show', `HEAD:${gitRelative}`], { cwd: root });
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
  return { root: DOCS_ROOT, files, maps, currentBranch: git.current, branches: git.branches };
}

async function handleApi(req, res, pathname, searchParams) {
  const origin = req.headers.origin;
  const allowed = ['http://127.0.0.1:' + PORT, 'http://localhost:' + PORT];
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
      DOCS_ROOT = await resolveSelectedRepository(body.repository);
      sendJson(res, 200, await buildWorkspace());
      return;
    }

    const branch = String(body.branch || '').trim();
    if (!branch || /[\r\n\0^:?*[\\]/.test(branch) || branch.startsWith('-') || branch === '.' || branch === '..') {
      throw gitError('Invalid branch name');
    }
    const branches = await listBranches();
    if (!branches.branches.some(item => item.name === branch)) throw gitError('Branch not found', 404);
    const status = await gitWorktreeStatus();
    if (!status.clean && body.force !== true) {
      throw gitError('Working tree is not clean. Confirm the switch to overwrite local changes.', 409);
    }
    await runGit(['switch', '--force', branch]);
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
    const asset = safeResolve(searchParams.get('path'));
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

  if (req.method === 'POST' && pathname === '/api/map/operation') {
    const body = await readJson(req);
    const mapFile = safeResolve(body.path);
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
    const file = safeResolve(searchParams.get('path'));
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
    const file = safeResolve(requestedPath);
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
    await writeXmlFile(file, content);
    const saved = await readXmlFile(file);
    sendJson(res, 201, { saved: true, created: !existing, path: relativePath(file), content: saved });
    return;
  }

  if (req.method === 'PUT' && pathname === '/api/file') {
    const body = await readJson(req);
    const file = safeResolve(body.path);
    const stat = await fs.stat(file);
    if (!stat.isFile() || !isDitaLike(file)) throw Object.assign(new Error('Not a DITA/XML file'), { status: 404 });
    const content = String(body.content ?? '');
    const parsed = parseXml(content);
    if (!parsed.root) throw Object.assign(new Error('XML has no root element'), { status: 400 });
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
      await handleApi(req, res, url.pathname, url.searchParams);
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

module.exports = { parseXml, decodeEntities, elementChildren, childElement, textOf, resolveHref, mapRefTitle, mapNodeToTree, serializeXmlNode, serializeXmlDocument, applyMapOperation, readXmlFile, writeXmlFile, listRepositories, listBranches, gitWorktreeStatus, resolveSelectedRepository, setDocsRoot: value => { DOCS_ROOT = path.resolve(value); } };


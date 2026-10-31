'use strict';
const fs = require('fs/promises');
const path = require('path');
const { validateProject } = require('../public/manual-core');
const { findMatches } = require('../public/search-core');
const { atomicWrite } = require('./document-files');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const imagePattern = /\.(png|jpe?g|gif|bmp|svg|webp)$/i;
function validateImage(name, bytes) { try { require('../public/asset-core').validateImage(name, bytes); } catch (error) { fail(error.message); } }
async function imageFiles(root, checkedResolve) {
  const files = []; let visited = 0, truncated = false;
  async function walk(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++visited > 10000 || files.length >= 2000) { truncated = true; return; }
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
      else if (entry.isFile() && imagePattern.test(entry.name)) { await checkedResolve(relative); files.push(relative); }
    }
  }
  await walk(root); return { files: files.sort(), truncated };
}
async function handleWorkspaceTools(req, res, pathname, params, env) {
  const { root, readJson, sendJson, checkedResolve, readXmlFile, walkFileTree, runGit, gitWorktreeStatus } = env;
  if (pathname === '/api/project' && ['GET', 'PUT'].includes(req.method)) {
    const file = await checkedResolve('.dita-project.json', { create: true });
    const previous = await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (req.method === 'GET') {
      let config = { schema: 1, models: [] }, error;
      try { if (previous != null) config = validateProject(JSON.parse(previous)); } catch (e) { error = '项目配置无效，请修复型号清单：' + e.message; }
      sendJson(res, 200, { config, expectedContent: previous, ...(error ? { error } : {}) }); return true;
    }
    const body = await readJson(req);
    if (body.expectedContent !== previous) fail('项目配置已变化，请重新打开后保存', 409);
    let config; try { config = validateProject(body.config); } catch (error) { fail(error.message); }
    const content = JSON.stringify(config, null, 2) + '\n';
    await atomicWrite(file, Buffer.from(content), previous == null);
    sendJson(res, 200, { config, expectedContent: content }); return true;
  }
  if (pathname === '/api/provenance' && req.method === 'GET') {
    let source;
    try { source = { commit: (await runGit(['rev-parse', 'HEAD'])).trim(), branch: (await runGit(['branch', '--show-current'])).trim(), dirty: !(await gitWorktreeStatus()).clean }; }
    catch { source = { commit: null, branch: null, dirty: null }; }
    sendJson(res, 200, source); return true;
  }
  if (pathname === '/api/search' && req.method === 'POST') {
    const body = await readJson(req), query = String(body.query || '').trim();
    if (!query || query.length > 200) fail('请输入 1～200 字的搜索内容');
    const all = [];
    function collect(nodes) { for (const node of nodes) { if (node.children) collect(node.children); if (node.type === 'file' && /\.(dita|xml|ditamap)$/i.test(node.path)) all.push(node.path); } }
    collect(await walkFileTree());
    const requested = body.paths;
    if (requested != null && (!Array.isArray(requested) || requested.length > 2000 || requested.some(p => typeof p !== 'string'))) fail('搜索范围无效');
    const allowed = requested ? new Set(requested) : null, candidates = all.filter(p => !allowed || allowed.has(p));
    const matches = [], warnings = []; let bytes = 0, scanned = 0, truncated = candidates.length > 2000;
    for (const filePath of candidates.slice(0, 2000)) {
      try {
        const file = await checkedResolve(filePath), stat = await fs.stat(file);
        if (stat.size > 1024 * 1024 || bytes + stat.size > 10 * 1024 * 1024) { truncated = true; continue; }
        bytes += stat.size; scanned++;
        const source = await readXmlFile(file);
        for (const match of findMatches(source, query)) { matches.push({ path: filePath, ...match }); if (matches.length >= 100) break; }
        if (matches.length >= 100) { truncated = true; break; }
      } catch (error) { warnings.push({ path: filePath, message: error.message }); }
    }
    sendJson(res, 200, { matches, warnings, truncated, scanned }); return true;
  }
  if (pathname === '/api/assets' && req.method === 'GET') { sendJson(res, 200, await imageFiles(root, checkedResolve)); return true; }
  if (pathname === '/api/assets' && req.method === 'POST') {
    const body = await readJson(req), name = String(body.name || '');
    if (!name || name.length > 150 || /[\/\\\x00-\x1f]/.test(name) || name.startsWith('.')) fail('图片文件名无效');
    if (typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64) || body.base64.length > 2800000) fail('图片数据无效或过大');
    const bytes = Buffer.from(body.base64, 'base64'); validateImage(name, bytes);
    const directory = path.join(root, 'assets');
    try { await checkedResolve('assets'); } catch (error) { if (error.code !== 'ENOENT') throw error; await fs.mkdir(directory); }
    const file = await checkedResolve('assets/' + name, { create: true });
    await atomicWrite(file, bytes, true);
    sendJson(res, 201, { path: 'assets/' + name }); return true;
  }
  return false;
}
module.exports = { handleWorkspaceTools, validateImage };

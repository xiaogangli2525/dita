'use strict';
const path = require('node:path'), { randomUUID } = require('node:crypto');
const { createRepositoryAccess } = require('./knowledge-repository');
const { createMapReader } = require('./map-reader');
const { parseXml } = require('./xml-tree');
const { readJson, sendJson } = require('./http-utils');
const { includesTopic } = require('../public/knowledge-plan');
const { createManualService } = require('../public/manual-service');
const { encoder } = require('./knowledge-semantic');
const { PROFILE } = require('../public/knowledge-semantic');
const domain = require('../public/manual-core'), rules = require('../public/note-rules-core');
const refs = require('../public/publication-resolver'), xml = require('../public/xml-source');
const fail = (message, status = 400) => Object.assign(Error(message), { status });
function mapper(reader) {
  return createMapReader((from, href) => {
    const target = refs.localTarget(href, from).path;
    if (reader.inventory.has(target)) return target;
    const directory = path.posix.dirname(target), name = path.posix.basename(target);
    const candidates = [...reader.inventory.keys()].filter(item => (directory === '.' || item.startsWith(directory + '/')) && path.posix.basename(item) === name);
    if (candidates.length > 1) throw fail('引用匹配多个文件，请修正路径：' + href);
    return candidates[0] || target;
  });
}
function createKnowledgeHandler({ workspace, git, demoMode }) {
  const access = createRepositoryAccess({ git, getRoot: () => workspace.root }); let running = 0;
  async function catalog(selection) {
    const reader = await access.open(selection), maps = [], filters = [];
    for (const name of [...reader.inventory.keys()].sort()) {
      if (/\.ditamap$/i.test(name)) maps.push({ path: name, title: path.posix.basename(name) });
      if (/\.ditaval$/i.test(name)) filters.push(name);
    }
    if (!maps.length) for (const name of reader.inventory.keys()) if (/\.(dita|xml)$/i.test(name)) maps.push({ path: name, title: path.posix.basename(name) });
    const entry = selection.entryPath;
    if (reader.inventory.has(entry) && /\.(dita|xml)$/i.test(entry) && !maps.some(map => map.path === entry)) {
      maps.push({ path: entry, title: path.posix.basename(entry) });
    }
    return { root: reader.root, branch: reader.branch, revision: reader.revision, commit: reader.commit, dirty: (await reader.provenance()).dirty, refs: await reader.refs(), maps, filters };
  }
  async function capture(body) {
    const reader = await access.open(body), mapReader = mapper(reader);
    const projectContent = await reader.text('.dita-project.json', true), rulesContent = await reader.text('.dita-note-rules.json', true);
    let project = { schema: 1, models: [] }, projectError;
    try { if (projectContent != null) project = domain.validateProject(JSON.parse(projectContent)); } catch (cause) { projectError = '项目配置无效：' + cause.message; }
    let config = { schema: 1, rules: [] }, rulesError;
    try { if (rulesContent != null) config = rules.validate(JSON.parse(rulesContent)); } catch (cause) { rulesError = '注脚规则无效：' + cause.message; }
    const noteRules = { config, expectedContent: rulesContent, supported: true, ...(rulesError ? { error: rulesError } : {}) }, texts = new Map();
    const api = { token: randomUUID(), error: response => response.text(), async request(url, options) {
      const parsed = new URL(url, 'http://snapshot.invalid');
      if (parsed.pathname === '/api/map/resolve') { const value = JSON.parse(options.body); return Response.json(mapReader.describe(parseXml(value.content).root, value.path)); }
      if (parsed.pathname !== '/api/file') throw fail('不支持的快照请求');
      const name = parsed.searchParams.get('path'), text = await reader.text(name); texts.set(name, text); return new Response(text);
    } };
    const service = createManualService({ state: { root: reader.root, currentBranch: reader.branch, activePath: body.path, selectedMap: body.path, filesMap: new Map() }, api,
      project: { value: project, expectedContent: projectContent, error: projectError },
      noteRuleStore: { current: () => true, read: async () => noteRules, verify: async () => {} } });
    const snapshot = await service.capture(body.path, { filterPath: body.filterPath || '', includeTopic: includesTopic });
    const prepared = service.prepare(snapshot, body.model || '', true, { prefixes: !!body.prefixes }), assets = new Map();
    const imageSources = domain.collectPreviewPaths(snapshot.map.children || []).flatMap(entry => { const file = prepared.files.get(entry.path); return file && !file.excluded ? [{ path: entry.path, content: file.current }] : []; });
    imageSources.push(...prepared.notes.map(note => ({ path: note.path, content: note.xml })));
    for (const entry of imageSources) {
      const images = []; refs.walk(xml.inspectSource(entry.content), node => { if (node.name === 'image' && node.attrs.href) images.push(refs.decode(node.attrs.href)); });
      for (const href of images) {
        if (/^data:image\//i.test(href)) continue;
        const name = refs.localTarget(href.split('?')[0], entry.path).path; if (assets.has(name)) continue;
        if (!/\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(name)) throw fail('图片格式不受支持：' + name);
        assets.set(name, (await reader.read(name)).toString('base64'));
      }
    }
    const provenance = await reader.provenance();
    await reader.assertCurrent();
    return { schema: 1, snapshot: { ...snapshot, files: [...snapshot.files], buffers: [] }, texts: [...texts], assets: [...assets], provenance, receipt: reader.receipt() };
  }
  return async function handle(req, res, pathname) {
    if (!pathname.startsWith('/api/knowledge/')) return false;
    if (demoMode) throw fail('演示环境不提供多仓库读取，请在本地工作台使用', 403);
    if (req.method !== 'POST') throw fail('Method not allowed', 405);
    const body = await readJson(req, pathname === '/api/knowledge/chunks' ? 64 * 1024 * 1024 : undefined); if (!body || Array.isArray(body) || typeof body !== 'object') throw fail('来源配置必须为对象');
    if (running >= 2) throw fail('已有两个来源正在核对，请稍后重试', 429);
    running++;
    try {
      let result;
      if (pathname === '/api/knowledge/chunks') {
        const record = body.record;
        if (!record || typeof record.text !== 'string' || record.text.length > 40 * 1024 * 1024 ||
          typeof record.manualId !== 'string' || typeof record.anchor !== 'string' ||
          typeof record.manualTitle !== 'string' || typeof record.title !== 'string' ||
          !Number.isInteger(body.position) || body.position < 0 || body.position > 100000) throw fail('语义片段来源无效');
        result = { profile: PROFILE.id, chunks: (await encoder.chunksFor([record])).map(chunk => ({ ...chunk, position: body.position })) };
      } else if (pathname === '/api/knowledge/embed') {
        if (body.profile !== PROFILE.id) throw fail('向量编码配置已更新，请刷新工作台后重新发布');
        result = { profile: PROFILE.id, vectors: await encoder.encode(body.texts) };
      } else if (pathname === '/api/knowledge/catalog') result = await catalog(body);
      else if (pathname === '/api/knowledge/capture') result = await capture(body);
      else if (pathname === '/api/knowledge/verify') result = await access.verify(body);
      else throw fail('Not found', 404);
      sendJson(res, 200, result); return true;
    } finally { running--; }
  };
}
module.exports = { createKnowledgeHandler };

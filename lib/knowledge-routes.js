'use strict';
const { aborted } = require('./abort');
const path = require('node:path'), { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { createRepositoryAccess } = require('./knowledge-repository');
const { createMapReader } = require('./map-reader');
const { parseXml } = require('./xml-tree');
const { readJson, sendJson } = require('./http-utils');
const { includesTopic } = require('../public/knowledge/knowledge-plan');
const { createManualService } = require('../public/manual-service');
const { encoder } = require('./knowledge-semantic');
const { defaultBuilder } = require('./knowledge-index');
const { PROFILE, LEGACY_PROFILE } = require('../public/knowledge/knowledge-semantic');
const domain = require('../public/manual-core'), rules = require('../public/note-rules-core');
const refs = require('../public/publication-resolver'), xml = require('../public/xml-source');
const fail = (message, status = 400) => Object.assign(Error(message), { status });
function createKnowledgeHandler({ workspace, git, demoMode, indexBuilder = defaultBuilder }) {
  const access = createRepositoryAccess({ git, getRoot: () => workspace.root }); let running = 0;
  async function catalog(selection, signal) {
    const reader = await access.open(selection, { signal }), maps = [], filters = [];
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
  async function capture(body, signal) {
    const reader = await access.open(body, { signal }), mapReader = createMapReader();
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
    const model = typeof body.model === 'string' ? body.model : '';
    const snapshot = await service.capture(body.path, { filterPath: body.filterPath || '', model, includeTopic: includesTopic });
    const prepared = service.prepare(snapshot, model, true, { prefixes: !!body.prefixes }), assets = new Map();
    const imageSources = prepared.entries.map(entry => ({ path: entry.path, content: prepared.files.get(entry.path).current }));
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
    const controller = new AbortController(), signal = controller.signal;
    const close = () => { if (!res.writableEnded) controller.abort(); };
    res.on?.('close', close); req.on?.('aborted', close);
    if (res.destroyed || req.aborted) controller.abort();
    let admitted = false;
    try {
      const body = await readJson(req, ['/api/knowledge/chunks', '/api/knowledge/semantic', '/api/knowledge/estimate', '/api/knowledge/publish'].includes(pathname) ? 64 * 1024 * 1024 : undefined);
      aborted(signal);
      if (!body || Array.isArray(body) || typeof body !== 'object') throw fail('来源配置必须为对象');
      if (running >= 2) throw fail('已有两个来源正在核对，请稍后重试', 429);
      running++; admitted = true;
      let result;
      if (['/api/knowledge/semantic', '/api/knowledge/estimate', '/api/knowledge/publish'].includes(pathname)) {
        if (body.profile !== PROFILE.id || typeof body.model !== 'string' || body.model.length > 80 ||
            (body.force !== undefined && typeof body.force !== 'boolean') || (body.compact !== undefined && typeof body.compact !== 'boolean')) throw fail('向量编码配置无效，请刷新工作台后重试');
        const builder = indexBuilder(), estimating = pathname.endsWith('/estimate'), publishing = pathname.endsWith('/publish');
        if (estimating || publishing) {
          if (!Array.isArray(body.manuals) || !body.manuals.length || body.manuals.length > 30) throw fail('知识库手册数量无效');
          body.manuals.forEach(builder.recordsFor);
        } else builder.recordsFor(body.manual);
        const write = value => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value) + '\n'); };
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        try {
          const options = { model: body.model, force: body.force, compact: body.compact, signal: controller.signal, onProgress: progress => write({ type: 'progress', ...progress }) };
          const book = { model: body.model, manuals: body.manuals };
          const value = publishing ? await builder.publish(book, { ...options, archiveOverhead: body.archiveOverhead,
            onEstimate: estimate => write({ type: 'estimate', ...estimate }),
            onManual: async result => {
              aborted(signal);
              if (!res.write(JSON.stringify({ type: 'manual', ...result }) + '\n')) await once(res, 'drain', { signal });
            }
          }) : estimating ? await builder.estimate(book, options) : await builder.manual(body.manual, options);
          write({ type: 'result', ...value });
        } catch (cause) { if (cause.name !== 'AbortError') write({ type: 'error', message: cause.message }); }
        finally { if (!res.destroyed) res.end(); }
        return true;
      } else if (pathname === '/api/knowledge/chunks') {
        const record = body.record;
        if (!record || typeof record.text !== 'string' || record.text.length > 40 * 1024 * 1024 ||
          typeof record.manualId !== 'string' || typeof record.anchor !== 'string' ||
          typeof record.manualTitle !== 'string' || typeof record.title !== 'string' ||
          !Number.isInteger(body.position) || body.position < 0 || body.position > 100000) throw fail('语义片段来源无效');
        if (body.strategy && !['structure', 'legacy'].includes(body.strategy)) throw fail('分片方式无效');
        const legacy = body.strategy === 'legacy';
        result = { profile: (legacy ? LEGACY_PROFILE : PROFILE).id, chunks: (await encoder.chunksFor([record], { legacy, signal })).map(chunk => ({ ...chunk, position: body.position })) };
      } else if (pathname === '/api/knowledge/embed') {
        if (body.profile !== PROFILE.id) throw fail('向量编码配置已更新，请刷新工作台后重新发布');
        result = { profile: PROFILE.id, vectors: await encoder.encode(body.texts, false, { signal }) };
      } else if (pathname === '/api/knowledge/catalog') result = await catalog(body, signal);
      else if (pathname === '/api/knowledge/capture') result = await capture(body, signal);
      else if (pathname === '/api/knowledge/verify') result = await access.verify(body, { signal });
      else throw fail('Not found', 404);
      aborted(signal);
      if (!res.destroyed && !res.writableEnded) sendJson(res, 200, result);
      return true;
    } catch (cause) {
      if (signal.aborted) return true;
      throw cause;
    } finally {
      if (admitted) running--;
      res.removeListener?.('close', close); req.removeListener?.('aborted', close);
    }
  };
}
module.exports = { createKnowledgeHandler };

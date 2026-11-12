// @ts-check
'use strict';
(function (root) {
  const prefix = 'dita.knowledge.plan.v1:';
  /** @param {unknown} value @param {number} max @param {string} label */
  function text(value, max, label) { if (typeof value !== 'string' || value.length > max) throw new Error('发布方案字段无效：' + label); return value; }
  /** @param {unknown} value @param {string} label @returns {Record<string, unknown>} */
  function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('发布方案格式无效：' + label); return /** @type {Record<string, unknown>} */ (value); }
  /** @param {string} path */
  function relative(path) { if (!path || path.startsWith('/') || /[\\:]|(^|\/)\.\.(\/|$)/.test(path)) throw new Error('发布方案路径无效'); return path; }
  /** @param {unknown} input @returns {import('./knowledge-contracts').KnowledgePlan} */
  function normalizePlan(input) {
    const value = object(input, 'plan');
    if (value.schema !== 1 || !Array.isArray(value.sources) || value.sources.length > 30) throw new Error('不支持的发布方案或手册数量超过 30');
    const id = text(value.id, 100, 'id'); if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('发布方案标识无效');
    const keys = new Set();
    const sources = value.sources.map(raw => {
      const source = object(raw, 'source'), repositoryRoot = text(source.repositoryRoot, 1200, 'repositoryRoot');
      if (!repositoryRoot || /\0|:\/\//.test(repositoryRoot)) throw new Error('发布方案文档库目录无效');
      const path = relative(text(source.path, 1000, 'path')), key = JSON.stringify([repositoryRoot, path]);
      if (keys.has(key)) throw new Error('发布方案含重复手册'); keys.add(key);
      if (typeof source.prefixes !== 'boolean') throw new Error('发布方案注脚策略无效');
      const mode = source.mode || 'other'; if (!['other', 'OC', 'AT'].includes(String(mode))) throw new Error('发布方案开发方式无效');
      const overrides = Object.entries(object(source.overrides || {}, 'overrides'));
      if (overrides.length > 1000) throw new Error('检索属性数量过多');
      /** @type {Record<string, import('./knowledge-contracts').EntryOverride>} */
      const metadata = Object.create(null);
      for (const [name, rawMeta] of overrides) {
        relative(name); const meta = object(rawMeta, 'metadata'), kind = text(meta.kind, 20, 'kind');
        if (!['guide', 'reference', 'example', 'note'].includes(kind)) throw new Error('检索条目类型无效');
        const aliases = meta.aliases, defined = meta.definedSymbols;
        if (!Array.isArray(aliases) || aliases.length > 20 || !Array.isArray(defined) || defined.length > 80) throw new Error('检索别名或符号数量无效');
        metadata[name] = { fingerprint: text(meta.fingerprint, 64, 'fingerprint'), kind, aliases: aliases.map(x => text(x, 80, 'alias')),
          definedSymbols: defined.map(x => text(x, 100, 'symbol')) };
      }
      const revision = text(source.revision || '', 200, 'revision'); if (revision.startsWith('-') || /[\s\0]/.test(revision)) throw new Error('发布方案 Git 版本无效');
      const filterPath = text(source.filterPath, 1000, 'filterPath'); if (filterPath) relative(filterPath);
      let previous;
      if (source.previous) { const old = object(source.previous, 'previous'); previous = { htmlSha256: text(old.htmlSha256, 64, 'htmlSha256'), capturedAt: text(old.capturedAt, 40, 'capturedAt') }; }
      return { repositoryRoot, path, repository: text(source.repository, 200, 'repository'), branch: text(source.branch, 200, 'branch'), title: text(source.title, 200, 'title'),
        ...(revision ? { revision } : {}), version: text(source.version, 80, 'version'), filterPath, prefixes: source.prefixes, mode: /** @type {'OC'|'AT'|'other'} */ (mode),
        module: text(source.module || '', 80, 'module'), overrides: metadata, ...(previous ? { previous } : {}) };
    });
    return { schema: 1, id, title: text(value.title, 160, 'title'), model: text(value.model, 80, 'model'), sdkVersion: text(value.sdkVersion, 80, 'sdkVersion'), sources };
  }
  /** @param {(import('./review-contracts').ReviewStorage & {readonly length: number, key(index: number): string|null}) | null} storage */
  function createPlanStore(storage) {
    /** @returns {{plan: import('./knowledge-contracts').KnowledgePlan, serialized: string}[]} */
    function list() {
      if (!storage) throw new Error('浏览器存储不可用，请导出方案 JSON 以保留配置');
      const items = [];
      for (let index = 0; index < storage.length; index++) {
        const name = storage.key(index); if (!name?.startsWith(prefix)) continue;
        const serialized = storage.getItem(name); if (serialized == null) continue;
        const plan = normalizePlan(JSON.parse(serialized)); if (name !== prefix + plan.id) throw new Error('方案标识与存储不一致，原数据仍保留');
        items.push({ plan, serialized });
      }
      return items;
    }
    /** @param {import('./knowledge-contracts').KnowledgePlan} input @param {string | null} [expected] */
    function save(input, expected = null) {
      if (!storage) throw new Error('浏览器存储不可用，请导出方案 JSON');
      const plan = normalizePlan(input), entries = list(), current = storage.getItem(prefix + plan.id);
      if (current !== expected) throw new Error('方案已在其它窗口更新，请重新加载或另存新方案');
      const ids = [...new Set([...entries.map(item => item.plan.id), plan.id])]; if (ids.length > 20) throw new Error('最多保存 20 份方案，请选择已有方案更新');
      const serialized = JSON.stringify(plan); storage.setItem(prefix + plan.id, serialized);
      return serialized;
    }
    return { list, save };
  }
  const api = { normalizePlan, createPlanStore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgePlan = api;
})(typeof window === 'undefined' ? globalThis : window);

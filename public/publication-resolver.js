'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const sax = typeof module !== 'undefined' ? require('./vendor/sax') : root.sax;
  const mapContext = typeof module !== 'undefined' ? require('./map-context') : root.DitaMapContext;
  const manual = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const topics = new Set(['topic', 'concept', 'task', 'reference']);
  function decode(value = '') { let out = ''; const p = sax.parser(true); p.ontext = s => { out += s; }; p.write('<v>' + value + '</v>').close(); return out; }
  const escape = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  function localTarget(href, path) {
    const hash = href.indexOf('#');
    const raw = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
    // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted input.
    if (/^[a-z][a-z\d+.-]*:|^[/\\]|[\\?\x00-\x1f]/i.test(raw)) throw new Error('仅支持工作区内的相对引用：' + href);
    const parts = raw ? path.split('/').slice(0, -1) : [];
    if (raw) for (const part of raw.split('/')) {
      if (part === '..') { if (!parts.length) throw new Error('引用超出工作区：' + href); parts.pop(); }
      else if (part && part !== '.') parts.push(part);
    }
    return { path: raw ? parts.join('/') : path, fragment: hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1)) };
  }
  function walk(node, visit, ancestors = []) {
    visit(node, ancestors);
    for (const child of node.children) if (child.kind === 'element') walk(child, visit, [...ancestors, node]);
  }
  function dependencies(source, path, profile, { deferInvalidConrefs = false } = {}) {
    const found = new Set();
    function visit(node) {
      if (profile && !profile.keep(node)) return;
      const href = node.attrs.conref || (node.name === 'xref' && decode(node.attrs.type) === 'fn' ? node.attrs.href : '');
      if (href) {
        try { found.add(localTarget(decode(href), path).path); }
        catch (error) {
          if (!deferInvalidConrefs || !node.attrs.conref) throw error;
          // Let the publication check report this source location. Never read the invalid target.
        }
      }
      node.children.filter(child => child.kind === 'element').forEach(visit);
    }
    visit(xml.inspectSource(source));
    return [...found];
  }
  async function loadDependencies(files, read, profile, options) {
    const loaded = new Map(files), requested = new Set(loaded.keys());
    let size = 0;
    for (const [path, file] of loaded) {
      size += file.current.length;
      if (loaded.size > 128 || size > 8 * 1024 * 1024) throw new Error('发布依赖超过限制（128 个文件／8 MiB 文本）');
      try {
        for (const dependency of dependencies(file.current, path, profile, options)) if (!requested.has(dependency)) {
          requested.add(dependency);
          const current = await read(dependency);
          if (current != null) loaded.set(dependency, { path: dependency, current });
        }
      } catch (e) { throw new Error(path + '：' + e.message, { cause: e }); }
    }
    return loaded;
  }
  function inspectMap(source, model, profile) {
    const excluded = new Set(); let filteredBranches = 0;
    function visit(node, sourcePath, parent) {
      const profileAllowed = !profile || profile.keep(node);
      const modelAllowed = !profileAllowed || (sourcePath && !mapContext.isReference(node.name)) || !node.attrs.product || manual.matches([decode(node.attrs.product)], model, profile);
      if (!profileAllowed || !modelAllowed) {
        if (!sourcePath) throw new Error(profileAllowed ? '当前型号不适用于整个手册：' + model : 'DITAVAL 排除了整个手册，请检查过滤规则');
        excluded.add(sourcePath);
        if (!modelAllowed && mapContext.isReference(node.name)) filteredBranches++;
        return;
      }
      const context = mapContext.inherit(node.attrs, parent, decode);
      const external = context.scope === 'external';
      const localSubmap = !external && (/ditamap/i.test(decode(node.attrs.format)) || /\.ditamap(?:#|$)/i.test(decode(node.attrs.href)));
      if (['mapref', 'ditavalref', 'keydef'].includes(node.name) || node.attrs.conref || node.attrs.conkeyref || node.attrs.keyref || node.attrs.keys || node.attrs.keyscope || localSubmap) throw new Error('Map 包含暂未支持的复用／键或子 Map，请先用完整 DITA 工具展开');
      if (model && !profile && (node.attrs.props || node.attrs.otherprops)) throw new Error('Map 的 props／otherprops 请使用 DITAVAL 明确交付条件');
      if (!external && node.attrs.href && decode(node.attrs.href).includes('#')) throw new Error('暂不支持 Map 引用指定 Topic 片段，请使用单 Topic 文件');
      node.children.filter(child => child.kind === 'element').forEach((child, index) => visit(child, sourcePath ? sourcePath + '.' + index : String(index), context));
    }
    if (source) visit(xml.inspectSource(source), '', undefined);
    return { excluded, filteredBranches };
  }
  function validateMap(source, model) { inspectMap(source, model); }
  function planMap(map, model, profile) {
    const { excluded, filteredBranches } = inspectMap(map.source, model, profile);
    function children(entries) {
      return entries.flatMap(entry => {
        if (typeof entry.sourcePath !== 'string') throw new Error('无法匹配 Map 引用位置，请重新打开手册再交付');
        let sourcePath = entry.sourcePath;
        while (sourcePath) {
          if (excluded.has(sourcePath)) return [];
          sourcePath = sourcePath.slice(0, Math.max(0, sourcePath.lastIndexOf('.')));
        }
        return [{ ...entry, children: children(entry.children || []) }];
      });
    }
    return { children: excluded.size ? children(map.children || []) : map.children || [], filteredBranches, filtered: excluded.size > 0 };
  }
  function scopeFiles(files, plan, profile) {
    if (!plan.filtered) return files;
    const scoped = new Map();
    function add(path) { if (files.has(path) && !scoped.has(path)) scoped.set(path, files.get(path)); }
    function include(entries) {
      for (const entry of entries) {
        if (entry.type === 'file' && /\.(dita|xml)$/i.test(entry.path)) add(entry.path);
        include(entry.children || []);
      }
    }
    include(plan.children);
    for (const [path, file] of scoped) {
      try { dependencies(file.current, path, profile, { deferInvalidConrefs: true }).forEach(add); }
      catch (error) { throw new Error(path + '：' + error.message, { cause: error }); }
    }
    return scoped;
  }
  function resolveConrefsDetailed(files, profile) {
    const documents = new Map(), output = new Map(), origins = new Map(), sites = new Map();
    const issues = new Map(), maxIssues = 100;
    let omittedIssues = false;
    let activeOrigins = [], activeSites = [];
    function indexIds(tree, path) {
      const ids = new Map();
      walk(tree, (node, ancestors) => {
        const topic = [...ancestors, node].reverse().find(n => topics.has(n.name));
        const id = decode(node.attrs.id);
        if (id) {
          const key = topics.has(node.name) ? id : decode(topic?.attrs.id) + '/' + id;
          if (ids.has(key)) throw new Error(path + '：重复的元素 ID：' + key);
          ids.set(key, node);
        }
      });
      return ids;
    }
    for (const [path, file] of files) {
      const tree = xml.inspectSource(file.current), ids = indexIds(tree, path);
      documents.set(path, { source: file.current, tree, ids });
    }
    function rebase(href, from, to) {
      if (from === to || !href || /^[a-z][a-z\d+.-]*:|^\//i.test(href)) return href;
      const target = localTarget(href, from), base = to.split('/').slice(0, -1), parts = target.path.split('/');
      while (base.length && parts.length && base[0] === parts[0]) { base.shift(); parts.shift(); }
      return [...base.map(() => '..'), ...parts].map(encodeURIComponent).join('/') + (target.fragment ? '#' + target.fragment : '');
    }
    function referenceProblem(path, node, message) {
      const { source } = documents.get(path);
      const key = path + '\n' + node.start;
      if (!issues.has(key)) {
        if (issues.size < maxIssues) issues.set(key, { path, message, location: { source, start: node.start, end: node.end } });
        else omittedIssues = true;
      }
      // Continue through siblings to collect diagnostics. This partial result is never published.
      return source.slice(node.start, node.close?.end ?? node.end);
    }
    let expansions = 0;
    function render(node, origin, destination, chain = []) {
      const doc = documents.get(origin);
      if (profile && !profile.keep(node)) {
        // Leave excluded source intact until the publication pass removes it.
        // Provenance arrays must still line up with its fn/xref source nodes.
        walk(node, child => {
          if (child.name === 'fn') activeOrigins.push({ path: origin, start: child.start });
          if (child.name === 'fn' || child.name === 'xref' && decode(child.attrs.type) === 'fn') activeSites.push({ path: origin, start: child.start, name: child.name });
        });
        return doc.source.slice(node.start, node.close?.end ?? node.end);
      }
      for (const attr of ['conkeyref', 'conrefend', 'conaction', 'keyref', 'xml:base']) if (node.attrs[attr] != null) {
        return referenceProblem(origin, node, '暂未支持 ' + attr + '，请先展开后再发布');
      }
      let attrs = node.attrs, children = node.children, childOrigin = origin, source = doc.source;
      if (attrs.conref != null) {
        let target;
        try { target = localTarget(decode(attrs.conref), origin); }
        catch (error) { return referenceProblem(origin, node, '内容引用无效：' + error.message); }
        const key = target.path + '#' + target.fragment;
        if (chain.includes(key) || chain.length >= 24) return referenceProblem(origin, node, '内容引用循环或层级过深：' + key);
        const targetDoc = documents.get(target.path);
        if (!targetDoc) return referenceProblem(origin, node, '无法读取内容引用：' + target.path);
        const targetNode = target.fragment ? targetDoc.ids.get(target.fragment) : targetDoc.tree;
        if (!targetNode) return referenceProblem(origin, node, '内容引用目标不存在：' + key);
        if (targetNode.name !== node.name) return referenceProblem(origin, node, '内容引用的元素类型不匹配（<' + node.name + '> → <' + targetNode.name + '>）：' + key);
        if (++expansions > 1024) throw new Error('内容引用展开超过 1024 次');
        const firstSite = activeSites.length;
        const resolved = render(targetNode, target.path, destination, [...chain, key]);
        // Keep the visible source occurrence separate from the reused definition.
        // A block conref has no individually editable child markers in Author.
        for (let i = firstSite; i < activeSites.length; i++) activeSites[i] = { path: origin, start: node.start, name: node.name };
        const resolvedNode = xml.inspectSource(resolved);
        attrs = { ...resolvedNode.attrs };
        delete attrs.id;
        for (const [name, value] of Object.entries(node.attrs)) {
          if (name !== 'conref' && decode(value) !== '-dita-use-conref-target') attrs[name] = name === 'href' ? escape(rebase(decode(value), origin, destination)) : value;
        }
        delete attrs.conref;
        const start = '<' + node.name + Object.entries(attrs).map(([k, v]) => ' ' + k + '="' + escape(decode(v)) + '"').join('') + '>';
        return start + (resolvedNode.close ? resolved.slice(resolvedNode.end, resolvedNode.close.start) : '') + '</' + node.name + '>';
      }
      if (node.name === 'fn') activeOrigins.push({ path: origin, start: node.start });
      if (node.name === 'fn' || node.name === 'xref' && decode(node.attrs.type) === 'fn') activeSites.push({ path: origin, start: node.start, name: node.name });
      let opening = source.slice(node.start, node.end);
      if (origin !== destination && attrs.href) {
        if (node.name === 'xref' && decode(attrs.href).startsWith('#')) return referenceProblem(origin, node, '复用片段中的同文件链接需先显式展开，避免目标 ID 重定位错误');
        const value = escape(rebase(decode(attrs.href), origin, destination));
        opening = opening.replace(/(\shref\s*=\s*)(["'])[\s\S]*?\2/, (_, prefix) => prefix + '"' + value + '"');
      }
      if (!node.close) return opening;
      let content = '';
      for (const child of children) {
        content += child.kind === 'element' ? render(child, childOrigin, destination, chain) : source.slice(child.start, child.end);
        if (content.length > 4 * 1024 * 1024) throw new Error('展开后的 Topic 超过 4 MiB');
      }
      return opening + content + source.slice(node.close.start, node.close.end);
    }
    for (const [path, file] of files) {
      const doc = documents.get(path);
      activeOrigins = [];
      activeSites = [];
      try {
        const content = doc.source.slice(0, doc.tree.start) + render(doc.tree, path, path) + doc.source.slice(doc.tree.close?.end ?? doc.tree.end);
        if (content.length > 4 * 1024 * 1024) throw new Error('展开后的 Topic 超过 4 MiB');
        if (!issues.size) {
          indexIds(xml.inspectSource(content), path);
          output.set(path, { ...file, current: content }); origins.set(path, activeOrigins); sites.set(path, activeSites);
        }
      } catch (e) { throw new Error(path + '：' + e.message, { cause: e }); }
    }
    if (issues.size) {
      const found = [...issues.values()], first = found[0];
      const summary = omittedIssues ? '仅列出前 ' + maxIssues + ' 处问题。' : found.length + ' 处引用或复用问题需要处理。';
      throw Object.assign(new Error((found.length > 1 ? summary : '') + first.path + '：' + first.message), { issues: found });
    }
    return { files: output, origins, sites };
  }
  function resolveConrefs(files) { return resolveConrefsDetailed(files).files; }
  const api = { decode, escape, walk, localTarget, dependencies, loadDependencies, resolveConrefs, resolveConrefsDetailed, validateMap, planMap, scopeFiles };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaPublicationResolver = api;
})(typeof window === 'undefined' ? globalThis : window);

'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const sax = typeof module !== 'undefined' ? require('./vendor/sax') : root.sax;
  const topics = new Set(['topic', 'concept', 'task', 'reference']);
  function decode(value = '') { let out = ''; const p = sax.parser(true); p.ontext = s => { out += s; }; p.write('<v>' + value + '</v>').close(); return out; }
  const escape = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  function localTarget(href, path) {
    const hash = href.indexOf('#');
    const raw = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
    if (/^[a-z][a-z\d+.-]*:|^[\/\\]|[\\?\x00-\x1f]/i.test(raw)) throw new Error('仅支持工作区内的相对引用：' + href);
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
  function dependencies(source, path) {
    const found = new Set();
    walk(xml.inspectSource(source), node => {
      const href = node.attrs.conref || (node.name === 'xref' && decode(node.attrs.type) === 'fn' ? node.attrs.href : '');
      if (href) found.add(localTarget(decode(href), path).path);
    });
    return [...found];
  }
  async function loadDependencies(files, read) {
    const loaded = new Map(files);
    let size = 0;
    for (const [path, file] of loaded) {
      size += file.current.length;
      if (loaded.size > 128 || size > 8 * 1024 * 1024) throw new Error('发布依赖超过限制（128 个文件／8 MiB 文本）');
      try {
        for (const dependency of dependencies(file.current, path)) if (!loaded.has(dependency)) {
          loaded.set(dependency, { path: dependency, current: await read(dependency) });
        }
      } catch (e) { throw new Error(path + '：' + e.message); }
    }
    return loaded;
  }
  function validateMap(source, model) {
    if (!source) return;
    walk(xml.inspectSource(source), node => {
      if (['mapref', 'ditavalref', 'keydef'].includes(node.name) || node.attrs.conref || node.attrs.conkeyref || node.attrs.keyref || node.attrs.keys || node.attrs.keyscope || /ditamap/i.test(decode(node.attrs.format)) || /\.ditamap(?:#|$)/i.test(decode(node.attrs.href))) throw new Error('Map 包含暂未支持的复用／键或子 Map，请先用完整 DITA 工具展开');
      if (model && (node.attrs.product || node.attrs.props || node.attrs.otherprops)) throw new Error('Map 级型号条件尚未展开，请先使用 Topic 内的注脚条件或完整 DITA 发布工具');
      if (node.attrs.href && decode(node.attrs.href).includes('#')) throw new Error('暂不支持 Map 引用指定 Topic 片段，请使用单 Topic 文件');
    });
  }
  function resolveConrefs(files) {
    const documents = new Map(), output = new Map();
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
    let expansions = 0;
    function render(node, origin, destination, chain = []) {
      const doc = documents.get(origin);
      for (const attr of ['conkeyref', 'conrefend', 'conaction', 'keyref', 'xml:base']) if (node.attrs[attr] != null) throw new Error(origin + '：暂未支持 ' + attr + '，请先展开后再发布');
      let attrs = node.attrs, children = node.children, childOrigin = origin, source = doc.source;
      if (attrs.conref != null) {
        const target = localTarget(decode(attrs.conref), origin);
        const key = target.path + '#' + target.fragment;
        if (chain.includes(key) || chain.length >= 24) throw new Error(origin + '：内容引用循环或层级过深：' + key);
        if (++expansions > 1024) throw new Error('内容引用展开超过 1024 次');
        const targetDoc = documents.get(target.path);
        if (!targetDoc) throw new Error(origin + '：无法读取内容引用：' + target.path);
        const targetNode = target.fragment ? targetDoc.ids.get(target.fragment) : targetDoc.tree;
        if (!targetNode || targetNode.name !== node.name) throw new Error(origin + '：内容引用目标不存在或元素类型不匹配：' + key);
        const resolved = render(targetNode, target.path, destination, [...chain, key]);
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
      let opening = source.slice(node.start, node.end);
      if (origin !== destination && attrs.href) {
        if (node.name === 'xref' && decode(attrs.href).startsWith('#')) throw new Error(origin + '：复用片段中的同文件链接需先显式展开，避免目标 ID 重定位错误');
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
      try {
        const content = doc.source.slice(0, doc.tree.start) + render(doc.tree, path, path) + doc.source.slice(doc.tree.close?.end ?? doc.tree.end);
        if (content.length > 4 * 1024 * 1024) throw new Error('展开后的 Topic 超过 4 MiB');
        indexIds(xml.inspectSource(content), path);
        output.set(path, { ...file, current: content });
      } catch (e) { throw new Error(path + '：' + e.message); }
    }
    return output;
  }
  const api = { decode, escape, walk, localTarget, dependencies, loadDependencies, resolveConrefs, validateMap };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaPublicationResolver = api;
})(typeof window === 'undefined' ? globalThis : window);

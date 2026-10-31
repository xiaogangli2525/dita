'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const sax = typeof module !== 'undefined' ? require('./vendor/sax') : root.sax;
  function decode(value = '') { let result = ''; const p = sax.parser(true); p.ontext = v => { result += v; }; p.write('<v>' + value + '</v>').close(); return result; }
  const topicTags = new Set(['topic', 'concept', 'task', 'reference']);
  function normalize(path) {
    const parts = [];
    for (const part of path.split('/')) {
      if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  }
  function referenceKey(href, path, topicId) {
    const hash = href.indexOf('#');
    if (hash < 0) throw new Error('注脚引用缺少 #TopicID/注脚ID：' + href);
    const file = decodeURIComponent(href.slice(0, hash));
    if (file && normalize(path.split('/').slice(0, -1).concat(file).join('/')) !== normalize(path)) throw new Error('暂不支持跨 Topic 注脚引用：' + href);
    const fragment = decodeURIComponent(href.slice(hash + 1));
    if (!/^[^/]+\/[^/]+$/.test(fragment)) throw new Error('注脚引用须使用 #TopicID/注脚ID：' + href);
    return fragment;
  }
  function prepareTopic(source, path, model = '') {
    const tree = xml.inspectSource(source), notes = [], refs = [];
    function walk(node, topicId = '', insideNote = false) {
      if (topicTags.has(node.name)) topicId = decode(node.attrs.id);
      if (node.name === 'fn') {
        if (insideNote) throw new Error('注脚不能包含嵌套注脚');
        const products = decode(node.attrs.product).trim();
        if (model && /[()]/.test(products)) throw new Error('型号导出暂不支持分组 product 条件，请使用空格分隔的型号');
        notes.push({ node, key: node.attrs.id ? topicId + '/' + decode(node.attrs.id) : '',
          allowed: !model || !products || products.split(/\s+/).includes(model), unmarked: !products });
        insideNote = true;
      }
      if (node.name === 'xref' && decode(node.attrs.type) === 'fn') {
        if (insideNote) throw new Error('暂不支持注脚内再次引用注脚');
        refs.push({ node, key: referenceKey(decode(node.attrs.href), path, topicId) });
      }
      node.children.filter(child => child.kind === 'element').forEach(child => walk(child, topicId, insideNote));
    }
    walk(tree);
    const definitions = new Map(), used = new Set(), removals = [];
    const remove = node => removals.push([node.start, node.close?.end ?? node.end]);
    for (const note of notes) if (note.key) {
      if (definitions.has(note.key)) throw new Error('重复的注脚 ID：' + note.key);
      definitions.set(note.key, note);
    }
    for (const ref of refs) {
      const target = definitions.get(ref.key);
      if (!target) throw new Error('找不到注脚引用：' + ref.key);
      if (!target.allowed) remove(ref.node); else used.add(ref.key);
    }
    let excluded = 0, unmarked = 0, included = 0, unused = 0;
    for (const note of notes) {
      if (!note.allowed) { remove(note.node); excluded++; }
      else if (note.key && !used.has(note.key)) { remove(note.node); unused++; }
      else {
        if (note.node.attrs.conref || note.node.attrs.conkeyref) throw new Error('发布前需要解析内容引用注脚，请先在引用源展开内容');
        included++; if (note.unmarked) unmarked++;
      }
    }
    let content = source;
    for (const [start, end] of removals.sort((a, b) => b[0] - a[0])) content = content.slice(0, start) + content.slice(end);
    xml.validateXml(content);
    return { content, report: { model, excluded, unmarked, included, unused } };
  }
  function preparePublication({ map, files, model = '' }, collectPaths) {
    const prepared = new Map(), report = { model, excluded: 0, unmarked: 0, included: 0, unused: 0 };
    for (const entry of collectPaths(map.children || [])) {
      const file = files.get(entry.path);
      if (!file) throw new Error('无法读取：' + entry.path);
      try {
        const result = prepareTopic(file.current, entry.path, model);
        prepared.set(entry.path, { ...file, current: result.content });
        for (const key of ['excluded', 'unmarked', 'included', 'unused']) report[key] += result.report[key];
      } catch (e) { throw new Error(entry.path + '：' + e.message); }
    }
    return { files: prepared, report };
  }
  const api = { prepareTopic, preparePublication, referenceKey };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaPublication = api;
})(typeof window === 'undefined' ? globalThis : window);

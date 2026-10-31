'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const resolver = typeof module !== 'undefined' ? require('./publication-resolver') : root.DitaPublicationResolver;
  const { decode, walk, localTarget } = resolver;
  const topicTags = new Set(['topic', 'concept', 'task', 'reference']);
  function referenceKey(href, path) {
    const target = localTarget(href, path);
    if (!/^[^/]+\/[^/]+$/.test(target.fragment)) throw new Error('注脚引用须使用 #TopicID/注脚ID：' + href);
    return target.path + '#' + target.fragment;
  }
  function preparePublication({ map, files, model = '' }, collectPaths) {
    resolver.validateMap(map.source, model);
    const expanded = resolver.resolveConrefs(files);
    const published = new Set(collectPaths(map.children || []).map(entry => entry.path));
    const records = new Map(), definitions = new Map(), used = new Set(), referenced = new Set();
    const report = { model, excluded: 0, unmarked: 0, included: 0, unused: 0 };
    for (const path of published) if (!expanded.has(path)) throw new Error('无法读取：' + path);
    for (const [path, file] of expanded) {
      const notes = [], refs = [], removals = [], source = file.current;
      const tree = xml.inspectSource(source);
      try {
        walk(tree, (node, ancestors) => {
          const topic = [...ancestors, node].reverse().find(parent => topicTags.has(parent.name));
          const insideNote = ancestors.some(parent => parent.name === 'fn');
          if (node.name === 'fn') {
            if (insideNote) throw new Error('注脚不能包含嵌套注脚');
            // An excluded ancestor cannot be overridden by a matching child.
            // Only footnotes are filtered; body containers remain intact.
            const conditions = [...ancestors, node].map(parent => decode(parent.attrs.product).trim()).filter(Boolean);
            if (model && conditions.some(value => /[()]/.test(value))) throw new Error('型号导出暂不支持分组 product 条件，请使用空格分隔的型号');
            const note = { node, path, key: node.attrs.id ? path + '#' + decode(topic?.attrs.id) + '/' + decode(node.attrs.id) : '',
              allowed: !model || conditions.every(value => value.split(/\s+/).includes(model)), unmarked: !conditions.length };
            notes.push(note);
            if (note.key) { if (definitions.has(note.key)) throw new Error('重复的注脚 ID：' + note.key); definitions.set(note.key, note); }
          }
          if (node.name === 'xref' && decode(node.attrs.type) === 'fn') {
            if (insideNote) throw new Error('暂不支持注脚内再次引用注脚');
            refs.push({ node, key: referenceKey(decode(node.attrs.href), path) });
          }
        });
        records.set(path, { file, source, notes, refs, removals });
      } catch (e) { throw new Error(path + '：' + e.message); }
    }
    const remove = (record, node) => record.removals.push([node.start, node.close?.end ?? node.end]);
    for (const path of published) {
      const record = records.get(path);
      for (const ref of record.refs) {
        const target = definitions.get(ref.key);
        if (!target) throw new Error(path + '：找不到注脚引用：' + ref.key);
        referenced.add(ref.key);
        if (!target.allowed) remove(record, ref.node); else used.add(ref.key);
      }
    }
    const noteDefinitions = new Map(), prepared = new Map();
    for (const [path, record] of records) {
      const visible = published.has(path);
      for (const note of record.notes) {
        if (!note.allowed) { remove(record, note.node); if (visible || referenced.has(note.key)) report.excluded++; }
        else if (note.key && !used.has(note.key)) { remove(record, note.node); if (visible) report.unused++; }
        else if (visible || used.has(note.key)) {
          report.included++; if (note.unmarked) report.unmarked++;
          if (note.key) noteDefinitions.set(note.key, { path, xml: record.source.slice(note.node.start, note.node.close?.end ?? note.node.end) });
        }
      }
      let content = record.source;
      for (const [start, end] of record.removals.sort((a, b) => b[0] - a[0])) content = content.slice(0, start) + content.slice(end);
      xml.validateXml(content); prepared.set(path, { ...record.file, current: content });
    }
    return { files: prepared, report, noteDefinitions };
  }
  function prepareTopic(source, path, model = '') {
    const map = { children: [{ path }] }, files = new Map([[path, { current: source }]]);
    const data = preparePublication({ map, files, model }, nodes => nodes);
    return { content: data.files.get(path).current, report: data.report };
  }
  function listModels(files) {
    const models = new Set();
    for (const file of resolver.resolveConrefs(files).values()) walk(xml.inspectSource(file.current), node => {
      const value = decode(node.attrs.product);
      if (!/[()]/.test(value)) value.split(/\s+/).filter(Boolean).forEach(model => models.add(model));
    });
    return [...models].sort();
  }
  const api = { prepareTopic, preparePublication, referenceKey, listModels };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaPublication = api;
})(typeof window === 'undefined' ? globalThis : window);

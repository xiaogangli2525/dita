'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const manual = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const resolver = typeof module !== 'undefined' ? require('./publication-resolver') : root.DitaPublicationResolver;
  const discovery = typeof module !== 'undefined' ? require('./model-discovery') : root.DitaModelDiscovery;
  const { decode, walk, localTarget } = resolver;
  const topicTags = new Set(['topic', 'concept', 'task', 'reference']);
  function referenceKey(href, path) {
    const target = localTarget(href, path);
    if (!/^[^/]+\/[^/]+$/.test(target.fragment)) throw new Error('注脚引用须使用 #TopicID/注脚ID：' + href);
    return target.path + '#' + target.fragment;
  }
  function preparePublication({ map, files, model = '', profile }, collectPaths) {
    resolver.validateMap(map.source, model);
    const resolved = resolver.resolveConrefsDetailed(files, profile), expanded = resolved.files;
    const published = new Set(collectPaths(map.children || []).filter(entry => !profile || !expanded.has(entry.path) || profile.keep(xml.inspectSource(expanded.get(entry.path).current))).map(entry => entry.path));
    if (profile && !published.size) throw new Error('DITAVAL 排除了所有正文，请检查过滤规则和手册范围');
    const records = new Map(), definitions = new Map(), used = new Set(), referenced = new Set();
    const report = { model, excluded: 0, unmarked: 0, included: 0, unused: 0 };
    if (profile) report.filteredElements = 0;
    for (const path of published) if (!expanded.has(path)) throw new Error('无法读取：' + path);
    for (const [path, file] of expanded) {
      const notes = [], refs = [], sequence = [], removals = [], source = file.current;
      const tree = xml.inspectSource(source);
      const excludedRoot = Boolean(profile && !profile.keep(tree));
      try {
        walk(tree, (node, ancestors) => {
          const topic = [...ancestors, node].reverse().find(parent => topicTags.has(parent.name));
          const insideNote = ancestors.some(parent => parent.name === 'fn');
          const profileAllowed = !profile || [...ancestors, node].every(parent => profile.keep(parent));
          if (profile && !profile.keep(node) && ancestors.every(parent => profile.keep(parent))) {
            report.filteredElements++;
            if (!excludedRoot) removals.push([node.start, node.close?.end ?? node.end]);
          }
          if (node.name === 'fn') {
            if (insideNote) throw new Error('注脚不能包含嵌套注脚');
            // An excluded ancestor cannot be overridden by a matching child.
            // Model selection scopes notes; the explicit DITAVAL scopes all elements.
            const conditions = manual.conditions(node, ancestors);
            if (manual.common(node.attrs) && conditions.length) throw new Error('通用注脚与型号条件冲突，请检查注脚或祖先条件');
            if (profileAllowed && model && conditions.some(value => /[()]/.test(value))) throw new Error('型号导出暂不支持分组 product 条件，请使用空格分隔的型号');
            const note = { node, path, key: node.attrs.id ? path + '#' + decode(topic?.attrs.id) + '/' + decode(node.attrs.id) : '',
              conditions, common: manual.common(node.attrs), origin: resolved.origins.get(path)[notes.length],
              allowed: profileAllowed && manual.matches(conditions, model), unmarked: !conditions.length && !manual.common(node.attrs) };
            notes.push(note);
            sequence.push({ note, site: resolved.sites.get(path)[sequence.length], definition: Boolean(note.key) });
            if (note.key) { if (definitions.has(note.key)) throw new Error('重复的注脚 ID：' + note.key); definitions.set(note.key, note); }
          }
          if (node.name === 'xref' && decode(node.attrs.type) === 'fn') {
            if (insideNote) throw new Error('暂不支持注脚内再次引用注脚');
            const conditions = manual.conditions(node, ancestors);
            if (profileAllowed && model && conditions.some(value => /[()]/.test(value))) throw new Error('型号导出暂不支持分组 product 条件');
            const ref = { node, conditions, allowed: profileAllowed && manual.matches(conditions, model), key: profileAllowed ? referenceKey(decode(node.attrs.href), path) : '' };
            refs.push(ref); sequence.push({ ref, site: resolved.sites.get(path)[sequence.length] });
          }
        });
        records.set(path, { file, source, notes, refs, sequence, removals, excludedRoot });
      } catch (e) { throw new Error(path + '：' + e.message); }
    }
    const remove = (record, node) => record.removals.push([node.start, node.close?.end ?? node.end]);
    for (const path of published) {
      const record = records.get(path);
      for (const ref of record.refs) {
        if (!ref.allowed) { remove(record, ref.node); continue; }
        const target = definitions.get(ref.key);
        if (!target) throw new Error(path + '：找不到注脚引用：' + ref.key);
        referenced.add(ref.key);
        if (!target.allowed || !ref.allowed) remove(record, ref.node); else used.add(ref.key);
      }
    }
    const noteDefinitions = new Map(), prepared = new Map(), publicationNotes = new Map();
    for (const [path, record] of records) {
      const visible = published.has(path);
      for (const note of record.notes) {
        if (!note.allowed) { remove(record, note.node); if (visible || referenced.has(note.key)) report.excluded++; }
        else if (note.key && !used.has(note.key)) { remove(record, note.node); if (visible) report.unused++; }
        else if (visible || used.has(note.key)) {
          report.included++; if (note.unmarked) report.unmarked++;
          publicationNotes.set(note, { path, origin: note.origin, conditions: note.conditions, common: note.common, unmarked: note.unmarked, key: note.key, xml: record.source.slice(note.node.start, note.node.close?.end ?? note.node.end) });
          if (note.key) noteDefinitions.set(note.key, { path, xml: record.source.slice(note.node.start, note.node.close?.end ?? note.node.end) });
        }
      }
      let content = record.source;
      const ranges = [];
      for (const range of record.removals.sort((a, b) => a[0] - b[0] || b[1] - a[1])) {
        if (ranges.length && range[0] <= ranges.at(-1)[1]) ranges.at(-1)[1] = Math.max(range[1], ranges.at(-1)[1]);
        else ranges.push([...range]);
      }
      if (!record.excludedRoot) for (const [start, end] of ranges.reverse()) content = content.slice(0, start) + content.slice(end);
      xml.validateXml(content); prepared.set(path, { ...record.file, current: content, ...(record.excludedRoot ? { excluded: true } : {}) });
    }
    // First use owns the automatic number, as in HTML/Markdown delivery. A named
    // definition is numbered at its first xref, and all of its calls share it.
    const ordered = [], numbered = new Map(), occurrences = [];
    for (const path of published) for (const call of records.get(path).sequence) {
      if (call.ref && !call.ref.allowed) continue;
      const note = call.note || definitions.get(call.ref.key);
      if (!publicationNotes.has(note)) continue;
      if (!call.definition && !numbered.has(note)) {
        const item = { ...publicationNotes.get(note), number: ordered.length + 1 };
        item.label = decode(note.node.attrs.callout) || String(item.number);
        ordered.push(item); numbered.set(note, item);
      }
      occurrences.push({ ...call, target: note });
    }
    const calls = occurrences.filter(call => numbered.has(call.target)).map(call => ({ site: call.site, number: numbered.get(call.target).number, definition: Boolean(call.definition), conditions: [...call.target.conditions, ...(call.ref?.conditions || [])] }));
    // Source editors can open a resource-only definition while retaining Map scope.
    for (const item of ordered) calls.push({ site: { ...item.origin, name: 'fn' }, number: item.number, definition: Boolean(item.key), origin: true });
    return { files: prepared, report, noteDefinitions, notes: ordered, calls };
  }
  function prepareTopic(source, path, model = '') {
    const map = { children: [{ path }] }, files = new Map([[path, { current: source }]]);
    const data = preparePublication({ map, files, model }, nodes => nodes);
    return { content: data.files.get(path).current, report: data.report };
  }
  function listModels(files, profile) {
    return discovery.discover(resolver.resolveConrefsDetailed(files, profile).files, profile).models;
  }

  const api = { prepareTopic, preparePublication, referenceKey, listModels };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaPublication = api;
})(typeof window === 'undefined' ? globalThis : window);

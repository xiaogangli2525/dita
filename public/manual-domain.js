'use strict';
(function (root) {
  const resolver = typeof module !== 'undefined' ? require('./publication-resolver') : root.DitaPublicationResolver;
  const publication = typeof module !== 'undefined' ? require('./publication-core') : root.DitaPublication;
  const notesCore = typeof module !== 'undefined' ? require('./footnotes-core') : root.DitaFootnotesCore;
  const domain = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const profiling = typeof module !== 'undefined' ? require('./profiling-core') : root.DitaProfiling;
  const discovery = typeof module !== 'undefined' ? require('./model-discovery') : root.DitaModelDiscovery;
  const rulesCore = typeof module !== 'undefined' ? require('./note-rules-core') : root.DitaNoteRulesCore;

  // Snapshot-in, derived-data-out. No application state, DOM, IO or editor core.
  const profileOf = snapshot => snapshot.filter ? profiling.compile(snapshot.filter.current) : null;

  function discoverModels(snapshot, profile = profileOf(snapshot)) {
    return discovery.discover(resolver.resolveConrefsDetailed(snapshot.files, profile).files, profile);
  }

  function listModels(snapshot) {
    const configured = (snapshot.noteRules?.config.rules || [])
      .filter(rule => snapshot.files.has(rule.path))
      .flatMap(rule => rule.decisions.flatMap(part => part.models));
    return [...new Set([...discoverModels(snapshot).models, ...configured])].sort();
  }

  function projectIssues(snapshot, model, profile) {
    const issues = [];
    if (snapshot.noteRules?.error) issues.push({ path: '.dita-note-rules.json', message: snapshot.noteRules.error });
    if (snapshot.projectError) issues.push({ path: '.dita-project.json', message: snapshot.projectError });
    if (model && snapshot.project.models.length && !snapshot.project.models.includes(model)) {
      issues.push({ path: snapshot.path, message: '型号不在项目清单中：' + model });
    }
    for (const [path, file] of snapshot.files) {
      try {
        resolver.walk(xml.inspectSource(file.current), (node, ancestors) => {
          if (profile && [...ancestors, node].some(parent => !profile.keep(parent))) return;
          const value = domain.decode(node.attrs.product);
          if (/[()]/.test(value)) return;
          const unknown = domain.checkModels(value.split(/\s+/).filter(Boolean), snapshot.project);
          if (unknown.length) issues.push({ path, message: '未登记型号：' + unknown.join('、') });
        });
      } catch (error) { issues.push({ path, message: error.message }); }
    }
    return issues;
  }

  function prepare(snapshot, model = '', validateProject = true, { useRules = true, prefixes = false } = {}) {
    const profile = profileOf(snapshot);
    if (validateProject) {
      const issues = projectIssues(snapshot, model, profile);
      if (issues.length) throw Object.assign(new Error(issues.map(item => item.path + '：' + item.message).join('\n')), { issues });
    }
    const projection = useRules ? rulesCore.project(snapshot.files, snapshot.noteRules?.config, model, {
      prefixes, profile,
      knownModels: [...(snapshot.project.models || []), ...discoverModels(snapshot, profile).models]
    }) : { files: snapshot.files };
    if (projection.issues?.length) {
      const message = projection.issues.some(item => item.kind === 'model-scope') ?
        '有注脚的型号范围需要核对，请使用独立规则后再导出' : '注脚规则已过期，请重新核对后导出';
      throw Object.assign(new Error(message), { issues: projection.issues });
    }
    const result = publication.preparePublication({
      map: snapshot.map, files: projection.files, model, profile,
      ruleConfirmed: projection.confirmed, ruleExclusions: projection.excluded
    });
    Object.assign(result.report, {
      ruleApplied: projection.applied || 0,
      ruleFilteredParts: projection.filteredParts || 0,
      prefixCandidates: projection.prefixCandidates || 0,
      prefixApplied: projection.prefixApplied || 0,
      prefixExcluded: projection.prefixExcluded || 0
    });
    if (profile) result.report.filteredElements += projection.prefixProfileFiltered || 0;
    return result;
  }

  function sourceNotes(published, files) {
    const originals = new Map();
    return published.map((note, index) => {
      const origin = note.origin;
      if (!originals.has(origin.path)) originals.set(origin.path, notesCore.listFootnotes(files.get(origin.path).current, origin.path));
      const source = originals.get(origin.path).find(item => item.start === origin.start);
      if (!source) throw new Error('无法定位引用源：' + origin.path);
      const rendered = notesCore.listFootnotes(note.xml)[0];
      return {
        ...source, sourceNote: source, index, number: note.number, label: note.label,
        text: rendered.text, conditions: note.conditions, common: note.common, unmarked: note.unmarked,
        reused: Boolean(note.key) || note.path !== origin.path || source.referenced, publicationPath: note.path
      };
    });
  }

  function sourceLocations(files) {
    const locations = new Map();
    for (const [path, file] of files) {
      const nodes = new Map();
      function visit(node, indexes) {
        nodes.set(node.start, { xmlPath: indexes.join('/'), name: node.name });
        node.children.filter(child => child.kind === 'element').forEach((child, index) => visit(child, [...indexes, index]));
      }
      visit(xml.inspectSource(file.current), []);
      locations.set(path, nodes);
    }
    return locations;
  }

  function attachUsages(notes, calls, locations) {
    const bySource = new Map();
    // Block reuse counts as a use even when its individual markers cannot be
    // edited in place. A named definition is not an extra use.
    for (const call of calls) {
      if (call.origin || call.definition) continue;
      const note = notes[call.number - 1], location = locations.get(call.site.path)?.get(call.site.start);
      if (!note || !location || location.name !== call.site.name) continue;
      const sourceKey = note.path + '\n' + note.xmlPath, uses = bySource.get(sourceKey) || new Map();
      const id = call.site.path + '\n' + location.xmlPath;
      if (!uses.has(id)) uses.set(id, { path: call.site.path, xmlPath: location.xmlPath, label: note.label, conditions: call.conditions || note.conditions });
      bySource.set(sourceKey, uses);
    }
    for (const note of notes) note.usages = [...(bySource.get(note.path + '\n' + note.xmlPath)?.values() || [])];
  }

  function listNotes(snapshot, model = '') {
    const data = prepare(snapshot, model, false, { useRules: false });
    const notes = sourceNotes(data.notes, snapshot.files), locations = sourceLocations(snapshot.files);
    const calls = data.calls.flatMap(call => {
      const location = locations.get(call.site.path)?.get(call.site.start), note = notes[call.number - 1];
      return location && location.name === call.site.name && ['fn', 'xref'].includes(location.name) ?
        [{ ...call, path: call.site.path, xmlPath: location.xmlPath, note }] : [];
    });
    attachUsages(notes, data.calls, locations);
    return { notes, calls, models: publication.listModels(snapshot.files, profileOf(snapshot)), report: data.report };
  }

  function saveCandidates(snapshot) {
    const paths = new Set([snapshot.path, ...snapshot.files.keys(), ...(snapshot.filter ? [snapshot.filter.path] : [])]);
    return [...paths].map(path => snapshot.buffers.get(path)).filter(file => file?.dirty);
  }

  const api = { prepare, listNotes, saveCandidates, discoverModels, listModels };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaManualDomain = api;
})(typeof window === 'undefined' ? globalThis : window);

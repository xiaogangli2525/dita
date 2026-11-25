'use strict';
(function (root) {
  const oxygen = typeof module !== 'undefined' ? require('./oxygen-core') : root.DitaOxygenCore;
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
    let topics;
    try { topics = resolver.resolveConrefsDetailed(snapshot.files, profile).files; }
    catch { topics = snapshot.files; } // Expose declarations before publication reports unavailable reuse or branches.
    const files = new Map(topics);
    if (snapshot.map.source) files.set(snapshot.path || snapshot.map.path, { current: snapshot.map.source });
    return discovery.discover(files, profile);
  }

  function listModels(snapshot) {
    const configured = (snapshot.noteRules?.config.rules || [])
      .filter(rule => snapshot.files.has(rule.path))
      .flatMap(rule => rule.decisions.flatMap(part => part.models));
    return [...new Set([...discoverModels(snapshot).models, ...configured])].sort();
  }

  function revisionCheck(source, profile, tree) {
    const excluded = [];
    if (!source.includes('<?oxy_')) return { source, excluded, pending: false };
    let ranges;
    const changes = oxygen.collectOxyTrackedChanges(source, token => {
      if (!profile) return false;
      ranges ||= profile.excludedRanges(tree);
      let low = 0, high = ranges.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (ranges[mid][1] <= token.start) low = mid + 1; else high = mid;
      }
      const range = ranges[low];
      if (!range || token.start < range[0] || token.end > range[1]) return false;
      excluded.push({ containerStart: range[0], token });
      return true;
    });
    return { source, excluded, pending: changes.some(change => change.type !== 'comment' && change.id?.startsWith('dita-')) };
  }

  function projectIssues(snapshot, files, model, profile) {
    const issues = [];
    const excludedRevisions = new Map();
    if (snapshot.noteRules?.error) issues.push({ path: '.dita-note-rules.json', message: snapshot.noteRules.error });
    if (snapshot.projectError) issues.push({ path: '.dita-project.json', message: snapshot.projectError });
    if (model && snapshot.project.models.length && !snapshot.project.models.includes(model)) {
      issues.push({ path: snapshot.path, message: '型号不在项目清单中：' + model });
    }
    const inputs = new Map(files);
    if (typeof snapshot.content === 'string' && !inputs.has(snapshot.path)) inputs.set(snapshot.path, { current: snapshot.map.source ?? snapshot.content });
    for (const [path, file] of inputs) {
      try {
        const tree = xml.inspectSource(file.current);
        const revisions = revisionCheck(file.current, profile, tree);
        if (revisions.excluded.length) excludedRevisions.set(path, revisions);
        if (revisions.pending) issues.push({ path, message: '尚有未处理的 Oxygen 修订，请先接受或拒绝后再交付或发布知识库' });
        resolver.walk(tree, (node, ancestors) => {
          if (profile && [...ancestors, node].some(parent => !profile.keep(parent))) return;
          if (model && path === snapshot.path && snapshot.map.source && !domain.matches(domain.conditions(node, ancestors), model, profile)) return;
          const unknown = domain.checkModels(domain.productValues(domain.decode(node.attrs.product)), snapshot.project);
          if (unknown.length) issues.push({ path, message: '未登记型号：' + unknown.join('、') });
        });
      } catch (error) {
        const projectedMap = path === snapshot.path && snapshot.map.source && snapshot.map.source !== snapshot.content;
        issues.push({ path, message: error.message, ...(!projectedMap && error.location ? { location: error.location } : {}) });
      }
    }
    return { issues, excludedRevisions };
  }

  function prepare(snapshot, model = '', validateProject = true, { useRules = true, prefixes = false } = {}) {
    const profile = profileOf(snapshot);
    const plan = resolver.planMap(snapshot.map, model, profile), files = resolver.scopeFiles(snapshot.files, plan, profile);
    let excludedRevisions;
    if (validateProject) {
      const checked = projectIssues(snapshot, files, model, profile);
      const { issues } = checked;
      if (issues.length) throw Object.assign(new Error(issues.map(item => item.path + '：' + item.message).join('\n')), { issues });
      excludedRevisions = checked.excludedRevisions;
    }
    const publish = (files, projection = {}) => {
      const checked = new Map(excludedRevisions);
      function guardReuse(path, node, attrs) {
        let revisions = checked.get(path);
        if (!revisions || !profile.keep({ attrs })) return;
        const source = files.get(path).current;
        if (revisions.source !== source) {
          revisions = revisionCheck(source, profile, xml.inspectSource(source));
          checked.set(path, revisions);
        }
        // A fragment copied out of an excluded ancestor can surface in retained content.
        const end = node.close?.end ?? node.end;
        if (revisions.excluded.some(({ containerStart, token }) => containerStart <= node.start && node.start <= token.start && token.end <= end)) {
          return '复用目标包含不完整的 Oxygen 修订，请先修复原文';
        }
      }
      return publication.preparePublication({
        map: snapshot.map, files, model, profile, plan, guardReuse: checked.size ? guardReuse : undefined,
        ruleConfirmed: projection.confirmed, ruleExclusions: projection.excluded
      });
    };
    // Resolve actual uses before deciding which original notes can affect delivery.
    const baseline = useRules && model ? publish(files) : null;
    const activeOrigins = baseline && new Set(baseline.notes.map(note => note.origin.path + '\n' + note.origin.start));
    const projection = useRules ? rulesCore.project(files, snapshot.noteRules?.config, model, {
      prefixes, profile, activeOrigins,
      knownModels: [...(snapshot.project.models || []), ...discoverModels(snapshot, profile).models]
    }) : { files };
    if (projection.issues?.length) {
      const message = projection.issues.some(item => item.kind === 'model-scope') ?
        '有注脚的型号范围需要核对，请使用独立规则后再导出' : '注脚规则已过期，请重新核对后导出';
      throw Object.assign(new Error(message), { issues: [...projection.issues, ...projection.noteReview] });
    }
    const result = baseline && !projection.applied && !projection.prefixApplied ? baseline : publish(projection.files, projection);
    result.noteReview = projection.noteReview || [];
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
    return { notes, calls, models: discoverModels(snapshot).models, report: data.report };
  }

  function saveCandidates(snapshot) {
    const paths = new Set([snapshot.path, ...snapshot.files.keys(), ...(snapshot.filter ? [snapshot.filter.path] : [])]);
    return [...paths].map(path => snapshot.buffers.get(path)).filter(file => file?.dirty);
  }

  const api = { prepare, listNotes, saveCandidates, discoverModels, listModels };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaManualDomain = api;
})(typeof window === 'undefined' ? globalThis : window);

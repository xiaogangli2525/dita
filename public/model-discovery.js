'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const refs = typeof module !== 'undefined' ? require('./publication-resolver') : root.DitaPublicationResolver;
  const manual = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  // A workflow marker is not a model. This does not change publication rules.
  const isPlaceholder = manual.isModelMarker;
  const isModel = value => typeof value === 'string' && Boolean(value) && value.length <= 80 && !isPlaceholder(value) && !/[\s()<>"'&/\\\x00-\x1f]/.test(value);
  function discover(files, profile) {
    const models = new Set(), tableModels = new Set(), pending = new Set(), ignored = new Set(), evidence = [];
    const children = (node, name) => node.children.filter(child => child.kind === 'element' && (!name || child.name === name));
    const tokens = node => refs.decode(node.attrs.product || '').trim().split(/\s+/).filter(Boolean);
    const marked = nodes => nodes.some(node => { const values = tokens(node); return values.length > 0 && values.every(isPlaceholder); });
    const excluded = nodes => Boolean(profile && nodes.some(node => !profile.keep(node)));
    function add(model, path, kind) {
      if (!isModel(model)) return;
      models.add(model); if (kind === 'table') tableModels.add(model);
      if (!evidence.some(item => item.model === model && item.path === path && item.kind === kind)) evidence.push({ model, path, kind });
    }
    for (const [path, file] of files) {
      const source = file.current;
      function text(node) {
        if (node.kind === 'text') return refs.decode(source.slice(node.start, node.end));
        if (node.kind === 'cdata') return source.slice(node.start + 9, node.end - 3);
        if (node.kind !== 'element' || marked([node]) || excluded([node])) return '';
        return node.children.map(text).join('');
      }
      refs.walk(xml.inspectSource(source), (node, ancestors) => {
        const lineage = [...ancestors, node];
        tokens(node).filter(isPlaceholder).forEach(value => ignored.add(value));
        if (excluded(lineage)) return;
        if (!marked(lineage) && !/[()]/.test(refs.decode(node.attrs.product || ''))) tokens(node).forEach(model => add(model, path, 'product'));
        if (node.name !== 'tgroup') return;
        const header = children(children(node, 'thead')[0] || {children:[]}, 'row')[0];
        if (!header) return;
        const labels = children(header, 'entry').map(entry => text(entry).trim());
        // Only explicit applicability columns; never mine model names from prose.
        if (labels[0] !== '模组系列' || labels[1] !== '模组子型号') return;
        for (const body of children(node, 'tbody')) for (const row of children(body, 'row')) {
          const first = children(row, 'entry')[0]; if (!first) continue;
          const model = text(first).trim(); if (!isModel(model)) continue;
          if (marked([...lineage, body, row, first])) { pending.add(model); continue; }
          if (excluded([...lineage, body, row, first])) continue;
          add(model, path, 'table');
        }
      });
    }
    return { models: [...models].sort(), tableModels: [...tableModels].sort(), pending: [...pending].sort(), ignored: [...ignored].sort(), evidence };
  }
  const api = { discover, isModel, isPlaceholder };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaModelDiscovery = api;
})(typeof window === 'undefined' ? globalThis : window);

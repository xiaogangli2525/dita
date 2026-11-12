'use strict';
(function (root) {
  function applyMetadata(part, recipe) {
    const staleMetadata = Object.keys(recipe.overrides || {}).filter(path => !part.entries.some(entry => entry.sourcePath === path));
    const entries = part.entries.map(entry => {
      const meta = recipe.overrides?.[entry.sourcePath];
      const valid = meta?.fingerprint === entry.fingerprint && meta.definedSymbols.every(symbol => (entry.symbols || []).includes(symbol));
      if (meta && !valid) staleMetadata.push(entry.sourcePath);
      const applied = valid ? meta : {};
      return { ...entry, kind: applied.kind || entry.kind || 'guide', aliases: [...(applied.aliases || [])],
        definedSymbols: [...(applied.definedSymbols || entry.definedSymbols || [])] };
    });
    return { ...part, mode: recipe.mode || 'other', module: recipe.module || part.title, entries, staleMetadata };
  }
  const api = { applyMetadata };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeMetadata = api;
})(typeof window === 'undefined' ? globalThis : window);

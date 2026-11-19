// @ts-check
'use strict';
(function (root) {
  const plan = typeof module !== 'undefined' ? require('./knowledge-plan') : root.DitaKnowledgePlan;
  /** @param {import('./knowledge-contracts').KnowledgeManual} part
   * @param {import('./knowledge-contracts').KnowledgeRecipe} recipe */
  function applyMetadata(part, recipe) {
    const staleMetadata = Object.keys(recipe.overrides || {}).filter(path => plan.includesTopic(path) && !part.entries.some(entry => entry.sourcePath === path));
    const entries = part.entries.map(entry => {
      const path = entry.sourcePath;
      const meta = path ? recipe.overrides?.[path] : undefined;
      const applied = meta && meta.fingerprint === entry.fingerprint &&
        meta.definedSymbols.every(symbol => (entry.symbols || []).includes(symbol)) ? meta : undefined;
      if (path && meta && !applied) staleMetadata.push(path);
      return { ...entry, kind: applied?.kind || entry.kind || 'guide', aliases: [...(applied?.aliases || [])],
        definedSymbols: [...(applied?.definedSymbols || entry.definedSymbols || [])] };
    });
    return { ...part, mode: recipe.mode || 'other', module: recipe.module || part.title, entries, staleMetadata };
  }
  const api = { applyMetadata };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeMetadata = api;
})(typeof window === 'undefined' ? globalThis : window);

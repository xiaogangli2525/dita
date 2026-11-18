'use strict';
(function (root) {
  function createMetadataUI({ get, save, error }) {
    let editing = null;
    function fields() {
      const entry = editing.part.entries.find(item => item.sourcePath === get('knowledgeEntry').value);
      for (const id of ['knowledgeEntryKind', 'knowledgeAliases', 'knowledgeDefinitions', 'knowledgeMetadataSave']) get(id).disabled = !entry;
      if (!entry) { get('knowledgeSymbols').textContent = '此章节已不在发布内容中，请清除旧配置后继续发布。'; return; }
      const override = editing.recipe.overrides[entry.sourcePath];
      get('knowledgeEntryKind').value = override?.kind || entry.kind || 'guide';
      get('knowledgeAliases').value = (override?.aliases || entry.aliases || []).join('\n');
      get('knowledgeDefinitions').value = (override?.definedSymbols || entry.definedSymbols || []).join('\n');
      get('knowledgeSymbols').textContent = '原文符号：' + (entry.symbols.join('、') || '无') + (override && override.fingerprint !== entry.fingerprint ? '；原文已变化，请核对后保存或清除旧属性。' : '');
    }
    get('knowledgeEntry').addEventListener('change', fields);
    get('knowledgeMetadataClose').addEventListener('click', () => get('knowledgeMetadataDialog').close());
    get('knowledgeMetadataClear').addEventListener('click', () => {
      if (!editing) return;
      const overrides = { ...editing.recipe.overrides }; delete overrides[get('knowledgeEntry').value];
      save(editing.key, overrides); editing.recipe.overrides = overrides; fields();
    });
    get('knowledgeMetadataSave').addEventListener('click', () => {
      try {
        const entry = editing.part.entries.find(item => item.sourcePath === get('knowledgeEntry').value);
        const values = value => [...new Set(value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean))];
        const aliases = values(get('knowledgeAliases').value), definedSymbols = values(get('knowledgeDefinitions').value);
        if (aliases.length > 20 || aliases.some(item => item.length > 80) || definedSymbols.length > 80) throw Error('别名最多 20 个、每个 80 字；定义符号最多 80 个');
        if (definedSymbols.some(symbol => !entry.symbols.includes(symbol))) throw Error('定义符号必须来自当前章节的原文符号，请核对大小写');
        const overrides = { ...editing.recipe.overrides, [entry.sourcePath]: { fingerprint: entry.fingerprint, kind: get('knowledgeEntryKind').value, aliases, definedSymbols } };
        save(editing.key, overrides); editing.recipe.overrides = overrides; fields();
        get('knowledgeMetadataStatus').textContent = '已应用到发布集合；请保存发布方案以保留配置。原始 DITA 未改动。';
      } catch (cause) { get('knowledgeMetadataStatus').textContent = cause.message; error(cause.message); }
    });
    return { show(key, part, recipe) {
      editing = { key, part, recipe }; get('knowledgeMetadataTitle').textContent = part.title + ' · 检索属性';
      get('knowledgeEntry').replaceChildren(...part.entries.map(entry => new Option(entry.title + ' · ' + entry.sourcePath, entry.sourcePath)), ...Object.keys(recipe.overrides).filter(path => root.DitaKnowledgePlan.includesTopic(path) && !part.entries.some(entry => entry.sourcePath === path)).map(path => new Option('已移除 · ' + path, path)));
      get('knowledgeMetadataStatus').textContent = ''; fields(); get('knowledgeMetadataDialog').showModal();
    } };
  }
  root.DitaKnowledgeMetadataUI = { createMetadataUI };
})(window);

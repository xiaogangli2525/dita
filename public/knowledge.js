'use strict';
(function (root) {
  function createController(A) {
    const get = id => document.getElementById(id), parts = new Map(), recipes = new Map(), preferences = new Map(), capture = root.DitaKnowledgeCapture.createCapture(A);
    let busy = false, loading = false, filterFailed = false, operation = 0, abort, compiled = null, chosenModel = '', preferenceKey = '';
    const workspaceKey = () => JSON.stringify([A.state.root, A.state.currentBranch || '']);
    const sourceKey = (root, path) => JSON.stringify([root, path]);
    const error = text => { get('knowledgeError').textContent = text; }, status = text => { get('knowledgeStatus').textContent = text; };
    function invalidate() { compiled = null; }
    function remember() {
      if (!preferenceKey || loading || filterFailed) return;
      preferences.set(preferenceKey, { version: get('knowledgeVersion').value, filterPath: get('knowledgeFilter').value,
        prefixes: get('knowledgePrefixes').checked, mode: get('knowledgeMode').value, module: get('knowledgeModule').value,
        paths: [...get('knowledgeSources').querySelectorAll('input:checked')].map(input => input.value) });
    }
    function read() { return { title: get('knowledgeTitle').value, model: chosenModel || get('knowledgeModel').value.trim(), sdkVersion: get('knowledgeSdk').value, sources: [...recipes.values()] }; }
    function restore(plan) {
      if (busy) throw Error('请等待当前加入操作完成');
      parts.clear(); recipes.clear(); preferences.clear(); for (const recipe of plan.sources) recipes.set(sourceKey(recipe.repositoryRoot, recipe.path), recipe);
      chosenModel = plan.sources.length ? plan.model : ''; get('knowledgeModel').value = plan.model; get('knowledgeTitle').value = plan.title; get('knowledgeSdk').value = plan.sdkVersion;
      invalidate(); renderCollection(); if (get('knowledgeDialog').open) void refreshSources();
    }
    const plans = root.DitaKnowledgePlansUI.createPlansUI({ get, read, restore, download: A.downloadText, error, status });
    const metadata = root.DitaKnowledgeMetadataUI.createMetadataUI({ get, error, save(key, overrides) {
      const recipe = recipes.get(key); recipe.overrides = overrides; invalidate(); renderCollection();
    } });
    function readyParts() { return [...recipes].map(([key, recipe]) => parts.has(key) ? root.DitaKnowledgeMetadata.applyMetadata(parts.get(key), recipe) : null); }
    function controls() {
      for (const id of ['knowledgeTitle', 'knowledgeSdk', 'knowledgeVersion', 'knowledgeFilter', 'knowledgePrefixes', 'knowledgeMode', 'knowledgeModule', 'knowledgePlan', 'knowledgePlanSave', 'knowledgePlanLoad', 'knowledgePlanNew', 'knowledgePlanExport', 'knowledgePlanImport']) get(id).disabled = busy;
      get('knowledgeAdd').disabled = busy || loading || filterFailed; get('knowledgeFilter').disabled = busy || loading;
      get('knowledgeModel').disabled = busy || recipes.size > 0;
      const ready = recipes.size > 0 && readyParts().every(part => part && !part.staleMetadata.length);
      get('knowledgePreview').disabled = busy || !ready; get('knowledgeDownload').disabled = busy || !ready; get('knowledgeClear').disabled = busy || !recipes.size;
      for (const input of get('knowledgeSources').querySelectorAll('input')) input.disabled = busy;
      for (const button of get('knowledgeCollection').querySelectorAll('button')) button.disabled = busy;
    }
    function renderCollection() {
      const list = get('knowledgeCollection'); list.replaceChildren();
      get('knowledgeCount').textContent = parts.size + '/' + recipes.size + ' 份已核对';
      if (!recipes.size) { const p = document.createElement('p'); p.className = 'knowledge-empty'; p.textContent = '从左侧选择功能手册，加入本次发布。\n切换文档库后，可以继续加入其它仓库的手册。'; list.append(p); }
      for (const [key, recipe] of recipes) {
        const raw = parts.get(key), part = raw && root.DitaKnowledgeMetadata.applyMetadata(raw, recipe);
        const card = document.createElement('article'), title = document.createElement('strong'), source = document.createElement('small'), details = document.createElement('p'), actions = document.createElement('div');
        card.className = 'knowledge-part'; title.textContent = recipe.title;
        source.textContent = recipe.repository + (recipe.branch ? ' @ ' + recipe.branch : '') + ' · ' + recipe.path;
        details.textContent = (part ? '已核对 · ' + part.entries.length + ' 章节 · ' + part.report.included + ' 注脚' : '待重新核对来源') + ' · ' + (recipe.version || '未填文档版本') + ' · ' + (recipe.mode === 'other' ? '通用' : recipe.mode) + ' / ' + (recipe.module || recipe.title);
        const policy = document.createElement('small'); policy.textContent = '正文：' + (recipe.filterPath || '不过滤') + '；注脚：' + (recipe.prefixes ? '明确型号前缀筛选' : '独立规则') + (part ? '；核对于 ' + new Date(part.capturedAt).toLocaleString('zh-CN', { hour12: false }) : '');
        if (part?.staleMetadata.length) details.textContent += ' · 检索属性已过期，需核对';
        if (part?.report.unmarked) details.textContent += ' · ' + part.report.unmarked + ' 条未标适用范围（按交付策略保留）';
        if (part?.report.oxygenRevisions) details.textContent += ' · 含 ' + part.report.oxygenRevisions + ' 处 Oxygen 修订，请核对发布内容';
        function action(label, handler) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.addEventListener('click', handler); actions.append(button); }
        action('核对来源', () => {
          if (workspaceKey() !== JSON.stringify([recipe.repositoryRoot, recipe.branch])) { status('请关闭发布窗口，切换至文档库“' + recipe.repository + '”' + (recipe.branch ? '的 ' + recipe.branch + ' 分支' : '') + '，再打开本方案核对。'); return; }
          preferences.set(workspaceKey(), { ...recipe, paths: [recipe.path] }); void refreshSources(); status('已载入此手册的发布条件，点击“加入／更新手册”重新核对。');
        });
        if (workspaceKey() !== JSON.stringify([recipe.repositoryRoot, recipe.branch])) action('关联当前库', () => {
          const next = sourceKey(A.state.root, recipe.path);
          if (next !== key && recipes.has(next)) { error('当前库已有相同入口，请先移除重复项再关联。'); return; }
          recipes.delete(key); parts.delete(key); parts.delete(next);
          recipes.set(next, { ...recipe, repositoryRoot: A.state.root, repository: A.state.root.split(/[\\/]/).filter(Boolean).pop(), branch: A.state.currentBranch || '' });
          preferences.delete(workspaceKey()); invalidate(); renderCollection(); void refreshSources(); status('来源已关联当前文档库，请核对路径和过滤条件后重新加入。');
        });
        if (part) action('检索属性', () => metadata.show(key, raw, recipe));
        action('移除', () => { parts.delete(key); recipes.delete(key); if (!recipes.size) chosenModel = ''; invalidate(); renderCollection(); });
        actions.className = 'knowledge-part-actions'; card.append(title, source, details, policy, actions); list.append(card);
      }
      controls();
    }
    function sourceChoices(pref) {
      const list = get('knowledgeSources'); list.replaceChildren();
      get('knowledgeRepository').textContent = A.state.root.split(/[\\/]/).filter(Boolean).pop() || '当前文档库';
      const paths = [...A.state.maps].map(map => ({ path: map.path, title: map.title || map.name || map.path }));
      if (A.state.activePath && !paths.some(item => item.path === A.state.activePath) && !/\.ditamap$/i.test(A.state.activePath)) paths.unshift({ path: A.state.activePath, title: '当前主题' });
      for (const recipe of recipes.values()) if (recipe.repositoryRoot === A.state.root && recipe.branch === (A.state.currentBranch || '') && !paths.some(item => item.path === recipe.path)) paths.push({ path: recipe.path, title: recipe.title });
      for (const entry of paths) {
        const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span'), small = document.createElement('small');
        input.type = 'checkbox'; input.value = entry.path; input.checked = pref.paths ? pref.paths.includes(entry.path) : entry.path === A.manual.scopePath();
        input.addEventListener('change', remember); text.textContent = entry.title; small.textContent = entry.path; text.append(small); label.append(input, text); list.append(label);
      }
      if (!paths.length) list.textContent = '请先加载文档库或打开一个主题。';
    }
    async function refreshSources() {
      const generation = ++operation, workspace = A.api.token; preferenceKey = workspaceKey();
      const recipe = [...recipes.values()].find(item => item.repositoryRoot === A.state.root && item.branch === (A.state.currentBranch || ''));
      const pref = preferences.get(preferenceKey) || (recipe ? { ...recipe, paths: [...recipes.values()].filter(item => item.repositoryRoot === recipe.repositoryRoot && item.branch === recipe.branch).map(item => item.path) } : {});
      sourceChoices(pref); get('knowledgeVersion').value = pref.version || ''; get('knowledgePrefixes').checked = !!pref.prefixes;
      get('knowledgeMode').value = pref.mode || 'other'; get('knowledgeModule').value = pref.module || '';
      get('knowledgeFilter').replaceChildren(new Option('正在加载条件文件…', '')); loading = true; filterFailed = false; controls();
      const current = () => generation === operation && workspace === A.api.token && get('knowledgeDialog').open;
      try {
        const filters = await A.manual.listFilters(); if (!current()) return;
        get('knowledgeFilter').replaceChildren(new Option('不过滤正文', ''));
        for (const path of filters.files) get('knowledgeFilter').add(new Option((filters.descriptions?.[path] || '条件文件') + ' · ' + path, path));
        if (pref.filterPath && !filters.files.includes(pref.filterPath)) { get('knowledgeFilter').add(new Option('原条件文件不存在 · ' + pref.filterPath, pref.filterPath)); get('knowledgeFilter').value = pref.filterPath; get('knowledgeFilter').selectedOptions[0].disabled = true; throw Error('原方案条件文件不存在：' + pref.filterPath + '。请明确选择新条件后再加入。'); }
        get('knowledgeFilter').value = pref.filterPath || ''; loading = false; controls();
      } catch (cause) { if (current()) { error('条件文件读取失败，暂不能加入手册：' + cause.message); loading = false; filterFailed = true; controls(); } }
    }
    async function show() {
      if (busy) return;
      error(''); plans.show(); if (!get('knowledgeTitle').value) get('knowledgeTitle').value = '模组开发者知识库';
      const models = new Set([...(A.project.value?.models || []), chosenModel].filter(Boolean));
      get('knowledgeModels').replaceChildren(...[...models].map(value => new Option(value, value)));
      get('knowledgeDialog').showModal(); renderCollection(); await refreshSources();
    }
    function cancel() { remember(); abort?.abort(); operation++; busy = false; loading = false; controls(); }
    async function add() {
      if (busy || loading || filterFailed) return;
      const model = get('knowledgeModel').value.trim(), version = get('knowledgeVersion').value.trim();
      const paths = [...get('knowledgeSources').querySelectorAll('input:checked')].map(input => input.value);
      if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(model)) { error('请填写具体型号，例如 ML307G。'); return; }
      if (!paths.length) { error('请至少选择一份手册。'); return; }
      if (version.length > 80) { error('文档版本请限制在 80 字以内。'); return; }
      if (chosenModel && model !== chosenModel) { error('本发布集合已固定为 ' + chosenModel + '，请清空后更换型号。'); return; }
      remember(); const settings = { ...preferences.get(workspaceKey()), model, version }, repositoryRoot = A.state.root, branch = A.state.currentBranch || '';
      const generation = ++operation, workspace = A.api.token;
      abort = new AbortController(); busy = true; controls(); error('');
      try {
        const staged = [];
        for (const [index, path] of paths.entries()) {
          status('正在检查并加入 ' + (index + 1) + '/' + paths.length + ' · ' + path);
          staged.push({ ...(await capture.collect(path, settings, abort.signal)), path });
          if (generation !== operation || workspace !== A.api.token) return;
        }
        if (staged.some(item => !item.current())) throw Error('源内容已变化，请重新加入本批手册。');
        if (new Set([...recipes.keys(), ...paths.map(path => sourceKey(repositoryRoot, path))]).size > 30) throw Error('本版最多组合 30 份手册。');
        for (const { part, path } of staged) {
          const key = sourceKey(repositoryRoot, path), old = recipes.get(key);
          recipes.set(key, { repositoryRoot, branch, repository: part.source.repository, path, title: part.title, version, filterPath: settings.filterPath, prefixes: settings.prefixes,
            mode: settings.mode, module: settings.module, overrides: old?.overrides || {}, previous: { htmlSha256: part.htmlSha256, capturedAt: part.capturedAt } });
          parts.set(key, part);
        }
        chosenModel = model; invalidate(); renderCollection(); status('已加入 ' + staged.length + ' 份手册快照，可预览或继续添加。');
      } catch (cause) { if (generation === operation) { error(cause.message); status('加入未完成，已添加的其它手册仍保留。'); } }
      finally { if (generation === operation) { busy = false; controls(); } }
    }
    function build() {
      const manuals = readyParts(); if (!manuals.length || manuals.some(part => !part)) throw Error('请先重新核对所有手册来源');
      if (!compiled) compiled = root.DitaKnowledgePackage.buildPackage({ title: get('knowledgeTitle').value, model: chosenModel, sdkVersion: get('knowledgeSdk').value, manuals });
      return compiled;
    }
    function preview() {
      try { error(''); const output = build(); get('knowledgePreviewFrame').srcdoc = output.html; get('knowledgePreviewDialog').showModal(); }
      catch (cause) { error(cause.message); }
    }
    function download() {
      if (busy) return;
      try { error(''); const output = build(); A.downloadText(output.zip, output.filename, 'application/zip'); status('已发起下载：' + output.filename + '；解压后打开 docs/index.html。'); A.setStatus('离线知识库已生成：' + output.filename); }
      catch (cause) { error(cause.message); }
    }
    get('knowledgeButton').addEventListener('click', show); get('knowledgeAdd').addEventListener('click', add);
    get('knowledgeClose').addEventListener('click', () => { cancel(); get('knowledgeDialog').close(); }); get('knowledgeDialog').addEventListener('cancel', cancel);
    get('knowledgePreview').addEventListener('click', preview); get('knowledgeDownload').addEventListener('click', download);
    get('knowledgePreviewClose').addEventListener('click', () => get('knowledgePreviewDialog').close());
    get('knowledgePreviewDialog').addEventListener('close', () => { get('knowledgePreviewFrame').srcdoc = ''; });
    get('knowledgeClear').addEventListener('click', () => { parts.clear(); recipes.clear(); chosenModel = ''; invalidate(); renderCollection(); status('发布集合已清空。'); });
    for (const id of ['knowledgeTitle', 'knowledgeSdk']) get(id).addEventListener('input', invalidate);
    for (const id of ['knowledgeVersion', 'knowledgePrefixes', 'knowledgeMode', 'knowledgeModule']) get(id).addEventListener('change', remember);
    get('knowledgeFilter').addEventListener('change', () => { if (busy || loading || !get('knowledgeFilter').options.length || get('knowledgeFilter').selectedOptions[0]?.disabled) return; filterFailed = false; remember(); controls(); error(''); });
    A.events.on('workspace:willChange', () => { cancel(); get('knowledgeMetadataDialog').close(); get('knowledgePreviewDialog').close(); get('knowledgeDialog').close(); });
    return { show, get lastManifest() { return compiled?.manifest || null; } };
  }
  root.DitaKnowledge = { createController };
})(window);

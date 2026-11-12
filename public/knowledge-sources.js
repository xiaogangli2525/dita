'use strict';
(function (root) {
  function createSourcesUI({ A, get, add, error, status }) {
    let generation = 0, abort, revisionTimer, refsRoot = '', catalog = null, editing = null, draft = null, loading = false;
    function revision() { return get('knowledgeSourceMode').value === 'git' ? get('knowledgeSourceRevision').value.trim() : ''; }
    function selection() { return { repositoryRoot: get('knowledgeSourceRepo').value, revision: revision() }; }
    function lock(value) {
      loading = value;
      get('knowledgeSourceReload').disabled = value;
      get('knowledgeSourceEntry').disabled = value || !catalog || !get('knowledgeSourceEntry').value;
      get('knowledgeSourceFilter').disabled = value || !catalog;
      get('knowledgeSourceAdd').disabled = get('knowledgeSourceEntry').disabled;
    }
    function cancel() {
      generation++; abort?.abort(); clearTimeout(revisionTimer); catalog = null;
      get('knowledgeSourceEntry').replaceChildren(); get('knowledgeSourceFilter').replaceChildren();
      lock(false);
    }
    function rememberSelection() {
      if (catalog) draft = { repositoryRoot: catalog.root, path: get('knowledgeSourceEntry').value, filterPath: get('knowledgeSourceFilter').value };
    }
    function restoreOption(select, value, missingLabel) {
      if (!value) return;
      if (![...select.options].some(option => option.value === value)) {
        const missing = new Option(missingLabel + ' · ' + value, value);
        missing.disabled = true; select.add(missing);
      }
      select.value = value;
    }
    async function load() {
      rememberSelection(); cancel();
      const source = selection(), ticket = generation, workspace = A.api.token;
      const pref = editing || draft?.repositoryRoot === source.repositoryRoot ? draft || {} : {};
      const requestedName = get('knowledgeSourceRepo').selectedOptions[0].textContent;
      const needsRevision = get('knowledgeSourceMode').value === 'git' && !source.revision;
      const hint = '请填写分支、标签或提交，选择版本后会自动读取手册入口。';
      get('knowledgeSourceRevision').disabled = get('knowledgeSourceMode').value !== 'git';
      if (refsRoot !== source.repositoryRoot) { get('knowledgeSourceRefs').replaceChildren(); refsRoot = ''; }
      if (needsRevision && refsRoot) { get('knowledgeSourceInfo').textContent = hint; return; }
      abort = new AbortController(); const signal = abort.signal;
      const current = () => ticket === generation && workspace === A.api.token && get('knowledgeSourceDialog').open;
      lock(true); get('knowledgeSourceInfo').textContent = '正在读取「' + requestedName + '」…';
      try {
        const response = await A.api.request('/api/knowledge/catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...source, entryPath: pref.path }), signal });
        if (!response.ok) throw Error(await A.api.error(response)); const data = await response.json();
        if (!current()) return;
        get('knowledgeSourceRefs').replaceChildren(...(data.refs || []).map(ref => new Option(ref.label, ref.value)));
        refsRoot = source.repositoryRoot;
        if (needsRevision) { get('knowledgeSourceInfo').textContent = hint; return; }
        catalog = data;
        get('knowledgeSourceEntry').replaceChildren(...data.maps.map(map => new Option(map.title + ' · ' + map.path, map.path)));
        restoreOption(get('knowledgeSourceEntry'), pref.path, '原手册入口不存在');
        get('knowledgeSourceFilter').replaceChildren(new Option('不过滤正文', ''), ...data.filters.map(path => new Option(path, path)));
        restoreOption(get('knowledgeSourceFilter'), pref.filterPath, '原条件文件不存在');
        const repository = data.root.split(/[\\/]/).filter(Boolean).pop();
        get('knowledgeSourceInfo').textContent = '已读取「' + repository + '」 · ' + (data.revision ? 'Git 版本 ' + data.revision + ' · ' : '已保存文件 · ' + (data.branch || '游离 HEAD') + ' · ') + data.commit.slice(0, 8) + (data.dirty ? ' · 含已保存但未提交的文件' : '') + ' · ' + data.maps.length + ' 个入口';
      } catch (cause) { if (current() && !signal.aborted) get('knowledgeSourceInfo').textContent = '读取「' + requestedName + '」失败：' + cause.message; }
      finally { if (ticket === generation) lock(false); }
    }
    function show(recipe = null) {
      cancel(); editing = recipe; draft = recipe;
      const repositories = new Map(A.state.repositories.map(item => [item.path, item.name])); repositories.set(A.state.root, A.state.root.split(/[\\/]/).pop());
      if (recipe && !repositories.has(recipe.repositoryRoot)) repositories.set(recipe.repositoryRoot, recipe.repository + '（需在本机加载）');
      get('knowledgeSourceRepo').replaceChildren(...[...repositories].map(([path, name]) => new Option(name, path)));
      get('knowledgeSourceRepo').value = recipe?.repositoryRoot || A.state.root;
      get('knowledgeSourceMode').value = recipe?.revision ? 'git' : 'saved'; get('knowledgeSourceRevision').disabled = !recipe?.revision; get('knowledgeSourceRevision').value = recipe?.revision || '';
      get('knowledgeSourceVersion').value = recipe?.version || ''; get('knowledgeSourceModule').value = recipe?.module || '';
      get('knowledgeSourceKind').value = recipe?.mode || 'other'; get('knowledgeSourcePrefixes').checked = !!recipe?.prefixes;
      get('knowledgeSourceDialog').showModal(); void load();
    }
    get('knowledgeSourceClose').addEventListener('click', () => { cancel(); get('knowledgeSourceDialog').close(); });
    get('knowledgeSourceDialog').addEventListener('cancel', cancel);
    get('knowledgeSourceRepo').addEventListener('change', load);
    get('knowledgeSourceMode').addEventListener('change', load);
    get('knowledgeSourceReload').addEventListener('click', load);
    get('knowledgeSourceRevision').addEventListener('input', () => {
      rememberSelection(); cancel();
      get('knowledgeSourceInfo').textContent = '正在等待读取指定版本…';
      revisionTimer = setTimeout(load, 300);
    });
    get('knowledgeSourceAdd').addEventListener('click', () => {
      try {
        if (loading || !catalog) throw Error('请先读取来源');
        const path = get('knowledgeSourceEntry').value, filter = get('knowledgeSourceFilter');
        if (!path) throw Error('此来源没有可选的手册入口');
        if (get('knowledgeSourceEntry').selectedOptions[0]?.disabled) throw Error('原手册入口不存在，请明确选择替代入口');
        if (filter.selectedOptions[0]?.disabled) throw Error('原条件文件不存在，请明确选择替代条件');
        const recipe = { repositoryRoot: catalog.root, repository: get('knowledgeSourceRepo').selectedOptions[0].textContent, branch: catalog.branch, path,
          title: editing?.repositoryRoot === catalog.root && editing.path === path ? editing.title : catalog.maps.find(map => map.path === path)?.title || path, version: get('knowledgeSourceVersion').value.trim(), filterPath: filter.value, prefixes: get('knowledgeSourcePrefixes').checked,
          mode: get('knowledgeSourceKind').value, module: get('knowledgeSourceModule').value.trim(), overrides: editing?.path === path ? editing.overrides : {}, ...(catalog.revision ? { revision: catalog.revision } : {}) };
        add(recipe, editing); cancel(); get('knowledgeSourceDialog').close(); status('来源配置已加入方案，点击“核对全部来源”统一加载各仓库。');
      } catch (cause) { error(cause.message); get('knowledgeSourceInfo').textContent = cause.message; }
    });
    A.events.on('workspace:willChange', () => { cancel(); get('knowledgeSourceDialog').close(); });
    return { show };
  }
  root.DitaKnowledgeSources = { createSourcesUI };
})(window);

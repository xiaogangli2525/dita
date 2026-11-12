'use strict';
(function (root) {
  function createSourcesUI({ A, get, add, error, status }) {
    let generation = 0, abort, catalog = null, editing = null, draft = null, loading = false;
    function revision() { return get('knowledgeSourceMode').value === 'git' ? get('knowledgeSourceRevision').value.trim() : ''; }
    function selection() { return { repositoryRoot: get('knowledgeSourceRepo').value, revision: revision() }; }
    function lock(value) { loading = value; get('knowledgeSourceAdd').disabled = value || !catalog; get('knowledgeSourceReload').disabled = value; }
    function cancel() { generation++; abort?.abort(); catalog = null; loading = false; }
    function rememberSelection() {
      if (catalog) draft = { repositoryRoot: catalog.root, path: get('knowledgeSourceEntry').value, filterPath: get('knowledgeSourceFilter').value };
    }
    function changed() {
      get('knowledgeSourceRevision').disabled = get('knowledgeSourceMode').value !== 'git';
      rememberSelection(); cancel(); lock(false); get('knowledgeSourceInfo').textContent = '来源已变化，请点击“读取此来源”。';
    }
    function restoreOption(select, value, missingLabel) {
      if (!value) return;
      if (![...select.options].some(option => option.value === value)) {
        const missing = new Option(missingLabel + ' · ' + value, value);
        missing.disabled = true; select.add(missing);
      }
      select.value = value;
    }
    async function load(pref = {}) {
      const ticket = ++generation, workspace = A.api.token; abort?.abort(); abort = new AbortController(); catalog = null; lock(true);
      get('knowledgeSourceInfo').textContent = '正在读取仓库目录…';
      try {
        if (get('knowledgeSourceMode').value === 'git' && !revision()) throw Error('请填写分支、标签或提交，例如 master、v1.0 或提交 SHA');
        const response = await A.api.request('/api/knowledge/catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...selection(), entryPath: pref.path }), signal: abort.signal });
        if (!response.ok) throw Error(await A.api.error(response)); const data = await response.json();
        if (ticket !== generation || workspace !== A.api.token || !get('knowledgeSourceDialog').open) return;
        catalog = data;
        get('knowledgeSourceEntry').replaceChildren(...data.maps.map(map => new Option(map.title + ' · ' + map.path, map.path)));
        restoreOption(get('knowledgeSourceEntry'), pref.path, '原手册入口不存在');
        get('knowledgeSourceFilter').replaceChildren(new Option('不过滤正文', ''), ...data.filters.map(path => new Option(path, path)));
        restoreOption(get('knowledgeSourceFilter'), pref.filterPath, '原条件文件不存在');
        get('knowledgeSourceRefs').replaceChildren(...(data.refs || []).map(ref => new Option(ref.label, ref.value)));
        get('knowledgeSourceInfo').textContent = (data.revision ? 'Git 版本 ' + data.revision + ' · ' : '已保存文件 · ' + (data.branch || '游离 HEAD') + ' · ') + data.commit.slice(0, 8) + (data.dirty ? ' · 含已保存但未提交的文件' : '') + ' · ' + data.maps.length + ' 个入口';
      } catch (cause) { if (ticket === generation && !abort.signal.aborted) get('knowledgeSourceInfo').textContent = cause.message; }
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
      get('knowledgeSourceDialog').showModal(); void load(recipe || {});
    }
    get('knowledgeSourceClose').addEventListener('click', () => { cancel(); get('knowledgeSourceDialog').close(); });
    get('knowledgeSourceDialog').addEventListener('cancel', cancel);
    for (const id of ['knowledgeSourceRepo', 'knowledgeSourceMode', 'knowledgeSourceRevision']) get(id).addEventListener('change', changed);
    get('knowledgeSourceReload').addEventListener('click', () => {
      rememberSelection();
      const retainSelection = editing || draft?.repositoryRoot === get('knowledgeSourceRepo').value;
      void load(retainSelection && draft ? draft : {});
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

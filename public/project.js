'use strict';
(function (root) {
  function createProjectController(A) {
    const get = id => document.getElementById(id);
    let value = { schema: 1, models: [] }, expectedContent = null, error = '', editingWorkspace = '', loadGeneration = 0, pending = null, viewGeneration = 0, writing = false, loaded = false;
    function draw() {
      get('projectModelOptions').replaceChildren();
      for (const model of value.models.filter(root.DitaModelDiscovery.isModel)) { const option = document.createElement('option'); option.value = model; get('projectModelOptions').append(option); }
      A.events.emit('project:changed');
    }
    function lockForm(locked) {
      for (const node of get('projectForm').querySelectorAll('input,textarea,button[type="submit"],#projectDiscover')) node.disabled = locked;
      get('projectClose').disabled = writing;
    }
    A.events.on('workspace:willChange', () => {
      loadGeneration++; viewGeneration++; pending = null; loaded = false; writing = false;
      value = { schema: 1, models: [] }; expectedContent = null; error = ''; editingWorkspace = '';
      get('projectDialog').close(); lockForm(false); draw();
    });
    function load() {
      const generation = ++loadGeneration, workspace = A.api.token;
      const task = (async () => {
        try {
          const response = await A.api.request('/api/project');
          if (!response.ok) throw new Error(await A.api.error(response));
          const result = await response.json();
          if (generation !== loadGeneration || workspace !== A.api.token) return;
          value = { ...result.config, models: result.config.models.filter(root.DitaModelDiscovery.isModel) }; expectedContent = result.expectedContent; error = result.error || ''; draw(); return true;
        } catch (e) { if (generation === loadGeneration && workspace === A.api.token) { error = e.message; A.setStatus('项目配置读取失败：' + error, true); } return false; }
      })();
      pending = task;
      task.finally(() => { if (pending === task) pending = null; });
      return task;
    }
    async function show() {
      if (writing) return;
      const ticket = ++viewGeneration, workspace = A.api.token;
      editingWorkspace = workspace; loaded = false; lockForm(true);
      get('projectModels').value = value.models.join('\n'); get('projectError').textContent = '';
      get('projectDiscoverySummary').textContent = '正在读取当前仓库的型号清单…';
      if (!get('projectDialog').open) get('projectDialog').showModal();
      const success = await load();
      if (ticket !== viewGeneration || workspace !== A.api.token || !get('projectDialog').open) return;
      loaded = Boolean(success); lockForm(!loaded);
      get('projectModels').value = value.models.join('\n'); get('projectError').textContent = error;
      get('projectDiscoverySummary').textContent = loaded
        ? '识别 product 中的型号及适用型号表的系列名；tbd 是待发布标记，不作为型号。注脚中的文字差异仍需确认适用范围。'
        : '型号清单读取失败，暂不能保存。请关闭窗口后重新打开重试。';
    }
    get('projectButton').addEventListener('click', show);
    get('projectClose').addEventListener('click', () => { if (!writing) get('projectDialog').close(); });
    get('projectDialog').addEventListener('cancel', event => { if (writing) event.preventDefault(); });
    get('projectDialog').addEventListener('close', () => { if (!get('projectDialog').open) { viewGeneration++; loaded = false; } });
    get('projectDiscover').addEventListener('click', async () => {
      if (writing || !loaded) return;
      const ticket = viewGeneration;
      try {
        const snapshot = await A.manual.capture(A.manual.scopePath());
        if (ticket !== viewGeneration || !get('projectDialog').open) return;
        if (editingWorkspace !== A.api.token) throw new Error('工作区已切换，请重新打开项目设置');
        const discovery = A.manual.discoverModels(snapshot);
        const models = new Set([...get('projectModels').value.split(/\s+/).filter(root.DitaModelDiscovery.isModel), ...discovery.models]);
        get('projectModels').value = [...models].sort().join('\n');
        get('projectError').textContent = '';
        get('projectDiscoverySummary').textContent = `识别到 ${discovery.models.length} 个型号名称，其中 ${discovery.tableModels.length} 个来自适用型号表（系列名，未拆分子型号）。` + (discovery.models.length ? `识别名称：${discovery.models.join('、')}。` : '') + (discovery.ignored.length ? `已忽略条件标记：${discovery.ignored.join('、')}。` : '') + (discovery.pending.length ? `待发布行未导入：${discovery.pending.join('、')}。` : '') + '识别结果尚未保存。请核对后保存；此操作不会自动标注注脚适用范围。';
      } catch (e) { if (ticket === viewGeneration) get('projectError').textContent = '识别型号失败：' + e.message; }
    });
    get('projectForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (writing || !loaded) return;
      const ticket = viewGeneration, workspace = A.api.token;
      try {
        if (editingWorkspace !== A.api.token) throw new Error('工作区已切换，请重新打开项目设置');
        const config = root.DitaManualCore.validateProject({ schema: 1, models: get('projectModels').value.split(/\s+/).filter(Boolean) });
        if (config.models.some(root.DitaModelDiscovery.isPlaceholder)) throw new Error('tbd 是待发布条件，不是型号。请从清单中移除，或点击识别型号后核对保存。');
        writing = true; lockForm(true); get('projectError').textContent = '';
        const response = await A.api.request('/api/project', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config, expectedContent }) });
        if (!response.ok) throw new Error(await A.api.error(response));
        const result = await response.json();
        if (ticket !== viewGeneration || workspace !== A.api.token || !get('projectDialog').open) return;
        value = { ...result.config, models: result.config.models.filter(root.DitaModelDiscovery.isModel) }; expectedContent = result.expectedContent; error = ''; draw();
        get('projectDialog').close(); A.setStatus(A.state.capabilities.persistence === 'browser' ? '型号清单已保存到当前浏览器' : '型号清单已保存到当前仓库，尚未提交 Git');
      } catch (e) { if (ticket === viewGeneration) get('projectError').textContent = '保存清单失败，当前填写内容仍保留。' + e.message; }
      finally { if (ticket === viewGeneration) { writing = false; lockForm(!loaded); } }
    });
    return { load, show, ready: () => pending || Promise.resolve(), get value() { return value; }, get error() { return error; }, get expectedContent() { return expectedContent; },
      check(products) { const unknown = root.DitaManualCore.checkModels(products, value); if (unknown.length) throw new Error('型号未登记：' + unknown.join('、') + '。请检查拼写或更新项目型号清单。'); } };
  }
  root.DitaProject = { createProjectController };
})(window);

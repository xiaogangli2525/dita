'use strict';
(function (root) {
  function createProjectController(A) {
    const get = id => document.getElementById(id);
    let value = { schema: 1, models: [] }, expectedContent = null, error = '', editingWorkspace = '', loadGeneration = 0, pending = null;
    function draw() {
      get('projectModelOptions').replaceChildren();
      for (const model of value.models) { const option = document.createElement('option'); option.value = model; get('projectModelOptions').append(option); }
      A.events.emit('project:changed');
    }
    function load() {
      const generation = ++loadGeneration, workspace = A.api.token;
      const task = (async () => {
        try {
          const response = await A.api.request('/api/project');
          if (!response.ok) throw new Error(await A.api.error(response));
          const result = await response.json();
          if (generation !== loadGeneration || workspace !== A.api.token) return;
          value = result.config; expectedContent = result.expectedContent; error = result.error || ''; draw();
        } catch (e) { if (generation === loadGeneration && workspace === A.api.token) { error = e.message; A.setStatus('项目配置读取失败：' + error, true); } }
      })();
      pending = task;
      task.finally(() => { if (pending === task) pending = null; });
      return task;
    }
    async function show() {
      await load(); editingWorkspace = A.api.token;
      get('projectModels').value = value.models.join('\n'); get('projectError').textContent = error;
      get('projectDialog').showModal();
    }
    get('projectButton').addEventListener('click', show);
    get('projectClose').addEventListener('click', () => get('projectDialog').close());
    get('projectDiscover').addEventListener('click', async () => {
      try {
        const snapshot = await A.manual.capture(A.manual.scopePath());
        if (editingWorkspace !== A.api.token) throw new Error('工作区已切换，请重新打开项目设置');
        const models = new Set([...get('projectModels').value.split(/\s+/).filter(Boolean), ...A.manual.listModels(snapshot)]);
        get('projectModels').value = [...models].sort().join('\n');
      } catch (e) { get('projectError').textContent = e.message; }
    });
    get('projectForm').addEventListener('submit', async event => {
      event.preventDefault();
      try {
        if (editingWorkspace !== A.api.token) throw new Error('工作区已切换，请重新打开项目设置');
        const config = root.DitaManualCore.validateProject({ schema: 1, models: get('projectModels').value.split(/\s+/).filter(Boolean) });
        const response = await A.api.request('/api/project', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config, expectedContent }) });
        if (!response.ok) throw new Error(await A.api.error(response));
        const result = await response.json(); value = result.config; expectedContent = result.expectedContent; error = ''; draw();
        get('projectDialog').close(); A.setStatus(A.state.capabilities.persistence === 'browser' ? '型号清单已保存到当前浏览器' : '型号清单已保存到当前仓库，尚未提交 Git');
      } catch (e) { get('projectError').textContent = e.message; }
    });
    return { load, show, ready: () => pending || Promise.resolve(), get value() { return value; }, get error() { return error; }, get expectedContent() { return expectedContent; },
      check(products) { const unknown = root.DitaManualCore.checkModels(products, value); if (unknown.length) throw new Error('型号未登记：' + unknown.join('、') + '。请检查拼写或更新项目型号清单。'); } };
  }
  root.DitaProject = { createProjectController };
})(window);

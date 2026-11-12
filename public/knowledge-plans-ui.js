'use strict';
(function (root) {
  function createPlansUI({ get, read, restore, download, error, status }) {
    let storage = null, currentId = 'plan-' + crypto.randomUUID(), serialized = null, loaded = false;
    try { storage = root.localStorage; } catch (cause) { console.warn('知识库方案存储不可用：', cause.name); }
    const store = root.DitaKnowledgePlan.createPlanStore(storage);
    function refresh() {
      const selected = currentId, list = store.list();
      get('knowledgePlan').replaceChildren(new Option('未保存的新方案', ''));
      for (const item of list) get('knowledgePlan').add(new Option(item.plan.title + ' · ' + (item.plan.sdkVersion || '未填版本'), item.plan.id));
      get('knowledgePlan').value = list.some(item => item.plan.id === selected) ? selected : '';
      return list;
    }
    function load(item) { restore(item.plan); currentId = item.plan.id; serialized = item.serialized; get('knowledgePlan').value = currentId; }
    function guard(action) { try { action(); } catch (cause) { error(cause.message); } }
    function plan() { return root.DitaKnowledgePlan.normalizePlan({ ...read(), schema: 1, id: currentId }); }
    get('knowledgePlanSave').addEventListener('click', () => guard(() => {
      const value = plan(); serialized = store.save(value, serialized); refresh();
      storage.setItem('dita.knowledge.lastPlan', currentId); status('方案已保存；下次打开会恢复配置，重新核对来源后即可发布。');
    }));
    get('knowledgePlanLoad').addEventListener('click', () => guard(() => {
      const selected = get('knowledgePlan').value, item = store.list().find(entry => entry.plan.id === selected);
      if (!item) throw Error('请先选择已保存的方案'); load(item); status('方案已恢复，请逐份重新加入手册以核对最新内容。');
    }));
    // The selection itself does not discard a work-in-progress collection.
    get('knowledgePlanNew').addEventListener('click', () => guard(() => {
      currentId = 'plan-' + crypto.randomUUID(); serialized = null; get('knowledgePlan').value = '';
      status('已创建新方案，可保留当前集合另存；需要空白集合时点击“清空”。');
    }));
    get('knowledgePlanExport').addEventListener('click', () => guard(() => download(JSON.stringify(plan(), null, 2), 'knowledge-plan.json', 'application/json')));
    get('knowledgePlanImport').addEventListener('change', async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      try {
        if (file.size > 1024 * 1024) throw Error('方案 JSON 请限制在 1 MB 内');
        const value = root.DitaKnowledgePlan.normalizePlan(JSON.parse(await file.text()));
        value.id = 'plan-' + crypto.randomUUID(); restore(value); currentId = value.id; serialized = null; get('knowledgePlan').value = '';
        status('方案已导入，尚未保存。请在本机对应文档库中重新核对手册来源。');
      } catch (cause) { error(cause.message); }
    });
    function show() {
      guard(() => {
        const items = refresh(); if (loaded) return; loaded = true;
        const last = storage?.getItem('dita.knowledge.lastPlan'), item = items.find(entry => entry.plan.id === last);
        if (item && !read().sources.length) load(item);
      });
    }
    return { show };
  }
  root.DitaKnowledgePlansUI = { createPlansUI };
})(window);

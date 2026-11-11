'use strict';
(function (root) {
  function createController(A) {
    const get = id => document.getElementById(id), parts = new Map(), capture = root.DitaKnowledgeCapture.createCapture(A);
    let busy = false, operation = 0, abort, compiled = null, chosenModel = '';
    function invalidate() { compiled = null; }
    function controls() {
      for (const id of ['knowledgeAdd', 'knowledgeTitle', 'knowledgeSdk', 'knowledgeVersion', 'knowledgeFilter', 'knowledgePrefixes']) get(id).disabled = busy;
      get('knowledgeModel').disabled = busy || parts.size > 0;
      get('knowledgePreview').disabled = busy || !parts.size; get('knowledgeDownload').disabled = busy || !parts.size; get('knowledgeClear').disabled = busy || !parts.size;
      for (const input of get('knowledgeSources').querySelectorAll('input')) input.disabled = busy;
      for (const button of get('knowledgeCollection').querySelectorAll('button')) button.disabled = busy;
    }
    function renderCollection() {
      const list = get('knowledgeCollection'); list.replaceChildren();
      get('knowledgeCount').textContent = parts.size + ' 份手册';
      if (!parts.size) { const p = document.createElement('p'); p.className = 'knowledge-empty'; p.textContent = '从左侧选择功能手册，加入本次发布。\n切换文档库后，可以继续加入其它仓库的手册。'; list.append(p); }
      for (const part of parts.values()) {
        const card = document.createElement('article'), title = document.createElement('strong'), source = document.createElement('small'), details = document.createElement('p'), remove = document.createElement('button');
        card.className = 'knowledge-part'; title.textContent = part.title; source.textContent = part.source.repository + ' · ' + part.source.manualPath;
        details.textContent = part.model + ' · ' + part.entries.length + ' 章节 · ' + part.report.included + ' 注脚' + (part.version ? ' · ' + part.version : '') + (part.source.commit ? ' · ' + part.source.commit.slice(0, 8) : ' · 无 Git 提交信息');
        if (part.report.unmarked) details.textContent += ' · ' + part.report.unmarked + ' 条未标适用范围（按交付策略保留）';
        if (part.report.oxygenRevisions) details.textContent += ' · 含 ' + part.report.oxygenRevisions + ' 处 Oxygen 修订，请核对发布内容';
        remove.type = 'button'; remove.textContent = '移除'; remove.addEventListener('click', () => { parts.delete(part.id); if (!parts.size) chosenModel = ''; invalidate(); renderCollection(); });
        card.append(title, source, details, remove); list.append(card);
      }
      controls();
    }
    function sourceChoices() {
      const list = get('knowledgeSources'); list.replaceChildren();
      get('knowledgeRepository').textContent = A.state.root.split(/[\\/]/).filter(Boolean).pop() || '当前文档库';
      const paths = [...A.state.maps].map(map => ({ path: map.path, title: map.title || map.name || map.path }));
      if (A.state.activePath && !paths.some(item => item.path === A.state.activePath) && !/\.ditamap$/i.test(A.state.activePath)) paths.unshift({ path: A.state.activePath, title: '当前主题' });
      for (const entry of paths) {
        const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span'), small = document.createElement('small');
        input.type = 'checkbox'; input.value = entry.path; input.checked = entry.path === A.manual.scopePath();
        text.textContent = entry.title; small.textContent = entry.path; text.append(small); label.append(input, text); list.append(label);
      }
      if (!paths.length) list.textContent = '请先加载文档库或打开一个主题。';
    }
    async function show() {
      if (busy) return;
      get('knowledgeError').textContent = ''; sourceChoices(); renderCollection();
      if (!get('knowledgeTitle').value) get('knowledgeTitle').value = '模组开发者知识库';
      const models = new Set([...(A.project.value?.models || []), chosenModel].filter(Boolean));
      get('knowledgeModels').replaceChildren(...[...models].map(value => new Option(value, value)));
      get('knowledgeFilter').replaceChildren(new Option('不过滤正文', ''));
      get('knowledgeDialog').showModal();
      const generation = ++operation, workspace = A.api.token;
      try {
        const filters = await A.manual.listFilters();
        if (generation !== operation || workspace !== A.api.token || !get('knowledgeDialog').open) return;
        for (const path of filters.files) get('knowledgeFilter').add(new Option((filters.descriptions?.[path] || '条件文件') + ' · ' + path, path));
      } catch (error) { if (generation === operation) get('knowledgeError').textContent = '条件文件读取失败，暂不能加入手册：' + error.message; get('knowledgeAdd').disabled = true; }
    }
    function cancel() { abort?.abort(); operation++; busy = false; controls(); }
    async function add() {
      if (busy) return;
      const model = get('knowledgeModel').value.trim(), version = get('knowledgeVersion').value.trim();
      const paths = [...get('knowledgeSources').querySelectorAll('input:checked')].map(input => input.value);
      if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(model)) { get('knowledgeError').textContent = '请填写具体型号，例如 ML307G。'; return; }
      if (!paths.length) { get('knowledgeError').textContent = '请至少选择一份手册。'; return; }
      if (version.length > 80) { get('knowledgeError').textContent = '文档版本请限制在 80 字以内。'; return; }
      if (chosenModel && model !== chosenModel) { get('knowledgeError').textContent = '本发布集合已固定为 ' + chosenModel + '，请清空后更换型号。'; return; }
      const generation = ++operation, workspace = A.api.token;
      abort = new AbortController(); busy = true; controls(); get('knowledgeError').textContent = '';
      try {
        const staged = [];
        for (const [index, path] of paths.entries()) {
          get('knowledgeStatus').textContent = '正在检查并加入 ' + (index + 1) + '/' + paths.length + ' · ' + path;
          staged.push(await capture.collect(path, { model, version, filterPath: get('knowledgeFilter').value, prefixes: get('knowledgePrefixes').checked }, abort.signal));
          if (generation !== operation || workspace !== A.api.token) return;
        }
        if (staged.some(item => !item.current())) throw Error('源内容已变化，请重新加入本批手册。');
        if (new Set([...parts.keys(), ...staged.map(item => item.part.id)]).size > 30) throw Error('本版最多组合 30 份手册。');
        for (const { part } of staged) parts.set(part.id, part);
        chosenModel = model; invalidate(); renderCollection();
        get('knowledgeStatus').textContent = '已加入 ' + staged.length + ' 份手册快照，可预览或继续添加。';
      } catch (error) { if (generation === operation) { get('knowledgeError').textContent = error.message; get('knowledgeStatus').textContent = '加入未完成，已添加的其它手册仍保留。'; } }
      finally { if (generation === operation) { busy = false; controls(); } }
    }
    function build() {
      if (!compiled) compiled = root.DitaKnowledgePackage.buildPackage({ title: get('knowledgeTitle').value, model: chosenModel, sdkVersion: get('knowledgeSdk').value, manuals: [...parts.values()] });
      return compiled;
    }
    function preview() {
      try {
        get('knowledgeError').textContent = '';
        const output = build(); get('knowledgePreviewFrame').srcdoc = output.html; get('knowledgePreviewDialog').showModal();
      } catch (error) { get('knowledgeError').textContent = error.message; }
    }
    async function download() {
      if (busy) return;
      try {
        get('knowledgeError').textContent = ''; const output = build();
        A.downloadText(output.zip, output.filename, 'application/zip');
        get('knowledgeStatus').textContent = '已发起下载：' + output.filename + '；解压后打开 docs/index.html。'; A.setStatus('离线知识库已生成：' + output.filename);
      } catch (error) { get('knowledgeError').textContent = error.message; }
    }
    get('knowledgeButton').addEventListener('click', show); get('knowledgeAdd').addEventListener('click', add);
    get('knowledgeClose').addEventListener('click', () => { cancel(); get('knowledgeDialog').close(); });
    get('knowledgeDialog').addEventListener('cancel', cancel);
    get('knowledgePreview').addEventListener('click', preview); get('knowledgeDownload').addEventListener('click', download);
    get('knowledgePreviewClose').addEventListener('click', () => { get('knowledgePreviewDialog').close(); get('knowledgePreviewFrame').srcdoc = ''; });
    get('knowledgePreviewDialog').addEventListener('close', () => { get('knowledgePreviewFrame').srcdoc = ''; });
    get('knowledgeClear').addEventListener('click', () => { parts.clear(); chosenModel = ''; invalidate(); renderCollection(); get('knowledgeStatus').textContent = '发布集合已清空。'; });
    for (const id of ['knowledgeTitle', 'knowledgeSdk']) get(id).addEventListener('input', invalidate);
    A.events.on('workspace:willChange', cancel);
    return { show, get lastManifest() { return compiled?.manifest || null; } };
  }
  root.DitaKnowledge = { createController };
})(window);

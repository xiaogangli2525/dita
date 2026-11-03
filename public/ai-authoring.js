'use strict';
(function (root) {
  function createController(A) {
    const core = root.DitaAiEditCore, store = root.DitaDocumentStore, context = root.DitaAiContext.createContext(A);
    const get = id => document.getElementById(id), dialog = get('aiDialog');
    let selected = null, proposal = null, selection = null, filePath = '', token = '', manual = null;
    let controller = null, generation = 0, opening = 0, configuration = null, opener = null, busy = false, applying = false;
    const connection = root.DitaAiConnection.createController({ api: A.api, changed: value => { configuration = value; renderConfiguration(); clearResult(); }, pending: () => { clearResult(); controls(); } });
    function renderConfiguration() {
      get('aiProvider').textContent = configuration?.available ? '发送至 ' + configuration.destination + ' · ' + configuration.model : configuration?.message || '尚未配置模型连接';
      connection.show(configuration || { editable: false });
    }
    const say = (text, failure = false) => { get('aiStatus').textContent = text; get('aiStatus').classList.toggle('is-error', failure); };
    function controls() {
      const locked = busy || connection.saving;
      get('aiGenerate').disabled = locked || !configuration?.available || !selected || !get('aiInstruction').value.trim();
      get('aiLocate').disabled = locked; get('aiCancel').hidden = !busy;
      get('aiApply').disabled = locked || !proposal || !get('aiConfirm').checked;
      get('aiInputs').disabled = locked;
      get('aiConnectionFields').disabled = locked || !connection.editable;
      dialog.setAttribute('aria-busy', String(busy));
    }
    function clearResult() { proposal = null; get('aiReview').hidden = true; get('aiChanges').replaceChildren(); get('aiQuestions').replaceChildren(); get('aiConfirm').checked = false; controls(); }
    function stop() { generation++; controller?.abort(); controller = null; busy = false; controls(); }
    function fresh() {
      if (token !== A.api.token) throw Error('工作区已切换，请重新打开 AI 修订');
      if (manual && !A.manual.current(manual)) throw Error('手册内容或型号配置已变化，请重新定位');
      const file = selected && A.state.filesMap.get(selected.path);
      if (file && file.current !== selected.source) throw Error('原文已变化，请重新选择并生成建议');
    }
    function choose(hit) {
      clearResult();
      selected = { path: hit.path, ...core.target(hit.source, hit.start, hit.end) };
      get('aiOriginal').textContent = selected.text;
      get('aiLocation').textContent = hit.path + ' · 第 ' + hit.source.slice(0, hit.start).split('\n').length + ' 行';
      get('aiConditions').textContent = selected.conditions.length ? '原文条件：' + selected.conditions.join('；') : '原文没有显式型号条件；请核对文字中的型号说明及共享内容影响。';
      get('aiSource').hidden = false; say('已选定原文。生成时仅发送问题、目标型号、此处文字和适用条件。'); controls();
    }
    async function locate() {
      stop(); clearResult(); selected = null; manual = null; get('aiSource').hidden = true;
      const id = generation; busy = true; controls(); say('正在当前范围内定位原文…'); get('aiCandidates').replaceChildren();
      try {
        if (get('aiScope').value === 'selection') {
          if (!selection) throw Error('没有可用选区，请关闭后选择文字，或切换到章节/手册搜索');
          choose(selection); fresh(); return;
        }
        const query = get('aiSearch').value.trim() || get('aiInstruction').value.trim();
        if (!query) throw Error('请输入问题描述，或填写命令、参数等定位关键词');
        const result = await context.locate(get('aiScope').value, query, filePath);
        if (id !== generation || token !== A.api.token) return;
        manual = result.snapshot || null;
        for (const hit of result.hits) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'ai-candidate';
          const title = document.createElement('strong'), excerpt = document.createElement('span');
          title.textContent = hit.path + ' · ' + hit.kind; excerpt.textContent = hit.text.slice(0, 240);
          button.append(title, excerpt);
          button.addEventListener('click', () => { try { choose(hit); fresh(); get('aiCandidates').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); } catch (error) { selected = null; controls(); say(error.message, true); } });
          button.setAttribute('aria-pressed', 'false'); get('aiCandidates').append(button);
        }
        say((result.hits.length ? '找到 ' + result.hits.length + ' 处候选，请选择需要修改的原文。' : '未找到匹配原文，请改用命令、参数或原文关键词。') + (result.truncated ? ' 已显示前 30 处，请缩小关键词范围。' : '') + (result.warnings.length ? ' ' + result.warnings.join('；') : ''));
      } catch (error) { if (id === generation) say(error.message, true); }
      finally { if (id === generation) { busy = false; controls(); } }
    }
    function renderResult(result) {
      get('aiReview').hidden = false; get('aiSummary').textContent = result.summary;
      get('aiReviewTitle').textContent = result.questions.length ? '需要你确认' : result.changes.length ? '审核修改建议' : '无需修改';
      for (const question of result.questions) { const li = document.createElement('li'); li.textContent = question; get('aiQuestions').append(li); }
      for (const change of result.changes) {
        const row = document.createElement('div'); row.className = 'ai-change';
        for (const [label, value, name] of [['原文', change.text, 'before'], ['建议', change.after, 'after']]) {
          const cell = document.createElement('div'), heading = document.createElement('strong'), text = document.createElement('pre');
          cell.className = 'ai-' + name; heading.textContent = label; text.textContent = value || '（删除文字）'; cell.append(heading, text); row.append(cell);
        }
        get('aiChanges').append(row);
      }
      get('aiAcceptArea').hidden = !result.changes.length;
      get('aiReview').scrollIntoView({ block: 'nearest' });
    }
    async function generate() {
      if (busy) return;
      clearResult();
      const id = ++generation, instruction = get('aiInstruction').value.trim(), targetModel = get('aiModel').value.trim();
      try {
        fresh(); if (!selected) throw Error('请先选择要修改的原文');
        const captured = selected, workspaceToken = token;
        // Capture before awaiting the model; a later editor buffer is never the base.
        const fileSnapshot = store.createDocument({ path: captured.path, content: captured.source });
        controller = new AbortController(); busy = true; controls(); say('正在生成建议…你可以随时取消，原文尚未修改。');
        const response = await A.api.request('/api/ai/propose', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ source: captured.source, start: captured.start, end: captured.end, instruction, targetModel }) });
        if (!response.ok) throw Error(await A.api.error(response));
        const result = core.applyResult(captured, await response.json());
        if (id !== generation) return;
        fresh(); renderResult(result);
        if (result.changes.length) proposal = store.createProposal({ file: fileSnapshot, workspaceToken, content: result.content, instruction }, A.validateXml);
        say(result.questions.length ? '请补充已核实的信息后重新生成。' : result.changes.length ? '请核对技术事实、型号范围和前后文字，再应用建议。' : '原文保持不变。');
      } catch (error) { if (id === generation) say(error.name === 'AbortError' ? '已取消生成，原文保持不变。' : error.message, error.name !== 'AbortError'); }
      finally { if (id === generation) { controller = null; busy = false; controls(); } }
    }
    async function apply() {
      if (!proposal || busy || !get('aiConfirm').checked) return;
      const pending = proposal, id = ++generation;
      try {
        fresh(); busy = true; controls();
        let file = A.state.filesMap.get(pending.path);
        if (!file) { await A.openFile(pending.path); file = A.state.filesMap.get(pending.path); }
        if (id !== generation) return;
        fresh();
        applying = true;
        try { store.applyProposal(pending, { file, workspaceToken: A.api.token }, A.validateXml, A.setFileContent); }
        finally { applying = false; }
        clearResult(); selected = null; get('aiSource').hidden = true;
        say('已应用到编辑区，可撤销；尚未保存到文件。'); A.setStatus('AI 建议已应用 · 可撤销 · 请核对后保存');
      } catch (error) { if (id === generation) say(error.message, true); }
      finally { if (id === generation) { busy = false; controls(); } }
    }
    async function show() {
      if (document.querySelector('dialog[open]')) return;
      stop(); clearResult(); selected = null; manual = null; configuration = null; token = A.api.token;
      opener = document.activeElement; filePath = context.currentPath(); selection = null;
      let warning = '';
      try { selection = context.captureSelection(); } catch (error) { warning = error.message; }
      get('aiScope').value = selection ? 'selection' : /\.ditamap$/i.test(filePath) ? 'manual' : 'topic';
      get('aiSource').hidden = true; get('aiCandidates').replaceChildren();
      get('aiProvider').textContent = '正在检查模型配置…'; dialog.showModal(); get('aiInstruction').focus();
      if (selection) choose(selection);
      else say(warning || '粘贴问题描述，或填写修改要求，然后定位原文。', Boolean(warning));
      const id = ++opening;
      try {
        const response = await A.api.request('/api/ai/config'); if (!response.ok) throw Error(await A.api.error(response));
        const value = await response.json(); if (id !== opening || !dialog.open) return;
        configuration = value;
        renderConfiguration();
      } catch (error) { if (id === opening) get('aiProvider').textContent = error.message; }
      controls();
    }
    get('aiButton').addEventListener('mousedown', event => event.preventDefault());
    function close() {
      opening++; stop(); connection.clearKey(); dialog.close();
      const previous = opener; opener = null;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    }
    get('aiButton').addEventListener('click', show); get('aiClose').addEventListener('click', close);
    get('aiLocate').addEventListener('click', locate); get('aiGenerate').addEventListener('click', generate); get('aiApply').addEventListener('click', apply);
    get('aiCancel').addEventListener('click', () => { stop(); say('已取消生成，原文保持不变。'); });
    get('aiReject').addEventListener('click', () => { clearResult(); say('已放弃建议，原文保持不变。'); });
    get('aiConfirm').addEventListener('change', controls);
    for (const id of ['aiInstruction', 'aiModel']) get(id).addEventListener('input', clearResult);
    get('aiScope').addEventListener('change', () => { clearResult(); selected = null; get('aiSource').hidden = true; get('aiCandidates').replaceChildren(); controls(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (!dialog.open && opener) close(); });
    A.events.on('workspace:willChange', () => { stop(); clearResult(); selected = selection = null; get('aiInstruction').value = ''; get('aiModel').value = ''; close(); });
    A.events.on('document:changed', () => {
      if (!dialog.open || !selected || applying) return;
      try { fresh(); } catch (error) { stop(); clearResult(); selected = null; controls(); say(error.message, true); }
    });
    return { show };
  }
  root.DitaAiAuthoring = { createController };
})(window);

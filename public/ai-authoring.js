'use strict';
(function (root) {
  function createController(A) {
    const core = root.DitaAiEditCore, store = root.DitaDocumentStore, conversationCore = root.DitaAiConversation;
    const context = root.DitaAiContext.createContext(A), get = id => document.getElementById(id), dialog = get('aiDialog');
    let selected = null, proposal = null, selection = null, filePath = '', token = '', manual = null, thread = null;
    let controller = null, generation = 0, opening = 0, configuration = null, opener = null, busy = false, applying = false;
    const connection = root.DitaAiConnection.createController({ api: A.api, events: A.events,
      changed: value => { configuration = value; renderConfiguration(); controls(); }, pending: () => controls() });
    const scanner = root.DitaAiScan.createController(A, {
      path: () => filePath, available: () => configuration?.available && !connection.saving,
      prepare: prepareScanEdit, leave: close
    });
    const say = (text, failure = false) => { for (const id of ['aiStatus', 'aiReplyStatus']) { get(id).textContent = text; get(id).classList.toggle('is-error', failure); } };
    function renderConfiguration() {
      get('aiProvider').textContent = configuration?.available ? configuration.model + ' · ' + (configuration.persisted ? '连接已保存' : '使用启动配置') : '尚未配置模型，点击右上角“模型设置”配置一次即可。';
      get('aiProvider').title = configuration?.destination || configuration?.message || '';
      connection.sync(configuration || {});
    }
    function controls() {
      const locked = busy || connection.saving, continued = Boolean(get('aiConversation').children.length);
      get('aiNewTask').hidden = !continued; get('aiNewTask').disabled = locked;
      get('aiLocate').disabled = locked; get('aiCancel').hidden = !busy;
      get('aiApply').disabled = locked || !proposal; get('aiInputs').disabled = locked; get('aiSettingsButton').disabled = locked;
      get('aiScanButton').disabled = locked || !filePath || !configuration;
      get('aiComposer').hidden = false; get('aiReply').disabled = connection.saving;
      get('aiStatus').hidden = true; get('aiWelcome').hidden = continued || busy;
      get('aiSend').disabled = locked || !configuration?.available || !filePath || !get('aiReply').value.trim();
      dialog.setAttribute('aria-busy', String(busy));
    }
    function clearResult() { proposal = null; get('aiReview').hidden = true; get('aiChanges').replaceChildren(); controls(); }
    function resetThread() {
      thread = selected ? conversationCore.create(selected) : null;
      get('aiConversation').replaceChildren(); get('aiConversation').hidden = true;
      get('aiTask').open = false; clearResult();
    }
    function stop() { generation++; controller?.abort(); controller = null; busy = false; controls(); }
    function fresh() {
      if (token !== A.api.token) throw Error('工作区已切换，请重新打开 AI 修订');
      if (manual && !A.manual.current(manual)) throw Error('手册内容或型号配置已变化，请重新定位');
      const file = selected && A.state.filesMap.get(selected.path);
      if (file && file.current !== selected.source) throw Error('原文已变化，请重新选择并生成修改');
    }
    function drawSource() {
      get('aiContextLabel').textContent = selected ? (selected.kind === 'document' ? '当前章节 · ' : '当前选区 · ') + selected.path + (selected.truncated ? ' · 本轮聚焦相关片段' : '') : '当前文档 · ' + (filePath || '请先打开文档');
      get('aiSource').hidden = !selected;
      if (!selected) return;
      get('aiOriginal').textContent = selected.text;
      get('aiLocation').textContent = selected.path + ' · 第 ' + selected.source.slice(0, selected.start).split('\n').length + ' 行';
      const conditions = [...new Set(selected.parts.flatMap(part => part.conditions || selected.conditions))];
      get('aiConditions').textContent = selected.kind === 'document' ? '保留各片段原有适用条件，具体变化见修改对照。' : conditions.length ? '选区包含适用条件：' + conditions.join('；') + '（按片段保留）' : '共享原文：修改时保留文字中的型号差异。';
    }
    function choose(hit) {
      selected = { path: hit.path, ...core.target(hit.source, hit.start, hit.end) };
      resetThread(); drawSource(); say('已选定原文。说明要求后即可修改，后续可以直接接着对话。'); controls();
      get('aiSource').open = false;
    }
    function prepareScanEdit(hit, finding, snapshot) {
      if (!A.manual.current(snapshot)) throw Error('手册内容已变化，请重新扫描。');
      choose(hit); manual = snapshot; fresh();
      get('aiCandidates').replaceChildren(); get('aiModel').value = '';
      const input = get('aiReply');
      if (finding.category === 'wording') {
        input.value = '请只修订当前选中的原文，保留所有技术事实和型号范围。扫描问题：' + finding.summary + '。建议：' + finding.suggestion;
        controls(); void generate();
      } else {
        input.value = '';
        get('aiSource').open = true;
        say('已选定修订位置。请核对「' + finding.summary + '」，然后在下方写明以哪处为准或填写核实结果。');
        controls(); queueMicrotask(() => input.focus({ preventScroll: true }));
      }
    }
    function chooseDocument(file, query) {
      selected = { path: file.path, ...core.documentTarget(file.source ?? file.current, query) };
      resetThread(); drawSource(); get('aiSource').open = false; get('aiCandidates').replaceChildren();
    }
    async function automaticTarget(instruction, id) {
      if (get('aiScope').value === 'selection') {
        if (!selection) throw Error('没有可用选区，请选择当前章节，或重新选择文字后打开 AI');
        choose(selection); return true;
      }
      const file = A.state.filesMap.get(filePath);
      if (file && !/\.ditamap$/i.test(filePath) && get('aiScope').value !== 'manual') { chooseDocument(file, instruction); return true; }
      const result = await context.locate('manual', instruction, filePath);
      if (id !== generation || token !== A.api.token) return false;
      manual = result.snapshot || null;
      const files = new Map();
      for (const hit of result.hits) if (!files.has(hit.path)) files.set(hit.path, hit);
      if (!files.size && manual) for (const file of manual.files.values()) {
        try { core.inspect(file.current); files.set(file.path, { path: file.path, source: file.current, score: 0, text: file.path }); } catch { /* Non-topic dependencies are not edit targets. */ }
      }
      const hits = [...files.values()].sort((a, b) => b.score - a.score);
      if (hits.length === 1 || hits.length > 1 && hits[0].score > hits[1].score * 1.3 + 2) { chooseDocument(hits[0], instruction); return true; }
      get('aiCandidates').replaceChildren();
      for (const hit of hits.slice(0, 8)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'ai-candidate'; button.textContent = hit.path + ' · ' + hit.text.slice(0, 100);
        button.addEventListener('click', () => { try { chooseDocument(hit, instruction); fresh(); generate(true); } catch (error) { say(error.message, true); } });
        get('aiCandidates').append(button);
      }
      say(hits.length ? '当前打开的是整份手册，有多个相关章节。先选一个章节，我会接着这条要求给出方案。' : '没有找到可编辑章节，请打开具体 Topic 后直接聊天。');
      return false;
    }
    async function locate() {
      stop(); selected = null; manual = null; resetThread(); drawSource();
      const id = generation; busy = true; controls(); say('正在当前范围内定位原文…'); get('aiCandidates').replaceChildren();
      try {
        if (get('aiScope').value === 'selection') {
          if (!selection) throw Error('没有可用选区，请关闭后选择文字，或切换到章节/手册搜索');
          choose(selection); fresh(); return;
        }
        const query = get('aiSearch').value.trim() || get('aiReply').value.trim();
        if (!query) throw Error('请输入问题描述，或填写命令、参数等定位关键词');
        const result = await context.locate(get('aiScope').value, query, filePath);
        if (id !== generation || token !== A.api.token) return;
        manual = result.snapshot || null;
        for (const hit of result.hits) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'ai-candidate';
          const title = document.createElement('strong'), excerpt = document.createElement('span');
          title.textContent = hit.path + ' · ' + hit.kind; excerpt.textContent = hit.text.slice(0, 240); button.append(title, excerpt);
          button.addEventListener('click', () => { try { choose(hit); fresh(); if (get('aiReply').value.trim()) generate(true); } catch (error) { selected = null; controls(); say(error.message, true); } });
          button.setAttribute('aria-pressed', 'false'); get('aiCandidates').append(button);
        }
        say((result.hits.length ? '找到 ' + result.hits.length + ' 处候选，请选择需要修改的原文。' : '未找到匹配原文，请改用命令、参数或原文关键词。') + (result.truncated ? ' 已显示前 30 处，请缩小关键词范围。' : '') + (result.warnings.length ? ' ' + result.warnings.join('；') : ''));
      } catch (error) { if (id === generation) say(error.message, true); }
      finally { if (id === generation) { busy = false; controls(); } }
    }
    function appendTurn(instruction, result) {
      const log = get('aiConversation'); log.hidden = false;
      get('aiQuestions')?.removeAttribute('id');
      for (const [who, text] of [['user', instruction], ['assistant', result.summary]]) {
        const item = document.createElement('article'), heading = document.createElement('strong'), message = document.createElement('p');
        item.className = 'ai-turn ai-turn-' + who; heading.textContent = who === 'user' ? '你' : 'AI'; message.textContent = text;
        item.append(heading, message);
        if (who === 'assistant') {
          const questions = document.createElement('ul'); questions.id = 'aiQuestions';
          for (const question of result.questions) { const li = document.createElement('li'); li.textContent = question; questions.append(li); }
          item.append(questions);
          if (result.blockedReason) { const note = document.createElement('p'); note.textContent = result.blockedReason; item.append(note); }
        }
        log.append(item);
      }
    }
    function renderResult(result) {
      get('aiReview').hidden = !result.changes.length;
      get('aiReviewTitle').textContent = '修改提案 · ' + result.changes.length + ' 处';
      const flags = [...new Set(result.changes.flatMap(change => change.reviewFlags))];
      get('aiTechnicalReview').hidden = !flags.length; get('aiTechnicalReview').textContent = '请核对技术信息：' + flags.join('、') + '。这些提示不代表技术事实已经验证。';
      for (const change of result.changes) {
        const row = document.createElement('div'); row.className = 'ai-change';
        const location = document.createElement('p'); location.className = 'ai-change-location'; location.textContent = '第 ' + selected.source.slice(0, change.start).split('\n').length + ' 行' + (change.conditions?.length ? ' · ' + change.conditions.join('；') : ''); row.append(location);
        for (const [label, value, name] of [['原文', change.text, 'before'], ['修改后', change.after, 'after']]) {
          const cell = document.createElement('div'), heading = document.createElement('strong'), text = document.createElement('pre');
          cell.className = 'ai-' + name; heading.textContent = label; text.textContent = value || '（删除文字）'; cell.append(heading, text); row.append(cell);
        }
        get('aiChanges').append(row);
      }
      get('aiAcceptArea').hidden = !result.changes.length;
    }
    async function generate(followup = true, applyCommand = '') {
      if (busy || connection.saving) return;
      const input = get('aiReply'), instruction = input.value.trim();
      const id = ++generation, targetModel = get('aiModel').value.trim();
      try {
        fresh(); busy = true; controls(); say('正在结合当前内容处理这条要求…');
        if (!selected && !await automaticTarget(instruction, id)) return;
        if (id !== generation) return;
        fresh(); if (!selected || !thread) throw Error('请先打开要修改的章节');
        const captured = selected, workspaceToken = token, conversation = thread.context(instruction);
        const fileSnapshot = store.createDocument({ path: captured.path, content: captured.source });
        controller = new AbortController(); busy = true; controls(); say('正在按要求修改…可以先填写下一条要求。');
        const response = await A.api.request('/api/ai/propose', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ source: captured.source, start: captured.start, end: captured.end, instruction, targetModel, conversation, targetKind: captured.kind === 'document' ? 'document' : 'range', ...(captured.query !== undefined ? { query: captured.query } : {}) }) });
        if (!response.ok) throw Error(await A.api.error(response));
        const raw = await response.json(), result = core.applyResult(captured, raw);
        if (id !== generation) return;
        fresh();
        const next = result.changes.length ? store.createProposal({ file: fileSnapshot, workspaceToken, content: result.content, instruction }, A.validateXml) : null;
        thread.record(instruction, raw); clearResult(); proposal = next;
        appendTurn(instruction, raw); renderResult(result); get('aiTask').open = false; get('aiSource').open = false;
        if (followup && input.value.trim() === instruction) input.value = '';
        say(result.changes.length ? '方案和修改提案已生成。可继续纠正，确认后应用。' : result.questions.length ? '直接补充这些信息，我会接着处理。' : result.blockedReason ? '当前范围的限制已说明，可继续调整要求。' : '可以继续纠正方案，或说“按这个改”执行方案。');
        if (applyCommand && proposal && !result.changes.some(change => change.reviewFlags.length)) { controller = null; busy = false; controls(); await apply(applyCommand); }
        else if (applyCommand && proposal) { get('aiDiff').open = true; say('方案已生成具体修改，涉及技术信息变化，请先核对对照，再应用。'); }
      } catch (error) { if (id === generation) say(error.name === 'AbortError' ? '已取消本轮，保留已有对话和提案。' : error.message, error.name !== 'AbortError'); }
      finally {
        if (id === generation) { controller = null; busy = false; controls(); if (get('aiConversation').children.length) { get('aiReply').focus({ preventScroll: true }); dialog.scrollTop = dialog.scrollHeight; } }
      }
    }
    async function apply(command = '') {
      if (!proposal || busy || connection.saving) return;
      const pending = proposal, captured = selected, history = thread.context(), id = ++generation;
      try {
        fresh(); busy = true; controls();
        let file = A.state.filesMap.get(pending.path);
        if (!file) { await A.openFile(pending.path); file = A.state.filesMap.get(pending.path); }
        if (id !== generation) return;
        fresh(); applying = true;
        try { store.applyProposal(pending, { file, workspaceToken: A.api.token }, A.validateXml, A.setFileContent); }
        finally { applying = false; }
        clearResult(); manual = null;
        try {
          selected = { path: pending.path, ...(captured.kind === 'document' ? core.documentTarget(pending.after, captured.query) : core.target(pending.after, captured.start, captured.end + pending.after.length - pending.before.length)) };
          thread = conversationCore.create(selected, { instructions: history.instructions, previousResult: { ...history.previousResult, edits: [] } });
        } catch { selected = null; thread = null; /* A deliberately emptied range has no editable text left. */ }
        drawSource();
        if (command && get('aiReply').value.trim() === command) get('aiReply').value = '';
        const note = document.createElement('p'); note.className = 'ai-applied'; note.textContent = (command ? '已按“' + command + '”应用修改' : '以上修改已应用到编辑区') + ' · 可撤销'; get('aiConversation').append(note);
        say(selected ? '已应用，可继续对话修改同一位置；正常保存才写入文件。' : '已应用，此处已无可编辑文字，请重新定位。');
        A.setStatus('AI 修改已应用 · 可撤销 · 请核对后保存');
      } catch (error) { if (id === generation) say(error.message, true); }
      finally { if (id === generation) { busy = false; controls(); if (selected) get('aiReply').focus({ preventScroll: true }); } }
    }
    async function show() {
      if (document.querySelector('dialog[open]')) return;
      let capturedSelection = null, warning = ''; const nextPath = context.currentPath() || A.state.selectedMap || '';
      try { capturedSelection = context.captureSelection(); } catch (error) { warning = error.message; }
      let resume = Boolean(selected && token === A.api.token && (filePath === nextPath || selected.path === nextPath));
      if (resume && capturedSelection && (selected.path !== capturedSelection.path || selected.start !== capturedSelection.start || selected.end !== capturedSelection.end)) resume = false;
      if (resume) try { fresh(); } catch { resume = false; }
      stop(); opener = document.activeElement;
      if (!resume) {
        if (token && (token !== A.api.token || filePath !== nextPath)) get('aiReply').value = '';
        selected = null; manual = null; token = A.api.token; filePath = nextPath; selection = capturedSelection; resetThread();
        get('aiCandidates').replaceChildren(); get('aiScope').value = selection ? 'selection' : /\.ditamap$/i.test(filePath) ? 'manual' : 'topic';
        if (selection) choose(selection); else { drawSource(); say(warning || '', Boolean(warning)); }
      }
      drawSource(); dialog.showModal(); get('aiReply').focus();
      const id = ++opening;
      try {
        const response = await A.api.request('/api/ai/config'); if (!response.ok) throw Error(await A.api.error(response));
        const value = await response.json(); if (id !== opening || !dialog.open) return;
        configuration = value; renderConfiguration();
      } catch (error) { if (id === opening) get('aiProvider').textContent = error.message; }
      controls();
    }
    function close() {
      opening++; stop(); dialog.close(); const previous = opener; opener = null;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    }
    function send() {
      if (busy || connection.saving) return;
      const instruction = get('aiReply').value.trim();
      // An explicit user command can apply the already visible proposal through
      // exactly the same guarded operation as the Apply button. Never inspect
      // model text for this command, or infer consent from an ambiguous "好".
      if (/^(?:应用这版|应用修改|按这个改|就按这个改)[。！!]?$/u.test(instruction)) {
        if (proposal) return apply(instruction);
        if (thread?.context().previousResult && !thread.context().previousResult.questions.length) return generate(true, instruction);
        say('当前没有可应用的修改，请先补充缺少的信息或说明具体修改要求。', true); return;
      }
      return generate(true);
    }
    get('aiButton').addEventListener('mousedown', event => event.preventDefault());
    get('aiButton').addEventListener('click', show); get('aiClose').addEventListener('click', close);
    get('aiSettingsButton').addEventListener('click', () => connection.open());
    get('aiScanButton').addEventListener('click', scanner.open);
    get('aiLocate').addEventListener('click', locate);
    get('aiSend').addEventListener('click', send); get('aiApply').addEventListener('click', () => apply());
    get('aiCancel').addEventListener('click', () => { stop(); say('已取消本轮，保留已有对话和提案。'); });
    get('aiReject').addEventListener('click', () => {
      if (selected && thread) thread = conversationCore.create(selected, { instructions: thread.context().instructions, previousResult: { summary: '用户已放弃上一版提案，请根据接下来的要求重新修改。', questions: [], edits: [] } });
      clearResult(); say('已放弃当前提案，保留对话；可在下方继续说明。');
    });
    get('aiNewTask').addEventListener('click', () => { if (selected?.kind === 'document') { filePath = selected.path; selected = null; manual = null; } resetThread(); get('aiReply').value = ''; drawSource(); controls(); get('aiReply').focus(); say('可以直接输入新的修改要求。'); });
    get('aiReply').addEventListener('input', controls);
    get('aiReply').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && !get('aiSend').disabled) { event.preventDefault(); send(); } });
    get('aiModel').addEventListener('input', () => { if (get('aiConversation').children.length) resetThread(); controls(); });
    document.querySelectorAll('[data-ai-start]').forEach(button => button.addEventListener('click', () => { get('aiReply').value = button.dataset.aiStart; controls(); send(); }));
    get('aiScope').addEventListener('change', () => { const expanded = get('aiTask').open; selected = null; manual = null; resetThread(); get('aiTask').open = expanded; drawSource(); get('aiCandidates').replaceChildren(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { if (!dialog.open && opener) close(); });
    A.events.on('workspace:willChange', () => { stop(); selected = selection = manual = null; resetThread(); get('aiReply').value = ''; get('aiModel').value = ''; close(); });
    A.events.on('document:changed', () => {
      if (!dialog.open || !selected || applying) return;
      try { fresh(); } catch (error) { stop(); selected = null; resetThread(); controls(); say(error.message, true); }
    });
    return { show, configure: () => connection.open() };
  }
  root.DitaAiAuthoring = { createController };
})(window);

'use strict';
(function (root) {
  function createController({ A, parts, error }) {
    const get = id => document.getElementById(id), dialog = get('knowledgeChunksDialog'), frame = get('knowledgeChunksSource');
    let manuals = [], operation = 0, abort;
    const kinds = { heading: '标题', paragraph: '段落', 'table-row': '参数／表格行', code: '代码示例', step: '操作步骤', definition: '参数定义', note: '注意事项', figure: '图片说明', 'list-item': '列表项', legacy: '文本分片' };
    function cancel() { operation++; abort?.abort(); }
    function close() { cancel(); dialog.close(); frame.srcdoc = ''; }
    function selected() {
      const [manual, entry] = get('knowledgeChunksEntry').value.split('/').map(Number);
      return { manual: manuals[manual], entry: manuals[manual]?.entries[entry] };
    }
    function locate(anchor) {
      const doc = frame.contentDocument;
      doc?.querySelectorAll('[data-chunk-active]').forEach(node => node.removeAttribute('data-chunk-active'));
      const element = doc?.getElementById(anchor);
      if (element) { element.setAttribute('data-chunk-active', ''); element.scrollIntoView({ block: 'center', behavior: 'auto' }); }
    }
    async function generate() {
      cancel(); const generation = operation, workspace = A.api.token, { manual, entry } = selected();
      if (!entry) return;
      const list = get('knowledgeChunksList'), summary = get('knowledgeChunksSummary'), legacy = get('knowledgeChunksStrategy').value === 'legacy';
      list.replaceChildren(); summary.classList.remove('knowledge-error'); summary.textContent = '正在计算模型 Token 与片段…';
      get('knowledgeChunksGenerate').disabled = true;
      frame.srcdoc = root.DitaKnowledgeDocument.chapterPage(manual.body, entry.anchor);
      abort = new AbortController();
      try {
        const record = { ...entry, manualId: manual.id, manualTitle: manual.title, mode: manual.mode, module: manual.module };
        const response = await A.api.request('/api/knowledge/chunks', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ record, position: 0, strategy: legacy ? 'legacy' : 'structure' }), signal: abort.signal });
        if (!response.ok) throw Error(await A.api.error(response));
        const value = await response.json();
        if (generation !== operation || workspace !== A.api.token || !dialog.open) return;
        const profile = legacy ? root.DitaKnowledgeSemantic.LEGACY_PROFILE : root.DitaKnowledgeSemantic.PROFILE;
        if (value.profile !== profile.id || !Array.isArray(value.chunks)) throw Error('分片配置已变化，请刷新工作台后重试');
        const chunks = value.chunks;
        summary.textContent = chunks.length + ' 个片段 · ' + (legacy ? '旧版长度分片' : entry.structure ? entry.structure.units.length + ' 个结构块' : '此章节只有纯文本，使用长度分片') +
          ' · 最长 ' + Math.max(0, ...chunks.map(chunk => chunk.tokenCount)) + ' / 512 Token' + (chunks.some(chunk => chunk.split) ? ' · 含超长结构块分段，请结合原文核对' : '');
        for (const [index, chunk] of chunks.entries()) {
          const card = document.createElement('article'), head = document.createElement('div'), label = document.createElement('strong'), metric = document.createElement('span');
          card.className = 'knowledge-chunk'; head.className = 'knowledge-chunk-heading'; label.textContent = '片段 ' + (index + 1) + ' · ' + (kinds[chunk.kind] || '文本分片');
          metric.textContent = chunk.tokenCount + ' Token'; head.append(label, metric);
          const context = document.createElement('p'); context.className = 'knowledge-hint'; context.textContent = [entry.title, ...(chunk.section || [])].join(' › ');
          const text = document.createElement('pre'); text.textContent = chunk.text;
          const footer = document.createElement('div'); footer.className = 'knowledge-chunk-footer';
          const notes = document.createElement('span'); notes.textContent = (chunk.noteIds?.length || 0) + ' 条关联注脚' + (chunk.split ? ' · 超长块分段' : '');
          const button = document.createElement('button'); button.type = 'button'; button.textContent = '定位原文'; button.addEventListener('click', () => locate(chunk.sourceAnchor || entry.anchor)); footer.append(notes, button);
          const details = document.createElement('details'), title = document.createElement('summary'), source = document.createElement('p'); title.textContent = '来源与片段标识';
          source.textContent = [manual.source.repository, manual.source.commit || '未提交版本', entry.sourcePath || '', chunk.unitId || '旧版片段', chunk.unitFingerprint || entry.fingerprint || ''].filter(Boolean).join(' · ');
          details.append(title, source); card.append(head, context, text, footer, details); list.append(card);
        }
      } catch (cause) {
        if (generation === operation && dialog.open) { summary.textContent = cause.message; summary.classList.add('knowledge-error'); }
      } finally { if (generation === operation) get('knowledgeChunksGenerate').disabled = false; }
    }
    function show() {
      manuals = structuredClone(parts().filter(Boolean));
      if (!manuals.length) { error('请先核对手册来源'); return; }
      const select = get('knowledgeChunksEntry'); select.replaceChildren(); let preferred = '', command = '';
      for (const [i, manual] of manuals.entries()) {
        const group = document.createElement('optgroup'); group.label = manual.title;
        for (const [j, entry] of manual.entries.entries()) { const option = new Option(entry.title, i + '/' + j); group.append(option); if (!preferred && entry.kind === 'reference') preferred = option.value; if (!command && /^AT\+/i.test(entry.title)) command = option.value; }
        select.append(group);
      }
      if (command || preferred) select.value = command || preferred;
      get('knowledgeChunksStrategy').value = 'structure'; dialog.showModal(); void generate();
    }
    get('knowledgeChunksEntry').addEventListener('change', () => void generate());
    get('knowledgeChunksStrategy').addEventListener('change', () => void generate());
    get('knowledgeChunksGenerate').addEventListener('click', () => void generate());
    get('knowledgeChunksClose').addEventListener('click', close); dialog.addEventListener('cancel', cancel); dialog.addEventListener('close', () => { cancel(); frame.srcdoc = ''; });
    return { show, close };
  }
  root.DitaKnowledgeChunkPreview = { createController };
})(window);

'use strict';
(function (root) {
  /** @param {import('./contracts').ExportPorts} A */
  function createExportController(A, { loadImageBytes, createView = () => root.DitaDeliveryView.createView() } = {}) {
    let exporting = false, previewUrl = '', lastDeliveryRecord = null, lastExportReport = null;
    function releaseExportPreview() {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = '';
    }
    root.addEventListener('beforeunload', releaseExportPreview);
    async function browserLoadImageBytes(path, signal) {
      const response = await A.api.request('/api/asset?path=' + encodeURIComponent(path), { signal });
      if (!response.ok) throw new Error(`图片加载失败：${path}`);
      const blob = await response.blob();
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`图片读取失败：${path}`));
        reader.readAsDataURL(blob);
      });
      const image = new Image(); image.src = data;
      let timer;
      try { await Promise.race([image.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('图片解码超时：' + path)), 10000); })]); }
      finally { clearTimeout(timer); }
      if (signal?.aborted) throw new Error('已取消');
      return data;
    }

    const get = id => document.getElementById(id);
    let deliveryView;
    const view = () => deliveryView || (deliveryView = createView());
    let configuration = null, configuring = false, compiled = null, operation = 0, abortController = null;
    let filterGeneration = 0;
    const selectedFilters = new Map();
    let configuringScope = '', configuringWorkspace = '';
    const service = () => A.manual;
    const nativePdf = () => A.state.capabilities?.pdf === true;
    function formatHint() {
      const format = get('exportFormat').value;
      get('exportFormatHint').textContent = format === 'docx' ? '导出可编辑的 Word 文档，注脚统一附在文末。预览显示内容，最终分页由 Word 决定。' : format === 'pdf' ? nativePdf() ? '生成可搜索文字的 PDF，注脚附在文末。' : '此在线演示将打开打印内容预览。点击预览上方“打印 / 另存 PDF”，在打印窗口选择“另存为 PDF”。打印不写入交付记录。' : '';
      const option = get('exportFormat').querySelector('option[value="pdf"]'); if (option) option.textContent = nativePdf() ? 'PDF' : 'PDF（打印另存）';
      const button = get('modelExportForm').querySelector('[value="download"]'); if (button) button.textContent = format === 'pdf' && !nativePdf() ? '打开打印预览' : '导出文件';
    }
    function issue(error, snapshot) {
      if (error.issues) return error.issues.map(item => ({ ...item, severity: 'error' }));
      const path = snapshot ? [...snapshot.files.keys(), snapshot.path].find(path => error.message.startsWith(path + '：')) : '';
      return [{ path: path || '', severity: 'error', message: error.message }];
    }
    function showIssues(issues) {
      const list = get('deliveryChecks'); if (!list) return;
      list.replaceChildren();
      for (const item of issues) {
        const row = document.createElement('li'); row.className = 'check-' + item.severity;
        row.append(document.createTextNode((item.severity === 'error' ? '需处理：' : '提醒：') + item.message));
        if (item.path && /\.(dita|xml|ditamap)$/i.test(item.path)) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = item.path;
          button.addEventListener('click', async () => { get('modelExportDialog').close(); try { await A.navigateToSource(item.path); } catch (error) { A.setStatus(error.message, true); } }); row.append(button);
        }
        list.append(row);
      }
    }
    function summary() {
      if (!configuration) return;
      compiled = null; view().invalidate();
      try {
        const data = service().prepare(configuration.snapshot, get('exportModel').value);
        get('modelExportSummary').textContent = `包含 ${data.report.included} 条注脚；排除 ${data.report.excluded} 条；保留 ${data.report.unmarked} 条待确认注脚。` + (data.report.unused ? ` ${data.report.unused} 条未引用定义不输出。` : '') + (configuration.snapshot.filter ? ` DITAVAL 排除 ${data.report.filteredElements} 处内容。` : '') + (get('exportModel').value && data.report.unmarked ? ' 型号仅筛选已标注的适用范围；注脚中的文字差异不会自动识别，待确认内容继续保留。' : '');
        const warnings = data.notes.filter(note => note.unmarked).map(note => ({ path: note.origin.path, severity: 'warning', message: '注脚尚未确认适用范围，将保留在交付中' }));
        if (data.report.ruleApplied) get('modelExportSummary').textContent += ` 已应用 ${data.report.ruleApplied} 条独立规则，筛除 ${data.report.ruleFilteredParts} 个片段（原始 DITA 不变）。`;
        if (configuration.snapshot.noteRules?.supported === false) warnings.unshift({path:'',severity:'warning',message:'当前服务不支持独立注脚规则，未应用片段筛选。'});
        if (configuration.source.warning) warnings.unshift({ path: '', severity: 'warning', message: configuration.source.warning });
        for (const [path, file] of configuration.snapshot.files) if (/oxy_(insert|delete|comment)/.test(file.current)) warnings.push({ path, severity: 'warning', message: '含 Oxygen 修订或批注，请检查是否适合交付' });
        showIssues(warnings); get('modelExportError').textContent = '';
      } catch (error) { view().invalidate(); get('modelExportSummary').textContent = ''; get('modelExportError').textContent = error.message; showIssues(issue(error, configuration.snapshot)); }
    }
    async function provenance() {
      try {
        const response = await A.api.request('/api/provenance');
        if (!response.ok) throw new Error('来源服务不可用');
        return await response.json();
      } catch (error) {
        console.warn('交付来源信息读取失败：', error.name);
        return { commit: null, branch: null, dirty: null, warning: '来源信息读取失败，本次交付无法核对 Git 版本' };
      }
    }
    function useSnapshot(snapshot, source, selectedModel) {
      const models = [...new Set(([...(snapshot.project.models || []), ...service().listModels(snapshot)]).filter(root.DitaModelDiscovery.isModel))].sort();
      get('exportModel').replaceChildren(new Option('全部型号', ''));
      models.forEach(model => get('exportModel').add(new Option(model, model)));
      if (models.includes(selectedModel)) get('exportModel').value = selectedModel;
      configuration = { snapshot, source }; formatHint();
      get('exportModel').disabled = false; get('exportFilter').disabled = false;
      get('modelExportForm').querySelectorAll('button[type=submit]').forEach(button => { button.disabled = false; });
      get('modelExportScope').textContent = snapshot.map.title + ' · ' + snapshot.path;
      get('deliverySource').textContent = `${snapshot.files.size} 个正文／依赖文件 · ${service().saveCandidates(snapshot).length} 个未保存` + (source.commit ? ` · Git ${source.commit.slice(0, 8)}${source.dirty ? '（含未提交修改）' : ''}` : ' · 未取得 Git 版本');
      summary();
    }
    async function openModelExport() {
      if (configuring || exporting) return;
      configuring = true; configuration = null; compiled = null; view().invalidate();
      get('exportModel').replaceChildren(new Option('正在读取…', ''));
      get('exportModel').disabled = true;
      get('exportFilter').replaceChildren(new Option('正在读取…', '')); get('exportFilter').disabled = true;
      get('modelExportForm').querySelectorAll('button[type=submit]').forEach(button => { button.disabled = true; });
      get('modelExportError').textContent = ''; get('modelExportSummary').textContent = '正在读取手册及依赖…';
      get('modelExportScope').textContent = ''; get('deliveryChecks').replaceChildren(); get('modelExportDialog').showModal();
      const generation = operation;
      try {
        const scope = service().scopePath(), workspace = A.api.token;
        configuringScope = scope; configuringWorkspace = workspace;
        const filters = await service().listFilters();
        if (generation !== operation || workspace !== A.api.token || !get('modelExportDialog').open) return;
        get('exportFilter').replaceChildren(new Option('不使用 DITAVAL', ''));
        filters.files.forEach(path => get('exportFilter').add(new Option(path, path)));
        const selectedFilter = selectedFilters.get(workspace + '\n' + scope) || '';
        get('exportFilter').value = filters.files.includes(selectedFilter) ? selectedFilter : '';
        get('exportFilter').disabled = false;
        get('exportFilterHint').textContent = filters.truncated ? '文件列表过长，仅显示部分 DITAVAL。请缩小文档库范围后重试。' : filters.files.length ? '按所选 DITAVAL 过滤正文、图片和注脚；源文档保持不变。' : '文档库中未找到 DITAVAL；当前保留全部正文。';
        const snapshot = await service().capture(scope, { filterPath: get('exportFilter').value }), source = await provenance();
        if (generation !== operation || !get('modelExportDialog').open) return;
        if (!service().current(snapshot)) throw new Error('内容已变化，请重新打开交付设置');
        useSnapshot(snapshot, source, get('footnoteModel')?.value || '');
      } catch (error) { if (generation === operation) { view().invalidate(); get('modelExportSummary').textContent = ''; get('modelExportError').textContent = error.message; showIssues(issue(error)); } }
      finally { if (generation === operation) configuring = false; }
    }
    async function changeFilter() {
      if (!get('modelExportDialog').open || exporting) return;
      const scope = configuringScope, workspace = A.api.token;
      if (workspace !== configuringWorkspace) { configuration = null; get('modelExportError').textContent = '工作区已切换，请重新打开交付设置'; get('modelExportForm').querySelectorAll('button[type=submit]').forEach(button => { button.disabled = true; }); return; }
      const filterPath = get('exportFilter').value, generation = ++filterGeneration, operationId = ++operation;
      const selectedModel = get('exportModel').value;
      configuration = null; compiled = null; configuring = true; view().invalidate();
      get('modelExportSummary').textContent = '正在应用条件过滤…'; get('modelExportError').textContent = '';
      get('modelExportForm').querySelectorAll('button[type=submit]').forEach(button => { button.disabled = true; });
      try {
        const snapshot = await service().capture(scope, { filterPath }), source = await provenance();
        if (generation !== filterGeneration || operationId !== operation || workspace !== A.api.token || !get('modelExportDialog').open) return;
        if (!service().current(snapshot)) throw new Error('内容已变化，请重新打开交付设置');
        useSnapshot(snapshot, source, selectedModel); selectedFilters.set(workspace + '\n' + scope, filterPath);
      } catch (error) {
        if (generation !== filterGeneration || operationId !== operation) return;
        view().invalidate(); get('modelExportSummary').textContent = ''; get('modelExportError').textContent = error.message;
      } finally {
        if (generation === filterGeneration && operationId === operation) {
          configuring = false;
          get('modelExportForm').querySelectorAll('button[type=submit]').forEach(button => { button.disabled = !configuration; });
        }
      }
    }
    async function convert(snapshot, model, format, version) {
      const publicationData = service().prepare(snapshot, model);
      let output = await (format === 'md' ? A.ditaCore.exportMapToMarkdown : A.ditaCore.exportMapToHtml)({ map: snapshot.map, files: snapshot.files, model, version, title: snapshot.map.title, publicationData,
        loadImageBytes: path => (loadImageBytes || browserLoadImageBytes)(path, abortController?.signal) });
      let previewHtml;
      if (format === 'pdf' || format === 'docx') {
        previewHtml = root.DitaOfficeExport.printable(output);
        if (abortController?.signal.aborted) throw new Error('已取消');
        if (format === 'docx') output = await root.DitaOfficeExport.word(output, abortController?.signal);
        else if (nativePdf()) {
          const response = await A.api.request('/api/export/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: previewHtml }), signal: abortController?.signal });
          if (!response.ok) throw new Error(await A.api.error(response));
          output = await response.blob();
        } else output = previewHtml;
      }
      return { output, previewHtml, report: publicationData.report };
    }
    function filename(snapshot, model, format, version = '') {
      const safe = value => value.replace(/[^\p{L}\p{N}_-]/gu, '-');
      return snapshot.path.split('/').pop().replace(/\.(ditamap|dita|xml)$/i, '') + (model ? '-' + safe(model) : '') + (version ? '-' + safe(version) : '') + '.' + format;
    }
    async function record(snapshot, source, data, model, format, version, name) {
      const documents = new Map([[snapshot.path, snapshot.content], ...Array.from(snapshot.files, ([path, file]) => [path, file.current])]);
      if (snapshot.filter) documents.set(snapshot.filter.path, snapshot.filter.current);
      if (typeof snapshot.noteRules?.expectedContent === 'string') documents.set('.dita-note-rules.json', snapshot.noteRules.expectedContent);
      const record = { schema: 1, createdAt: new Date().toISOString(), state: 'download-initiated', manualPath: snapshot.path, model, format, version, filename: name,
        source, capturedAt: snapshot.capturedAt, filterPath: snapshot.filter?.path || '', unsavedPaths: service().saveCandidates(snapshot).map(file => file.path), report: data.report,
        documents: await Promise.all(Array.from(documents, async ([path, content]) => ({ path, sha256: await root.DitaBrowserFiles.sha256(content) }))),
        projectSha256: await root.DitaBrowserFiles.sha256(JSON.stringify(snapshot.project)), noteRulesSha256: snapshot.noteRules ? await root.DitaBrowserFiles.sha256(JSON.stringify(snapshot.noteRules.config)) : null, outputSha256: await root.DitaBrowserFiles.sha256(data.output) };
      root.DitaReleaseStore.createReleaseStore(root.localStorage).append(snapshot.root, record); lastDeliveryRecord = record;
    }
    async function publish(preview, legacy) {
      if (exporting || !configuration) return;
      const { snapshot, source } = configuration;
      if (!service().current(snapshot)) {
        compiled = null;
        if (!legacy) { view().failed(); get('modelExportError').textContent = '内容已变化，请重新打开交付设置以更新快照'; }
        return;
      }
      const model = legacy ? '' : get('exportModel').value, format = legacy?.format || get('exportFormat').value, version = legacy ? '' : get('exportVersion').value.trim();
      if (version.length > 80) { get('modelExportError').textContent = '文档版本请限制在 80 字以内'; return; }
      const generation = ++operation;
      abortController = new AbortController();
      exporting = true; A.showLoading?.();
      if (!legacy) get('modelExportError').textContent = '';
      if (!legacy) { view().pending(); for (const id of ['exportModel', 'exportFilter', 'exportFormat', 'exportVersion']) get(id).disabled = true; get('modelExportForm').querySelectorAll('button[type=submit]').forEach(button => { button.disabled = true; }); }
      try {
        await service().verifyRules?.(snapshot);
        if (generation !== operation) return;
        const key = JSON.stringify([model, format, version]);
        const data = compiled?.key === key ? compiled.data : await convert(snapshot, model, format, version);
        await service().verifyRules?.(snapshot);
        if (generation !== operation) return;
        if (!service().current(snapshot)) throw new Error('内容已变化，请重新打开交付设置以更新快照');
        compiled = { key, data }; lastExportReport = data.report;
        if (preview === 'check') { view().complete(); get('deliveryCheckStatus').textContent = '发布检查通过，图片和链接已核对。预览与下载将使用这份快照。'; return; }
        const printing = format === 'pdf' && !nativePdf();
        if (preview || printing) {
          A.dom.editorPane.classList.remove('active'); A.dom.visualPane.classList.remove('active');
          A.dom.htmlPreviewPane.classList.toggle('active', format !== 'md'); A.dom.mdPreviewPane.classList.toggle('active', format === 'md');
          if (format !== 'md') {
            releaseExportPreview();
            const pdf = format === 'pdf' && nativePdf();
            const title = format === 'docx' ? 'Word 内容预览（最终分页以 Word 为准）' : format === 'pdf' ? pdf ? 'PDF 预览' : 'PDF 打印内容预览' : 'HTML 预览';
            if (get('deliveryPreviewTitle')) get('deliveryPreviewTitle').textContent = title;
            const printButton = get('printDeliveryButton');
            if (printButton) { printButton.hidden = !printing; printButton.disabled = true; }
            A.dom.htmlPreviewFrame.title = title;
            // Chromium's PDF viewer is blocked inside a sandboxed frame. Only
            // our generated PDF bytes use the viewer; HTML stays sandboxed.
            if (pdf) A.dom.htmlPreviewFrame.removeAttribute?.('sandbox');
            else A.dom.htmlPreviewFrame.setAttribute?.('sandbox', printing ? 'allow-same-origin allow-modals' : 'allow-same-origin');
            previewUrl = URL.createObjectURL(pdf ? data.output : new Blob([data.previewHtml || data.output], { type: 'text/html;charset=utf-8' }));
            const expectedUrl = previewUrl;
            A.dom.htmlPreviewFrame.onload = printing ? async () => {
              const doc = A.dom.htmlPreviewFrame.contentDocument;
              try { await doc.fonts.ready; await Promise.all(Array.from(doc.images, image => image.decode())); if (expectedUrl === previewUrl && printButton) printButton.disabled = false; }
              catch { A.setStatus('打印图片加载失败，请重新打开交付设置', true); }
            } : null;
            A.dom.htmlPreviewFrame.src = previewUrl;
          }
          else A.dom.mdPreviewContent.innerHTML = A.ditaCore.highlightMarkdown(data.output);
          A.setStatus(printing ? '打印内容已准备，请点击预览上方“打印 / 另存 PDF”。' : '交付预览已更新 · 包含当前未保存修改' + (model ? ' · ' + model : ''));
        } else {
          const name = filename(snapshot, model, format, version);
          const mime = { html: 'text/html;charset=utf-8', md: 'text/markdown;charset=utf-8', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
          (A.downloadText || root.DitaBrowserFiles.downloadText)(data.output, name, mime[format]);
          let recorded = true;
          if (!legacy) try { await record(snapshot, source, data, model, format, version, name); } catch { recorded = false; }
          A.setStatus('已发起下载，请查看浏览器下载记录 · ' + name + (recorded ? '' : ' · 本地交付记录未能保存'));
          A.toast?.('请在浏览器下载记录中查看文件', 'info');
        }
        if (!legacy) get('modelExportDialog').close();
      } catch (error) {
        if (generation !== operation) return;
        if (!legacy) { view().failed(); get('modelExportError').textContent = error.message; showIssues(issue(error, snapshot)); }
        A.setStatus(error.message, true); A.toast?.(error.message, 'error');
      } finally { exporting = false; abortController = null; A.hideLoading?.(); if (!legacy && configuration) { view().settled(); for (const id of ['exportModel', 'exportFilter', 'exportFormat', 'exportVersion']) get(id).disabled = false; get('modelExportForm').querySelectorAll('button[type=submit]').forEach(button => { button.disabled = false; }); } }
    }
    async function legacyExport(format, preview) {
      if (!/\.ditamap$/i.test(A.state.activePath)) { A.setStatus('请先打开一个 Map 文档，再预览或导出', true); return; }
      try { configuration = { snapshot: await service().capture(A.state.activePath), source: {} }; compiled = null; await publish(preview, { format }); }
      catch (error) { A.setStatus(error.message, true); A.hideLoading?.(); }
    }

    get('exportModel')?.addEventListener('change', summary); get('exportFormat')?.addEventListener('change', () => { compiled = null; formatHint(); view().invalidate(); });
    get('exportFilter')?.addEventListener('change', changeFilter);
    get('exportVersion')?.addEventListener('input', () => { compiled = null; view().invalidate(); });
    get('printDeliveryButton')?.addEventListener('click', () => {
      A.dom.htmlPreviewFrame.contentWindow.focus(); A.dom.htmlPreviewFrame.contentWindow.print();
      A.setStatus('已请求浏览器打印，请在打印窗口选择“另存为 PDF”。');
    });
    function cancelDelivery() { operation++; filterGeneration++; configuring = false; abortController?.abort(); }
    get('modelExportCancel')?.addEventListener('click', () => { cancelDelivery(); get('modelExportDialog').close(); });
    get('modelExportDialog')?.addEventListener('cancel', cancelDelivery);
    get('modelExportDialog')?.addEventListener('close', cancelDelivery);
    get('modelExportForm')?.addEventListener('submit', event => { event.preventDefault(); publish(event.submitter?.value === 'preview' ? true : event.submitter?.value === 'check' ? 'check' : false); });
    function history() {
      const list = get('releaseList'); list.replaceChildren();
      let records = [];
      try { records = root.DitaReleaseStore.createReleaseStore(root.localStorage).list(A.state.root); }
      catch (error) { list.textContent = '交付记录读取失败；原始浏览器数据仍保留，请勿清空。'; A.setStatus('交付记录读取失败', true); get('releaseDialog').showModal(); return; }
      if (!records.length) list.textContent = '当前浏览器没有此仓库的交付记录。预览不计入记录。';
      for (const item of records) {
        const row = document.createElement('article'), title = document.createElement('strong'), detail = document.createElement('p'), button = document.createElement('button');
        const source = item.source || {}, name = typeof item.filename === 'string' ? item.filename : item.manualPath;
        const complete = typeof item.filename === 'string' && Array.isArray(item.unsavedPaths) && item.source && typeof item.source === 'object';
        title.textContent = name;
        detail.textContent = complete ? `${item.createdAt} · ${source.branch || '未知分支'} · ${typeof source.commit === 'string' ? source.commit.slice(0, 8) : '无 Git 版本'} · ${item.unsavedPaths.length} 个未保存文件 · 下载已发起` : '记录字段不完整；原始数据仍保留，可下载 JSON 检查。';
        button.type = 'button'; button.textContent = '下载记录 JSON'; button.addEventListener('click', () => A.downloadText(JSON.stringify(item, null, 2), name + '.record.json', 'application/json;charset=utf-8'));
        row.append(title, detail, button); list.append(row);
      }
      get('releaseDialog').showModal();
    }
    get('releasesButton')?.addEventListener('click', history); get('releaseClose')?.addEventListener('click', () => get('releaseDialog').close());
    return { openModelExport, releaseExportPreview,
      previewMapHtml: () => legacyExport('html', true), exportMapToHtmlFile: () => legacyExport('html', false),
      previewMapMd: () => legacyExport('md', true), exportMapToMarkdownFile: () => legacyExport('md', false),
      get lastDeliveryRecord() { return lastDeliveryRecord; }, get lastExportReport() { return lastExportReport; } };
  }
  root.DitaExport = { createExportController };
})(window);

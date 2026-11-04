'use strict';
(function (root) {
  function createController(A, { path, available, prepare, leave }) {
    const core = root.DitaAiScanCore, get = id => document.getElementById(id);
    const dialog = get('aiScanDialog'), scope = get('aiScanScope'), start = get('aiScanStart');
    const status = get('aiScanStatus'), results = get('aiScanResults');
    let controller = null, report = null, targets = null;
    const current = () => report && A.manual.current(report.snapshot);
    function controls() {
      const busy = Boolean(controller);
      scope.disabled = busy; start.disabled = busy || !available() || !targets?.[scope.value];
      get('aiScanCancel').hidden = !busy;
      dialog.setAttribute('aria-busy', String(busy));
    }
    function render() {
      results.replaceChildren();
      if (!report) return;
      const stale = !current(), findings = [...report.findings.values()].sort((a, b) => Number(a.category === 'wording') - Number(b.category === 'wording'));
      const heading = document.createElement('h3');
      heading.textContent = report.snapshot.path + ' · ' + (findings.length > 30 ? '显示前 30 条，共 ' : '') + findings.length + ' 条建议';
      results.append(heading);
      if (stale) {
        const warning = document.createElement('p'); warning.className = 'ai-technical-review';
        warning.textContent = '手册内容已变化。重新扫描后可继续定位和修订。'; results.append(warning);
      }
      const warnings = [...report.warnings, ...report.errors];
      if (warnings.length) {
        const details = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ul');
        summary.textContent = warnings.length + ' 项覆盖说明';
        for (const warning of warnings) {
          const item = document.createElement('li'); item.textContent = warning; list.append(item);
        }
        details.append(summary, list); results.append(details);
      }
      for (const finding of findings.slice(0, 30)) {
        const card = document.createElement('article'); card.className = 'ai-scan-card';
        const category = document.createElement('span'), title = document.createElement('h4'), suggestion = document.createElement('p');
        category.className = 'ai-eyebrow'; category.textContent = core.categories[finding.category];
        title.textContent = finding.summary; suggestion.textContent = finding.suggestion;
        card.append(category, title, suggestion);
        for (const ref of finding.evidence) {
          const record = report.records.get(ref.id), source = report.snapshot.files.get(record.input.path).current;
          const row = document.createElement('div'), location = document.createElement('strong'), quote = document.createElement('pre'), actions = document.createElement('div');
          row.className = 'ai-scan-evidence'; actions.className = 'ai-scan-actions';
          location.textContent = record.input.path + ' · 第 ' + core.line(source, record.start) + ' 行' +
            (record.input.conditions.length ? ' · ' + record.input.conditions.join('；') : '') + (record.input.kind === 'fn' ? ' · 注脚' : '');
          quote.textContent = ref.quote;
          const locate = document.createElement('button'); locate.type = 'button'; locate.textContent = '定位原文';
          locate.disabled = stale;
          locate.addEventListener('click', async () => {
            if (!current()) { render(); return; }
            close(); leave();
            try { await A.bodyNavigation.node(record.input.path, record.xmlPath, source); }
            catch {
              try { await A.navigateToSource(record.input.path, record.start, record.end, source.slice(record.start, record.end)); }
              catch (error) { A.setStatus(error.message, true); }
            }
          });
          actions.append(locate);
          let editable = true;
          try { root.DitaAiEditCore.target(source, record.start, record.end); } catch { editable = false; }
          if (editable) {
            const edit = document.createElement('button'); edit.type = 'button';
            edit.textContent = finding.category === 'wording' ? '为此处生成提案' : '核对后修改此处';
            edit.disabled = stale;
            edit.addEventListener('click', () => {
              if (!current()) { render(); return; }
              try { prepare({ path: record.input.path, source, start: record.start, end: record.end }, finding, report.snapshot); close(); }
              catch (error) { status.textContent = error.message; }
            });
            actions.append(edit);
          }
          row.append(location, quote, actions); card.append(row);
        }
        results.append(card);
      }
    }
    function stop() { controller?.abort(); controller = null; controls(); }
    function close() {
      if (controller) { stop(); status.textContent = '扫描已取消，保留已完成批次的结果。'; render(); }
      dialog.close();
    }
    function open() {
      const topic = path(), map = A.manual.scopePath();
      targets = { topic: topic && !/\.ditamap$/i.test(topic) ? topic : '', manual: /\.ditamap$/i.test(map) ? map : '' };
      scope.options[0].disabled = !targets.topic; scope.options[1].disabled = !targets.manual;
      scope.value = targets.manual && (!targets.topic || report?.snapshot.path === targets.manual) ? 'manual' : 'topic';
      if (!report) status.textContent = available() ? '' : '请先在 AI 写作中配置模型连接。';
      controls(); render(); dialog.showModal();
    }
    async function scan() {
      const target = targets?.[scope.value];
      if (controller || !target || !available()) return;
      const request = new AbortController(); controller = request; controls();
      const active = () => controller === request && dialog.open;
      status.textContent = '正在读取手册快照…'; results.replaceChildren(); report = null;
      try {
        const snapshot = await A.manual.capture(target);
        if (!active()) return;
        const { records, warnings } = core.collect(snapshot.files.values(), snapshot.map);
        const { batches, skipped } = core.plan(records, scope.value === 'manual');
        const recordIndex = new Map(records.map(item => [item.input.id, item]));
        report = { snapshot, records: recordIndex, warnings, errors: [], findings: new Map() };
        if (skipped) warnings.push('达到单次扫描上限，另有 ' + skipped + ' 个批次未扫描，可分章节继续。');
        if (!batches.length) { status.textContent = '当前范围没有可扫描的正文。'; return; }
        const covered = new Set(); let completed = 0, omitted = 0, consecutiveFailures = 0;
        for (const [index, batch] of batches.entries()) {
          if (!active()) return;
          if (!current()) throw Error('手册内容已变化，请重新扫描。');
          status.textContent = '正在扫描 ' + (index + 1) + ' / ' + batches.length + ' 批 · ' +
            (batch.phase === 'cross' ? '跨章节核对 ' + batch.command : '章节正文');
          try {
            const response = await A.api.request('/api/ai/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: request.signal, body: JSON.stringify(batch) });
            if (!response.ok) throw Error(await A.api.error(response));
            const result = await response.json();
            if (!active()) return;
            if (!current()) throw Error('手册内容已变化，请重新扫描。');
            omitted += result.omitted; completed++; consecutiveFailures = 0;
            if (batch.phase === 'section') for (const item of batch.evidence) covered.add(item.id);
            for (const finding of result.findings) {
              const key = finding.category + ':' + finding.evidence.map(ref => ref.id).sort().join(',');
              if (!report.findings.has(key)) report.findings.set(key, finding);
            }
          } catch (error) {
            if (!active()) return;
            if (!current()) throw error;
            report.errors.push('第 ' + (index + 1) + ' 批 · ' + error.message);
            if (++consecutiveFailures >= 2) break;
          }
        }
        if (omitted) warnings.push(omitted + ' 条模型建议的证据未通过校验。');
        const coverage = '已完成 ' + completed + '/' + (batches.length + skipped) + ' 批，覆盖 ' + covered.size + '/' + records.length + ' 个正文片段。';
        status.textContent = coverage + (report.findings.size ? ' 请逐条核对。' : completed ? ' 已完成的批次没有可展示的建议。' : ' 请检查模型连接或缩小扫描范围。');
      } catch (error) { if (active()) status.textContent = error.message; }
      finally { if (active()) { controller = null; controls(); render(); } }
    }
    start.addEventListener('click', scan);
    scope.addEventListener('change', controls);
    get('aiScanClose').addEventListener('click', close);
    get('aiScanCancel').addEventListener('click', () => { stop(); status.textContent = '扫描已取消，保留已完成批次的结果。'; render(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    A.events.on('workspace:willChange', () => { close(); report = null; status.textContent = ''; results.replaceChildren(); });
    return { open };
  }
  root.DitaAiScan = { createController };
})(window);

'use strict';
(function (root) {
  function createController(A, { path, available, configuration, prepare, activity }) {
    const core = root.DitaAiScanCore, get = id => document.getElementById(id);
    const panel = get('aiScanPanel'), scope = get('aiScanScope'), start = get('aiScanStart');
    const status = get('aiScanStatus'), results = get('aiScanResults');
    let controller = null, report = null, targets = null, shown = 30, refreshTimer, loading = false, opening = 0;
    const progress = root.DitaAiScanStore;
    let storage;
    try { storage = root.localStorage; } catch (error) { console.warn('无法读取扫描进度存储', error); }
    const scanStore = progress.createScanStore(storage);
    const profile = () => JSON.stringify(configuration());
    const sourceFor = (run, path) => A.state.filesMap.get(path)?.current ?? run.disk.get(path) ?? run.snapshot.files.get(path)?.current ?? run.snapshot.content;
    const contextCurrent = run => A.manual.contextCurrent(run.snapshot) &&
      (!/\.ditamap$/i.test(run.snapshot.path) || sourceFor(run, run.snapshot.path) === run.snapshot.content);
    function resolve(run, ref) {
      const record = run.records.get(ref.id), path = record.input.path;
      const file = run.snapshot.files.get(path), source = sourceFor(run, path);
      if (source === file.current) return { ...record, source };
      let indexed = run.live.get(path);
      if (indexed?.source !== source) {
        indexed = { source, records: core.rebase(file, source, run.byPath.get(path), run.snapshot.map) };
        run.live.set(path, indexed);
      }
      const match = indexed.records.get(ref.id);
      return match ? { ...match, source } : null;
    }
    function findingState(run, key, finding) {
      const receipt = run.applied.get(key);
      if (receipt && !resolve(run, receipt)) return 'applied';
      return contextCurrent(run) && finding.evidence.every(ref => resolve(run, ref)) ? 'pending' : 'stale';
    }
    function controls() {
      const busy = Boolean(controller) || loading;
      scope.disabled = busy; start.disabled = busy || !available() || !targets?.[scope.value];
      start.textContent = report ? '重新扫描' : '开始扫描';
      const sameScope = report && report.snapshot.path === targets?.[scope.value];
      get('aiScanResume').hidden = !sameScope || report.outcomes.size === report.batches.length;
      get('aiScanRetry').hidden = !sameScope || ![...report.outcomes.values()].some(item => item.status === 'failed');
      get('aiScanResume').disabled = busy || !available(); get('aiScanRetry').disabled = busy || !available();
      get('aiScanCancel').hidden = !controller;
      results.setAttribute('aria-busy', String(busy));
    }
    function render() {
      clearTimeout(refreshTimer);
      const scroll = results.scrollTop;
      results.replaceChildren();
      if (!report) return;
      const run = report;
      const editableBlocks = new Map();
      const findings = [...run.findings.entries()].sort(([, a], [, b]) => Number(a.category === 'wording') - Number(b.category === 'wording'))
        .map(([key, finding]) => ({ key, finding, state: findingState(run, key, finding) }));
      const count = state => findings.filter(entry => entry.state === state).length;
      const heading = document.createElement('h3');
      heading.textContent = run.snapshot.path + ' · ' + findings.length + ' 条建议';
      results.append(heading);
      if (findings.length) {
        const summary = document.createElement('p'); summary.className = 'ai-muted ai-scan-summary';
        summary.textContent = count('pending') + ' 条待核对 · ' + count('applied') + ' 条已处理 · ' + count('stale') + ' 条需重扫';
        results.append(summary);
      }
      const warnings = [...report.warnings, ...report.errors];
      const omitted = [...run.outcomes.values()].reduce((total, item) => total + (item.result?.omitted || 0), 0);
      if (omitted) warnings.push(omitted + ' 条模型建议的证据未通过校验。');
      if (warnings.length) {
        const details = document.createElement('details'), summary = document.createElement('summary'), list = document.createElement('ul');
        details.open = report.errors.length > 0 || report.discarded > 0;
        summary.textContent = warnings.length + ' 项覆盖说明';
        for (const warning of warnings) {
          const item = document.createElement('li'); item.textContent = warning; list.append(item);
        }
        details.append(summary, list); results.append(details);
      }
      for (const { key, finding, state } of findings.slice(0, shown)) {
        const card = document.createElement('article'); card.className = 'ai-scan-card'; card.dataset.finding = key;
        const category = document.createElement('span'), title = document.createElement('h4'), suggestion = document.createElement('p');
        category.className = 'ai-eyebrow'; category.textContent = core.categories[finding.category];
        title.textContent = finding.summary; suggestion.textContent = finding.suggestion;
        card.append(category, title, suggestion);
        if (state !== 'pending') {
          const badge = document.createElement('span'); badge.className = 'ai-scan-badge';
          badge.classList.toggle('is-applied', state === 'applied');
          badge.textContent = state === 'applied' ? '已处理' : '证据已变化 · 需重扫';
          title.append(badge);
        }
        const check = () => {
          if (report !== run || findingState(run, key, finding) !== 'pending') throw Error('这条建议的证据已变化，请重新扫描。');
        };
        for (const ref of finding.evidence) {
          const original = run.records.get(ref.id), path = original.input.path;
          const live = resolve(run, ref), record = live || original;
          const source = live?.source ?? run.snapshot.files.get(path).current;
          const row = document.createElement('div'), location = document.createElement('strong'), quote = document.createElement('pre'), actions = document.createElement('div');
          row.className = 'ai-scan-evidence'; actions.className = 'ai-scan-actions';
          location.textContent = record.input.path + ' · 第 ' + core.line(source, record.start) + ' 行' +
            (record.input.conditions.length ? ' · ' + record.input.conditions.join('；') : '') + (record.input.kind === 'fn' ? ' · 注脚' : '');
          quote.textContent = ref.quote;
          const locate = document.createElement('button'); locate.type = 'button'; locate.textContent = '定位原文';
          locate.disabled = state !== 'pending';
          locate.addEventListener('click', async () => {
            try {
              check();
              const item = resolve(run, ref);
              try { await A.bodyNavigation.node(path, item.xmlPath, item.source); }
              catch {
                check();
                const latest = resolve(run, ref);
                await A.navigateToSource(path, latest.start, latest.end, latest.source.slice(latest.start, latest.end));
              }
            } catch (error) {
              status.textContent = error.message; render();
            }
          });
          actions.append(locate);
          let editable = false;
          if (state === 'pending') {
            const editing = root.DitaAiEditCore;
            try {
              if (!editableBlocks.has(path)) editableBlocks.set(path, editing.inspect(source));
              editing.target(source, record.start, record.end, editableBlocks.get(path));
              editable = true;
            } catch { /* Some evidence is only available for review. */ }
          }
          if (editable) {
            const edit = document.createElement('button'); edit.type = 'button';
            edit.textContent = finding.category === 'wording' ? '为此处生成提案' : '核对后修改此处';
            edit.disabled = state !== 'pending';
            edit.addEventListener('click', async () => {
              try {
                check();
                if (!A.state.filesMap.has(path)) await A.openFile(path, { preserveFootnotesScope: true });
                check();
                const item = resolve(run, ref);
                prepare({ path, source: item.source, start: item.start, end: item.end }, finding, {
                  check,
                  applied() {
                    run.applied.set(key, ref);
                    render();
                    const cards = [...results.querySelectorAll('.ai-scan-card')], index = cards.findIndex(item => item.dataset.finding === key);
                    const next = [...cards.slice(index + 1), ...cards.slice(0, index)].find(item => item.querySelector('button:not(:disabled)'));
                    next?.querySelector('button:not(:disabled)').focus();
                  }
                });
              } catch (error) { status.textContent = error.message; }
            });
            actions.append(edit);
          }
          row.append(location, quote, actions); card.append(row);
        }
        results.append(card);
      }
      if (findings.length > shown) {
        const more = document.createElement('button'); more.type = 'button'; more.textContent = '显示更多建议';
        more.addEventListener('click', () => { shown += 30; render(); });
        results.append(more);
      }
      results.scrollTop = scroll;
    }
    function updateReport(run) {
      run.errors = []; run.findings = new Map();
      for (const [index, outcome] of run.outcomes) {
        if (outcome.status === 'failed') run.errors.push('第 ' + (index + 1) + ' 批' +
          (outcome.result ? '部分完成 · ' : ' · ') + (outcome.error || outcome.result.failures.join('。')));
        for (const finding of outcome.result?.findings || []) run.findings.set(progress.findingKey(finding), finding);
      }
    }
    function summary(run) {
      const covered = new Set(); let completed = 0, failed = 0;
      for (const [index, outcome] of run.outcomes) {
        if (outcome.status === 'done') completed++; else failed++;
        if (run.batches[index].phase === 'section') for (const id of outcome.result?.covered || []) covered.add(id);
      }
      return '已完成 ' + completed + '/' + run.batches.length + ' 批，覆盖 ' + covered.size + '/' + run.records.size +
        ' 个正文片段。' + (failed ? ' ' + failed + ' 批可重试。' : '') +
        (run.outcomes.size < run.batches.length ? ' 还有 ' + (run.batches.length - run.outcomes.size) + ' 批可继续。' : '');
    }
    function checkpoint(run) {
      scanStore.save(run);
      get('aiScanStorageWarning').textContent = scanStore.warning;
      get('aiScanStorageWarning').hidden = !scanStore.warning;
    }
    function stop() {
      opening++; controller?.abort(); controller = null; loading = false;
      if (report) checkpoint(report);
      controls(); activity();
    }
    function updateTargets(topic, previous) {
      const map = A.manual.scopePath();
      targets = { topic: topic && !/\.ditamap$/i.test(topic) ? topic : '', manual: /\.ditamap$/i.test(map) ? map : '' };
      for (const option of scope.options) {
        const path = targets[option.value];
        option.disabled = !path;
        const label = option.value === 'topic' ? '当前章节' : '当前功能手册';
        option.textContent = path ? label + ' · ' + path.split('/').at(-1) : label;
      }
      scope.value = targets[previous] ? previous : targets.manual && (!targets.topic || report?.snapshot.path === targets.manual) ? 'manual' : 'topic';
    }
    async function open() {
      if (!controller && !loading) updateTargets(path());
      if (!report && !controller) status.textContent = available() ? '开始后，所选范围的正文将分批发送给已配置的模型。' : '请先在 AI 写作中配置模型连接。';
      A.shell.openPanel('ai-scan');
      if (!controller && !loading && available() && (!report || report.snapshot.path !== targets?.[scope.value] || report.profile !== profile())) {
        await prepareReport(false);
      }
      controls(); render(); (controller ? get('aiScanCancel') : scope).focus({ preventScroll: true });
    }
    async function prepareReport(reset) {
      const target = targets?.[scope.value];
      if (!target) return null;
      const ticket = ++opening, workspace = A.api.token;
      loading = true; controls(); activity(); status.textContent = '正在读取手册快照…';
      if (reset || report?.snapshot.path !== target) results.replaceChildren();
      try {
        const snapshot = await A.manual.capture(target);
        if (ticket !== opening || workspace !== A.api.token) return null;
        const { records, warnings } = core.collect(snapshot.files.values(), snapshot.map);
        const { batches } = core.plan(records, scope.value === 'manual', { all: true });
        const model = profile();
        const cached = reset ? { outcomes: new Map(), restored: false } : scanStore.load(snapshot, batches, model);
        const byPath = new Map();
        for (const record of records) {
          if (!byPath.has(record.input.path)) byPath.set(record.input.path, []);
          byPath.get(record.input.path).push(record);
        }
        if (cached.discarded) warnings.push(cached.discarded + ' 个旧批次的原文或配置已变化，已重新列为待扫描。');
        shown = 30;
        report = { snapshot, profile: model, batches, outcomes: cached.outcomes, discarded: cached.discarded || 0,
          records: new Map(records.map(item => [item.input.id, item])), byPath, warnings, errors: [], findings: new Map(),
          applied: new Map(), live: new Map(), disk: new Map(Array.from(snapshot.buffers, ([path, file]) => [path, file.disk])) };
        updateReport(report);
        status.textContent = cached.restored ? '已恢复扫描进度。' + summary(report) : '共 ' + batches.length + ' 批，点击开始扫描。';
        if (reset) checkpoint(report);
        get('aiScanStorageWarning').textContent = scanStore.warning;
        get('aiScanStorageWarning').hidden = !scanStore.warning;
        render(); return report;
      } catch (error) { if (ticket === opening) { report = null; status.textContent = error.message; } return null; }
      finally { if (ticket === opening) { loading = false; controls(); activity(); render(); } }
    }
    async function scan(mode) {
      if (controller || loading || !targets?.[scope.value] || !available()) return;
      const request = new AbortController(); controller = request; controls(); activity();
      const active = () => controller === request;
      try {
        const run = await prepareReport(mode === 'new');
        if (!run || !active()) return;
        if (!run.batches.length) { status.textContent = '当前范围没有可扫描的正文。'; return; }
        const budget = { section: 0, cross: 0 };
        const queue = run.batches.map((batch, index) => ({ batch, index })).filter(({ batch, index }) => {
          const outcome = run.outcomes.get(index);
          if (mode === 'retry' ? outcome?.status !== 'failed' : Boolean(outcome)) return false;
          return ++budget[batch.phase] <= core.limits[batch.phase === 'section' ? 'sections' : 'comparisons'];
        });
        let consecutiveFailures = 0;
        for (const { batch, index } of queue) {
          if (!active()) return;
          if (!contextCurrent(run)) throw Error('手册目录或型号配置已变化，请重新扫描。');
          status.textContent = '正在扫描 ' + (index + 1) + ' / ' + run.batches.length + ' 批 · ' +
            (batch.phase === 'cross' ? '跨章节核对 ' + batch.command : '章节正文');
          const previous = run.outcomes.get(index)?.result;
          const remaining = batch.phase === 'section' && previous ? batch.evidence.filter(ref => !previous.covered.includes(ref.id)) : batch.evidence;
          const requestBatch = remaining.length ? { ...batch, evidence: remaining } : batch;
          try {
            const response = await A.api.request('/api/ai/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: request.signal, body: JSON.stringify(requestBatch) });
            if (!response.ok) throw Error(await A.api.error(response));
            const result = await response.json();
            if (!active()) return;
            if (!contextCurrent(run)) throw Error('手册目录或型号配置已变化，请重新扫描。');
            const checked = progress.mergeResult(requestBatch, result);
            const merged = progress.mergeResult(batch, checked, previous);
            run.outcomes.set(index, { result: merged, status: merged.failures.length ? 'failed' : 'done', error: '' });
            consecutiveFailures = 0;
          } catch (error) {
            if (!active()) return;
            if (!contextCurrent(run)) throw error;
            run.outcomes.set(index, { result: previous || null, status: 'failed', error: error.message });
            consecutiveFailures++;
          }
          updateReport(run); checkpoint(run); render(); controls();
          if (consecutiveFailures >= 2) break;
        }
        status.textContent = summary(run) + (run.findings.size ? ' 请逐条核对。' : ' 已扫描范围没有可展示的建议。');
      } catch (error) { if (active()) status.textContent = error.message; }
      finally { if (active()) { controller = null; controls(); activity(); render(); } }
    }
    start.addEventListener('click', () => scan('new'));
    get('aiScanResume').addEventListener('click', () => scan('resume'));
    get('aiScanRetry').addEventListener('click', () => scan('retry'));
    scope.addEventListener('change', () => prepareReport(false));
    get('aiScanCancel').addEventListener('click', () => { stop(); status.textContent = '扫描已取消，保留已完成批次的结果。' + (report ? summary(report) : ''); render(); });
    A.events.on('document:changed', file => {
      if (!report || (!report.byPath.has(file.path) && file.path !== report.snapshot.path)) return;
      report.disk.set(file.path, file.disk);
      if (!panel.hidden && !controller) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(render, 160);
      }
    });
    A.events.on('file:opened', file => {
      if (panel.hidden || controller) return;
      updateTargets(file.path, scope.value); controls();
      if (!report || (!report.byPath.has(file.path) && file.path !== report.snapshot.path)) return;
      const previous = report.disk.get(file.path) ?? report.snapshot.files.get(file.path)?.current ?? report.snapshot.content;
      report.disk.set(file.path, file.disk);
      if (previous !== file.current) render();
    });
    for (const event of ['file:closed', 'project:changed', 'note-rules:changed']) {
      A.events.on(event, () => { if (report && !panel.hidden && !controller) render(); });
    }
    A.events.on('workspace:willChange', () => { stop(); clearTimeout(refreshTimer); report = null; status.textContent = ''; results.replaceChildren(); });
    return { open, running: () => Boolean(controller) || loading };
  }
  root.DitaAiScan = { createController };
})(window);

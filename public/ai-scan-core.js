'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const { decode } = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  const categories = Object.freeze({ wording: '术语与表述', technical: '参数或示例待核对', applicability: '型号范围待核对', missing: '步骤或条件待核对' });
  const limits = Object.freeze({ text: 1600, items: 56, batch: 14000, sections: 72, comparisons: 20 });
  const inline = new Set('b i u tt sup sub ph keyword term codeph cmdname msgph varname parmname apiname cite q xref uicontrol option userinput systemoutput filepath menucascade wintitle tm'.split(' '));
  const skip = new Set(['prolog', 'foreign', 'unknown', 'indexterm', 'draft-comment', 'required-cleanup']);
  const conditionNames = ['product', 'platform', 'audience', 'otherprops', 'props'];
  const commands = value => [...new Set((value.match(/\bAT\+[A-Z][A-Z0-9_]*/gi) || []).filter(text => text.length <= 67).map(text => text.toUpperCase()))];
  const line = (source, offset) => source.slice(0, offset).split('\n').length;
  const size = item => item.text.length + item.path.length + item.kind.length + item.conditions.join('').length + 80;
  const conditionsOf = node => conditionNames.filter(key => node.attrs[key]).map(key => key + '=' + decode(node.attrs[key]));

  function mapScopes(map) {
    const scopes = new Map();
    if (!map?.source) return scopes;
    const indexed = new Map();
    function index(node, path, inherited) {
      const conditions = [...new Set([...inherited, ...conditionsOf(node)])];
      indexed.set(path, conditions);
      node.children.filter(child => child.kind === 'element').forEach((child, i) => index(child, path ? path + '.' + i : String(i), conditions));
    }
    index(xml.inspectSource(map.source), '', []);
    function visit(entries) {
      for (const entry of entries) {
        if (entry.type === 'file' && entry.processingRole !== 'resource-only') {
          if (!scopes.has(entry.path)) scopes.set(entry.path, new Set());
          scopes.get(entry.path).add((indexed.get(entry.sourcePath) || []).join(' & '));
        }
        visit(entry.children || []);
      }
    }
    visit(map.children || []);
    return scopes;
  }

  function collect(files, map) {
    const records = [], warnings = [];
    const scopes = mapScopes(map);
    for (const file of files) {
      const source = file.current;
      let tree;
      try { tree = xml.inspectSource(source); }
      catch { warnings.push(file.path + ' · 无法解析 XML'); continue; }
      if (!['dita', 'topic', 'concept', 'reference', 'task', 'glossentry', 'glossgroup'].includes(tree.name)) {
        warnings.push(file.path + ' · 非 Topic 正文'); continue;
      }
      const title = tree.children.find(node => node.name === 'title');
      const primary = title ? commands(source.slice(title.end, title.close?.start ?? title.end)) : [];
      let pending = null, unsupported = false, oversized = false;
      const before = records.length;
      function flush() {
        if (!pending) return;
        const { start, end, xmlPath, kind, conditions, text } = pending;
        const value = text.trim();
        let rest = value;
        while (rest) {
          let stop = Math.min(rest.length, limits.text);
          if (stop < rest.length) {
            const boundary = rest.lastIndexOf('\n', stop);
            if (boundary > stop / 2) stop = boundary + 1;
            else if (/^[\uDC00-\uDFFF]$/u.test(rest[stop])) stop--;
          }
          const part = rest.slice(0, stop).trim();
          rest = rest.slice(stop);
          if (!part) continue;
          const input = { id: 'e' + records.length, path: file.path, kind, conditions, text: part };
          if (file.path.length > 512 || kind.length > 64 || conditions.length > 20 || conditions.some(value => value.length > 1024) || size(input) > limits.batch) {
            oversized = true; continue;
          }
          records.push({ input, start, end, xmlPath, commands: [...new Set([...(primary.length === 1 ? primary : []), ...commands(part)])] });
        }
        pending = null;
      }
      function visit(node, path, owner, conditions, note = '') {
        if (skip.has(node.name)) return;
        if (node.attrs.conkeyref || node.attrs.keyref) { unsupported = true; return; }
        if (node.attrs.conref || node.name === 'xref' && decode(node.attrs.type) === 'fn') return; // Dependency sources are captured once.
        const next = conditionsOf(node);
        const inherited = next.length ? [...new Set([...conditions, ...next])] : conditions;
        const block = !owner || !inline.has(node.name) || next.length ? { path, kind: note || node.name } : owner;
        const noteKind = note || (['fn', 'note'].includes(node.name) ? node.name : '');
        let index = 0;
        for (const child of node.children) {
          if (child.kind === 'element') {
            visit(child, path ? path + '/' + index : String(index), block, inherited, noteKind);
            index++;
          } else if (child.kind === 'text' || child.kind === 'cdata') {
            const start = child.start + (child.kind === 'cdata' ? 9 : 0), end = child.end - (child.kind === 'cdata' ? 3 : 0);
            const text = child.kind === 'cdata' ? source.slice(start, end) : decode(source.slice(start, end));
            if (!text.trim() && pending?.owner !== block) continue;
            if (pending?.owner !== block) {
              flush(); pending = { owner: block, start, end, xmlPath: block.path, kind: block.kind, conditions: inherited, text: '' };
            }
            pending.text += text; pending.end = end;
          } else if (child.kind === 'pi' && /^<\?oxy_/i.test(source.slice(child.start, child.end))) unsupported = true;
        }
      }
      const variants = [...(scopes.get(file.path) || [])];
      const inherited = variants.some(Boolean) ? ['Map 引用（任选其一）=' + variants.map(value => value || '无条件').join(' | ')] : [];
      visit(tree, '', null, inherited); flush();
      if (unsupported) warnings.push(file.path + ' · 含键引用或 Oxygen 修订，请结合原文核对');
      if (oversized) warnings.push(file.path + ' · 部分片段的条件或路径超出模型输入限制');
      if (before === records.length) warnings.push(file.path + ' · 无可扫描正文');
    }
    return { records, warnings };
  }

  function plan(records, compare) {
    const sections = [];
    let group = [], length = 0;
    for (const { input } of records) {
      if (group.length && (group.length === limits.items || length + size(input) > limits.batch)) {
        sections.push({ phase: 'section', evidence: group }); group = []; length = 0;
      }
      group.push(input); length += size(input);
    }
    if (group.length) sections.push({ phase: 'section', evidence: group });

    const byCommand = new Map();
    if (compare) for (const record of records) for (const command of record.commands) {
      if (!byCommand.has(command)) byCommand.set(command, new Map());
      const paths = byCommand.get(command), evidence = paths.get(record.input.path) || [];
      evidence.push(record.input); paths.set(record.input.path, evidence);
    }
    const comparisons = [];
    for (const [command, paths] of byCommand) {
      if (paths.size < 2) continue;
      const relevance = input => Number(/超时|毫秒|默认|范围|返回|失败|秒|不支持|timeout|\bms\b/i.test(input.text)) * 4 +
        Number(commands(input.text).includes(command)) * 2 + Number(input.kind === 'fn');
      const queues = [...paths.values()].map(items => items.sort((a, b) => relevance(b) - relevance(a)));
      const evidence = []; let budget = 0;
      for (let row = 0; row < limits.items && evidence.length < limits.items; row++) {
        if (!queues.some(queue => queue.length > row)) break;
        for (const queue of queues) {
          const item = queue[row];
          if (!item || evidence.length === limits.items || budget + size(item) > limits.batch) continue;
          budget += size(item); evidence.push(item);
        }
      }
      if (new Set(evidence.map(item => item.path)).size > 1) comparisons.push({ phase: 'cross', command, evidence });
    }
    return { batches: [...sections.slice(0, limits.sections), ...comparisons.slice(0, limits.comparisons)],
      skipped: Math.max(0, sections.length - limits.sections) + Math.max(0, comparisons.length - limits.comparisons) };
  }

  function validateBatch(batch) {
    const fail = () => { throw Object.assign(new Error('扫描批次格式或范围无效'), { status: 400 }); };
    if (!batch || !['section', 'cross'].includes(batch.phase) || !Array.isArray(batch.evidence) ||
      !batch.evidence.length || batch.evidence.length > limits.items ||
      (batch.phase === 'cross' && (typeof batch.command !== 'string' || !/^AT\+[A-Z][A-Z0-9_]{0,63}$/.test(batch.command)))) fail();
    const ids = new Set(); let total = 0;
    const evidence = batch.evidence.map(item => {
      if (!item || typeof item.id !== 'string' || !/^e\d{1,7}$/.test(item.id) || ids.has(item.id) ||
        typeof item.path !== 'string' || !item.path || item.path.length > 512 ||
        typeof item.kind !== 'string' || !item.kind || item.kind.length > 64 ||
        typeof item.text !== 'string' || !item.text.trim() || item.text.length > limits.text ||
        !Array.isArray(item.conditions) || item.conditions.length > 20 || item.conditions.some(value => typeof value !== 'string' || value.length > 1024)) fail();
      ids.add(item.id); total += size(item);
      return { id: item.id, path: item.path, kind: item.kind, text: item.text, conditions: item.conditions };
    });
    if (total > limits.batch || batch.phase === 'cross' && new Set(evidence.map(item => item.path)).size < 2) fail();
    return { phase: batch.phase, ...(batch.phase === 'cross' ? { command: batch.command } : {}), evidence };
  }

  function validateFindings(result, batch) {
    if (!result || !Array.isArray(result.findings) || result.findings.length > 10) {
      throw Object.assign(new Error('模型返回的扫描结果格式无效'), { status: 502 });
    }
    const source = new Map(batch.evidence.map(item => [item.id, item])), findings = [];
    for (const entry of result.findings) {
      if (!entry || typeof entry.category !== 'string' || !Object.hasOwn(categories, entry.category) ||
        typeof entry.summary !== 'string' || !entry.summary.trim() || entry.summary.length > 300 ||
        typeof entry.suggestion !== 'string' || !entry.suggestion.trim() || entry.suggestion.length > 600 ||
        !Array.isArray(entry.evidence) || entry.evidence.length < 1 || entry.evidence.length > 4) continue;
      const refs = new Set();
      const evidence = entry.evidence.filter(ref => {
        if (!ref || refs.has(ref.id) || typeof ref.quote !== 'string' || !ref.quote.trim() || ref.quote.length > 240 ||
          !source.get(ref.id)?.text.includes(ref.quote)) return false;
        refs.add(ref.id); return true;
      }).map(({ id, quote }) => ({ id, quote }));
      if (evidence.length !== entry.evidence.length || (['technical', 'applicability'].includes(entry.category) && evidence.length < 2)) continue;
      if (batch.phase === 'cross' && new Set(evidence.map(ref => source.get(ref.id).path)).size < 2) continue;
      findings.push({ category: entry.category, summary: entry.summary.trim(), suggestion: entry.suggestion.trim(), evidence });
    }
    return { findings, omitted: result.findings.length - findings.length };
  }

  // Match the exact source and model conditions again. Repeated passages need
  // an unchanged offset as well, so a duplicate cannot inherit another's action.
  function rebase(file, current, records, map) {
    const source = file.current, matches = new Map();
    const index = (text, entries) => {
      const groups = new Map();
      for (const record of entries) {
        const { kind, conditions, text: excerpt } = record.input;
        const key = JSON.stringify([kind, conditions, excerpt, text.slice(record.start, record.end)]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
      }
      return groups;
    };
    const before = index(source, records), after = index(current, collect([{ path: file.path, current }], map).records);
    let prefix = 0, suffix = 0;
    const limit = Math.min(source.length, current.length);
    while (prefix < limit && source[prefix] === current[prefix]) prefix++;
    while (suffix < limit - prefix && source[source.length - 1 - suffix] === current[current.length - 1 - suffix]) suffix++;
    const delta = current.length - source.length;
    for (const [key, previous] of before) {
      const candidates = after.get(key);
      if (!candidates || candidates.length !== previous.length) continue;
      for (const record of previous) {
        const shift = record.end <= prefix ? 0 : record.start >= source.length - suffix ? delta : null;
        const translated = shift === null ? null : candidates.find(item => item.start === record.start + shift && item.end === record.end + shift);
        const match = translated || (candidates.length === 1 && candidates[0].xmlPath === record.xmlPath ? candidates[0] : null);
        if (match) matches.set(record.input.id, match);
      }
    }
    return matches;
  }

  const api = { categories, collect, plan, line, validateBatch, validateFindings, rebase };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaAiScanCore = api;
})(typeof window === 'undefined' ? globalThis : window);

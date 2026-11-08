'use strict';
const fs = require('node:fs'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const core = require('../public/ai-edit-core');
const conversation = require('../public/ai-conversation');
const scan = require('../public/ai-scan-core');
const xml = require('../public/xml-source');
const { decodeXmlBuffer } = require('../lib/document-files');
const corpus = require('../tests/fixtures/ai-http-acceptance.json');
const defaultDirectory = path.join(__dirname, '../examples/http_httpsusermanual');
const kinds = new Set(['edit', 'clarify', 'blocked', 'guard', 'scan-exceptions', 'scan-conflict']);
const fail = message => { throw new Error(message); };

// The oracle consists of literal, explicitly requested edits to real source.
// It never asks a second model to grade the first or writes a manual file.
function prepare(spec, directory = defaultDirectory) {
  if (!spec || !/^[a-z][a-z0-9-]{0,63}$/.test(spec.id) || !kinds.has(spec.kind) ||
      typeof spec.path !== 'string' || !/\.(dita|xml)$/i.test(spec.path) ||
      typeof spec.anchor !== 'string' || !spec.anchor) fail('验收用例格式无效');
  const root = fs.realpathSync(directory), absolute = fs.realpathSync(path.resolve(root, spec.path));
  if (!absolute.startsWith(root + path.sep)) fail('验收文档必须位于指定文档库内');
  const source = decodeXmlBuffer(fs.readFileSync(absolute));
  if (!source.includes(spec.anchor)) fail('原文锚点已变化，请更新验收用例');
  if (spec.kind.startsWith('scan-')) {
    const { records } = scan.collect([{ path: spec.path, current: source }]);
    let evidence = records.filter(record => record.input.text.includes(spec.anchor)).map(record => record.input);
    if (spec.kind === 'scan-conflict') {
      if (evidence.length !== 1 || !Array.isArray(spec.variant) || spec.variant.length !== 2 ||
          spec.variant.some(value => typeof value !== 'string' || !value) || spec.variant[0] === spec.variant[1] ||
          !evidence[0].text.includes(spec.variant[0])) fail('人工冲突变体的锚点不明确');
      evidence = [{ ...evidence[0], id: 'e0' }, { ...evidence[0], id: 'e1', path: 'acceptance-variant/' + spec.path,
        text: evidence[0].text.replace(spec.variant[0], () => spec.variant[1]) }];
    } else if (evidence.length !== 2) fail('型号例外用例应包含主文和型号注脚两处证据');
    const batch = scan.validateBatch({ phase: spec.kind === 'scan-conflict' ? 'cross' : 'section', command: spec.command, evidence });
    return { spec, source, batch };
  }
  const blocks = core.inspect(source);
  let scope, start, end;
  if (spec.block === 'document') { scope = core.documentTarget(source, spec.turns?.[0]?.instruction); start = 0; end = source.length; }
  else {
    const matches = blocks.filter(block => block.kind === spec.block && source.slice(block.start, block.end).includes(spec.anchor));
    if (matches.length !== 1) fail('原文位置不唯一，请核对验收锚点');
    ({ start, end } = matches[0]);
    if (spec.kind === 'guard') {
      if (typeof spec.error !== 'string' || !spec.error) fail('保护用例缺少预期拦截原因');
      try { core.target(source, start, end, blocks); }
      catch (error) { if (error.message.includes(spec.error)) return { spec, source, guarded: true }; throw error; }
      fail('受保护原文未被拦截');
    }
    scope = core.target(source, start, end, blocks);
  }
  if (!Array.isArray(spec.turns) || !spec.turns.length || spec.turns.length > conversation.LIMITS.turns) fail('验收对话轮次无效');
  const expected = spec.turns.map(turn => {
    if (typeof turn.instruction !== 'string' || !turn.instruction.trim() || turn.instruction.length > core.LIMITS.instruction ||
        !Array.isArray(turn.replacements)) fail('验收要求无效');
    let body = source.slice(start, end);
    for (const pair of turn.replacements) {
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some(value => typeof value !== 'string') || !pair[0] ||
          body.split(pair[0]).length !== 2) fail('预期替换不唯一，请更新验收用例');
      if (!scope.parts.some(part => part.text.includes(pair[0]))) fail('预期文字未进入可编辑的模型上下文');
      body = body.replace(pair[0], () => pair[1]);
    }
    const value = source.slice(0, start) + body + source.slice(end);
    xml.validateXml(value);
    if (spec.kind === 'edit' && value === source || spec.kind !== 'edit' && value !== source) fail('预期结果与用例类型不匹配');
    return value;
  });
  return { spec, source, scope, expected };
}

async function evaluate({ directory = defaultDirectory, cases = corpus.cases, provider, live = false } = {}) {
  if (!Array.isArray(cases) || !cases.length || cases.length > 50 || new Set(cases.map(item => item.id)).size !== cases.length) fail('请选择有效且不重复的验收用例');
  if (live && !provider?.configuration().available) fail('尚未配置可用模型，请先在工作台的模型设置中保存连接');
  const report = { mode: live ? 'live' : 'preflight', modelExecuted: false, manualReviewRequired: true,
    origin: corpus.description, rulesVersion: provider?.configuration().rulesVersion || '',
    model: live ? provider.configuration().model : '', cases: [], requests: 0, stopped: false };
  let consecutiveFailures = 0;
  for (const spec of cases) {
    const item = { id: spec.id, title: spec.title, path: spec.path, kind: spec.kind, status: 'ready', requests: 0, turns: [] };
    report.cases.push(item);
    if (report.stopped) { item.status = 'not-run'; item.reason = '连续两次请求失败，已停止后续模型调用'; continue; }
    const started = performance.now();
    let requestFailed = false;
    async function call(method, input) {
      item.requests++; report.requests++; report.modelExecuted = true;
      try { const result = await provider[method](input); consecutiveFailures = 0; return result; }
      catch (error) { requestFailed = true; throw error; }
    }
    try {
      const prepared = prepare(spec, directory);
      if (live && !prepared.guarded) {
        if (prepared.batch) {
          const result = await call('scan', prepared.batch);
          const checked = scan.validateFindings(result, prepared.batch);
          item.findings = checked.findings; item.omitted = checked.omitted + (result.omitted || 0);
          if (checked.omitted || result.omitted || result.failures?.length) fail('扫描结果存在未通过引文校验或未完成的内容');
          if (spec.kind === 'scan-exceptions' ? checked.findings.length !== 0 :
            !checked.findings.some(finding => finding.category === 'technical' && finding.evidence.some(ref => ref.id === 'e0') && finding.evidence.some(ref => ref.id === 'e1'))) fail('扫描未满足预期的型号例外或人工冲突判断，请人工核对');
        } else {
          const thread = conversation.create(prepared.scope);
          for (const [index, turn] of spec.turns.entries()) {
            const raw = await call('generate', { scope: prepared.scope, instruction: turn.instruction, conversation: thread.context(turn.instruction) });
            const applied = core.applyResult(prepared.scope, raw);
            item.turns.push({ instruction: turn.instruction, summary: raw.summary, questions: raw.questions,
              blockedReason: raw.blockedReason || '', changes: applied.changes.map(change => ({ before: change.text, after: change.after,
                conditions: change.conditions, reviewFlags: change.reviewFlags })) });
            if (applied.content !== prepared.expected[index]) fail('修改未准确满足明确要求，存在漏改、多改或额外改动，请核对提案');
            if (spec.kind === 'clarify' && (!raw.questions.length || raw.edits.length)) fail('缺少已核实事实时应保留原文并提出确认问题');
            if (spec.kind === 'blocked' && (!raw.blockedReason?.trim() || raw.edits.length)) fail('结构性请求应说明限制并保留原文');
            thread.record(turn.instruction, raw);
          }
        }
      }
      item.status = live ? 'pass' : 'ready';
    } catch (error) {
      item.status = 'fail';
      // Do not copy adapter exceptions: they can contain headers or raw bodies.
      item.reason = requestFailed ? '模型调用未成功，请检查连接、鉴权和响应格式' : error.message;
      if (requestFailed) { consecutiveFailures++; if (consecutiveFailures >= 2) report.stopped = true; }
    } finally { item.durationMs = Math.round(performance.now() - started); }
  }
  report.passed = report.cases.filter(item => item.status === 'pass').length;
  report.failed = report.cases.filter(item => item.status === 'fail').length;
  report.ready = report.cases.filter(item => item.status === 'ready').length;
  report.notRun = report.cases.filter(item => item.status === 'not-run').length;
  return report;
}
module.exports = { prepare, evaluate, corpus, defaultDirectory };

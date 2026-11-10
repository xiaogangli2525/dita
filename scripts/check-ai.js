'use strict';
const { evaluate, corpus, defaultDirectory } = require('./ai-acceptance');
const { createAiSettings } = require('../lib/ai-settings');

function options(args) {
  const value = { directory: defaultDirectory, live: false, json: false, ids: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--live') value.live = true;
    else if (arg === '--json') value.json = true;
    else if (arg === '--docs' || arg === '--case') {
      const next = args[++index]; if (!next || next.startsWith('--')) throw Error('参数缺少值');
      if (arg === '--docs') value.directory = next; else value.ids.push(next);
    } else throw Error('不支持的参数。用法：npm run check:ai -- [--live] [--case 用例ID] [--docs 文档库目录] [--json]');
  }
  if (value.ids.some(id => !corpus.cases.some(item => item.id === id))) throw Error('未知验收用例 ID，请查阅 docs/ai-acceptance.md');
  return value;
}
async function main(args = process.argv.slice(2)) {
  const settings = options(args);
  const provider = settings.live ? createAiSettings() : undefined;
  if (settings.live && !provider.configuration().available) {
    const message = '真实模型验收未运行：请先在工作台的模型设置中保存连接，或配置服务端 AI 环境变量。不要将 Key 填入命令参数或报告。';
    console.log(settings.json ? JSON.stringify({ mode: 'live', modelExecuted: false, requests: 0, status: 'blocked', message }) : message);
    return 2;
  }
  const cases = settings.ids.length ? corpus.cases.filter(item => settings.ids.includes(item.id)) : corpus.cases;
  const report = await evaluate({ ...settings, cases, provider });
  if (settings.json) console.log(JSON.stringify(report, null, 2));
  else {
    for (const item of report.cases) console.log(item.status + ' · ' + item.id + ' · ' + item.title + (item.reason ? ' · ' + item.reason : ''));
    console.log(settings.live ? `模型验收：${report.passed} 项通过，${report.failed} 项失败，${report.notRun} 项未运行，${report.requests} 次逻辑请求；仍需人工核对技术事实。` :
      `用例预检：${report.ready}/${report.cases.length} 项准备就绪；未调用模型，未验证模型准确率。`);
  }
  return report.failed || report.notRun ? 1 : 0;
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => { console.error('验收未完成：请检查命令参数、文档库和用例文件；不要提交连接密钥或原始上游错误。'); process.exitCode = 1; });
module.exports = { options, main };

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), http = require('node:http'), net = require('node:net');
const { spawn } = require('node:child_process'), { chromium } = require('playwright-core');

test('AI authoring runs through the local provider, review and shared document history', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-ai-ui-'));
  const original = '<?xml version="1.0"?><topic id="http"><title>HTTP 请求</title><body><p id="request">发送请求，然后检查返回值。</p><p>ML307R: 支持范围 1~120 秒。</p><p>MN318: 保持其他型号说明。</p></body></topic>';
  const second = '<topic id="b"><title>SSL 配置</title><body><p>配置证书后发送请求。</p></body></topic>';
  await fs.writeFile(path.join(temporary, 'a.dita'), original); await fs.writeFile(path.join(temporary, 'b.dita'), second);
  await fs.writeFile(path.join(temporary, 'main.ditamap'), '<map><title>HTTP 手册</title><topicref href="a.dita"/><topicref href="b.dita"/></map>');
  const received = [], timers = new Set();
  const provider = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks)), input = JSON.parse(body.messages[1].content); received.push(input);
    if (input.task === 'scan') {
      if (input.evidence.some(item => item.text.startsWith('拆批测试'))) {
        const large = input.evidence.length >= 8, failed = input.evidence.some(item => item.text.includes('拆批测试 9'));
        const content = large ? '{"findings":[' : failed ? '模型未使用 JSON' : '{"findings":[]}';
        res.end(JSON.stringify({ choices: [{ finish_reason: large ? 'length' : 'stop', message: { content } }] }));
        return;
      }
      const first = input.evidence.find(item => item.text.includes('超时单位为秒'));
      const second = input.evidence.find(item => item.text.includes('示例使用毫秒'));
      const wording = input.evidence.find(item => item.text.includes('发送请求'));
      const independent = input.evidence.find(item => item.path === 'b.dita' && item.text.includes('配置证书后发送请求'));
      const findings = [];
      if (input.phase === 'cross' && first && second) findings.push({ category: 'technical', summary: '超时单位写法不一致', suggestion: '以研发核实的单位为准',
        evidence: [{ id: first.id, quote: '超时单位为秒' }, { id: second.id, quote: '示例使用毫秒' }] });
      if (input.phase === 'section' && wording) findings.push({ category: 'wording', summary: '统一请求表述', suggestion: '将发送请求统一为发起请求',
        evidence: [{ id: wording.id, quote: '发送请求' }] }, { category: 'wording', summary: '虚构建议', suggestion: '无效', evidence: [{ id: wording.id, quote: '原文不存在' }] });
      if (input.phase === 'section' && independent) findings.push({ category: 'wording', summary: '核对证书步骤表述', suggestion: '统一证书步骤写法',
        evidence: [{ id: independent.id, quote: '配置证书后发送请求' }] });
      if (input.phase === 'section' && second) findings.push({ category: 'missing', summary: '补充示例前置条件', suggestion: '确认执行条件',
        evidence: [{ id: second.id, quote: '示例使用毫秒' }] });
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ findings }) } }] }));
      return;
    }
    const first = input.document.parts.find(part => part.text.includes('发送')) || input.document.parts[0];
    const previous = input.conversation?.previousResult?.edits?.[0]?.after || first.text;
    const result = input.instruction.includes('方案') ? {summary:'方案：保留技术含义，将发送请求改为发起请求，其他内容不变。',questions:[],edits:[]} : input.instruction.includes('待确认') ? { summary: '缺少正确参数', questions: ['请提供已经核实的值。'], edits: [] } :
      input.instruction.includes('以参数表为准') ? { summary: '按核实口径修订示例', questions: [], edits: [{ id: first.id, before: first.text, after: first.text.replace('毫秒', '秒') }] } :
      input.instruction.includes('60 秒') ? { summary: '已根据补充信息修改', questions: [], edits: [{ id: first.id, before: first.text, after: '发起请求（超时 60 秒）' }] } :
      input.instruction.includes('简短') ? { summary: '继续精简，保留先前润色', questions: [], edits: [{ id: first.id, before: first.text, after: previous.replace('然后', '') }] } :
      input.instruction.includes('先润色') ? { summary: '已润色可确定的部分', questions: ['尚未提供超时值。'], edits: [{ id: first.id, before: first.text, after: first.text.replace('发送', '发起') }] } :
      { summary: input.instruction.includes('恶意') ? '<img src=x onerror=alert(1)>' : '使描述更清晰', questions: [], edits: [{ id: input.instruction.includes('非法') ? 'outside' : first.id, before: first.text, after: first.text.replace('发送', '发起') }] };
    const send = () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] })); };
    if (input.instruction.includes('慢速')) { const timer = setTimeout(() => { timers.delete(timer); send(); }, 1200); timers.add(timer); } else send();
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DOCS_ROOT: temporary, REPOSITORIES_ROOT: temporary, DITA_AI_CONFIG_FILE: path.join(temporary, 'private-ai.json'), DITA_DEMO_MODE: '0', DITA_AI_BASE_URL: 'http://127.0.0.1:' + provider.address().port + '/v1', DITA_AI_MODEL: 'test-model', DITA_AI_API_KEY: 'browser-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  t.after(async () => { for (const timer of timers) clearTimeout(timer); await browser?.close(); if (server.exitCode == null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); await fs.rm(temporary, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.once('data', () => { clearTimeout(timer); resolve(); }); server.once('error', reject); });
  browser = await chromium.launch({ headless: true, ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
  const errors = [], base = 'http://127.0.0.1:' + port;
  async function fresh(st) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); st.after(() => page.close()); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message)); await page.goto(base); await page.waitForFunction(() => window.DitaApp?.state.root);
    await page.evaluate(() => window.DitaApp.openFile('a.dita')); return page;
  }
  async function select(page, text = '发送请求') {
    await page.evaluate(() => window.DitaApp.setMode('editor'));
    await page.locator('#editor').evaluate((node, text) => { node.focus(); const i = node.value.indexOf(text); node.setSelectionRange(i, i + text.length); }, text);
    await page.click('#aiButton'); await page.waitForFunction(() => document.getElementById('aiProvider').textContent.includes('test-model'));
    assert.equal(await page.locator('#aiScope').inputValue(), 'selection');
  }
  await t.test('selection proposal preserves XML, applies without saving, and uses undo/redo', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '润色'); await page.click('#aiSend');
    await page.waitForSelector('.ai-change', {state:'attached'}); assert.equal(await page.locator('.ai-after pre').textContent(), '发起请求');
    assert.equal(await page.locator('#aiApply').isDisabled(), false);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original);
    await page.click('#aiApply'); await page.waitForFunction(() => document.getElementById('aiReplyStatus').textContent.includes('已应用'));
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original.replace('发送请求', '发起请求'));
    assert.equal(await fs.readFile(path.join(temporary, 'a.dita'), 'utf8'), original);
    await page.click('#aiClose'); await page.click('#reviewButton');
    assert.match(await page.locator('#visualEditor p[data-review-change]').innerText(), /发起请求/);
    await page.click('#sourceButton'); await page.locator('#editor').focus(); await page.keyboard.press('Control+z'); assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original);
    await page.keyboard.press('Control+y'); assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original.replace('发送请求', '发起请求'));
    assert.equal(received.at(-1).document.parts[0].text, '发送请求'); assert.doesNotMatch(JSON.stringify(received.at(-1)), /MN318/);
  });
  await t.test('visual selection maps exactly to source and preserves the rest of its paragraph', async st => {
    const page = await fresh(st);
    await page.locator('#visualEditor p').first().evaluate(node => { const text = node.firstChild, range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 4); node.closest('[contenteditable]').focus(); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
    await page.click('#aiButton'); assert.equal(await page.locator('#aiScope').inputValue(), 'selection'); assert.equal(await page.locator('#aiOriginal').textContent(), '发送请求');
  });
  await t.test('manual scan compares commands, validates evidence and hands a chosen passage to review', async st => {
    const page = await fresh(st);
    await page.evaluate(async () => {
      const a = window.DitaApp;
      await a.openFile('b.dita'); await a.openFile('main.ditamap');
      for (const [path, text] of [['a.dita', 'AT+MHTTPREQUEST 超时单位为秒'], ['b.dita', 'AT+MHTTPREQUEST 示例使用毫秒']]) {
        const file = a.state.filesMap.get(path);
        a.setFileContent(file, file.current.replace('</body>', '<p>' + text + '</p></body>'));
      }
    });
    await page.click('#aiButton'); await page.click('#aiScanButton');
    assert.equal(await page.locator('#aiScanScope').inputValue(), 'manual');
    await page.click('#aiScanStart');
    const conflict = page.locator('.ai-scan-card').filter({ hasText: '超时单位写法不一致' });
    const dependent = page.locator('.ai-scan-card').filter({ hasText: '补充示例前置条件' });
    const independent = page.locator('.ai-scan-card').filter({ hasText: '核对证书步骤表述' });
    await conflict.waitFor();
    assert.equal(await conflict.locator('.ai-scan-evidence').count(), 2);
    assert.match(await page.locator('#aiScanStatus').innerText(), /完成 2\/2 批/);
    assert.equal(await page.getByText('虚构建议', { exact: true }).count(), 0);
    await conflict.locator('.ai-scan-evidence').filter({ hasText: 'b.dita' }).getByRole('button', { name: '定位原文' }).click();
    await page.locator('#visualEditor .footnote-located').filter({ hasText: '示例使用毫秒' }).waitFor();
    assert.equal(await page.locator('#aiScanPanel').isVisible(), true);
    assert.equal(await page.locator('#aiDialog').isVisible(), false);
    await conflict.locator('.ai-scan-evidence').filter({ hasText: 'b.dita' }).getByRole('button', { name: '核对后修改此处' }).click();
    assert.equal(await page.locator('#aiDialog').isVisible(), true);
    assert.equal(await page.locator('#aiSend').isDisabled(), true);
    await page.fill('#aiReply', '以参数表为准，示例用秒'); await page.click('#aiSend');
    await page.locator('#aiApply:enabled').waitFor();
    assert.match(await page.locator('#aiTechnicalReview').innerText(), /单位变化/);
    await page.click('#aiApply');
    await page.waitForFunction(() => window.DitaApp.state.filesMap.get('b.dita').current.includes('示例使用秒'));
    assert.equal(await fs.readFile(path.join(temporary, 'b.dita'), 'utf8'), second);
    assert.equal(await page.locator('#aiDialog').isVisible(), false);
    assert.equal(await page.locator('#aiScanPanel').isVisible(), true);
    assert.equal(await conflict.getByText('已处理', { exact: true }).count(), 1);
    assert.equal(await dependent.getByText('证据已变化 · 需重扫', { exact: true }).count(), 1);
    assert.equal(await conflict.getByRole('button', { name: '定位原文' }).first().isDisabled(), true);
    assert.equal(await independent.getByRole('button', { name: '定位原文' }).isEnabled(), true);
    await independent.getByRole('button', { name: '定位原文' }).click();
    await page.locator('#visualEditor .footnote-located').filter({ hasText: '配置证书后发送请求' }).waitFor();
    await page.click('#authorUndoButton');
    await page.waitForFunction(() => !document.querySelector('.ai-scan-badge'));
    assert.equal(await conflict.getByRole('button', { name: '定位原文' }).first().isEnabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    const body = await page.locator('#visualPane').boundingBox(), panel = await page.locator('#inspector').boundingBox();
    assert.ok(body.y + body.height <= panel.y + 1, 'scan results leave the document visible on narrow screens');
  });
  await t.test('partial scan recovery shows covered evidence without marking the whole batch complete', async st => {
    const page = await fresh(st);
    await page.evaluate(() => {
      const a = window.DitaApp, file = a.state.filesMap.get('a.dita');
      const paragraphs = Array.from({ length: 10 }, (_, index) => '<p>拆批测试 ' + index + '</p>').join('');
      a.setFileContent(file, file.current.replace('</body>', paragraphs + '</body>'));
    });
    await page.click('#aiButton'); await page.click('#aiScanButton'); await page.click('#aiScanStart');
    await page.waitForFunction(() => document.getElementById('aiScanStatus').textContent.includes('覆盖 7/14'));
    assert.match(await page.locator('#aiScanStatus').innerText(), /完成 0\/1 批/);
    assert.match(await page.locator('#aiScanResults').innerText(), /第 1 批部分完成/);
  });
  await t.test('manual search requires an explicit candidate and applies to the selected topic', async st => {
    const page = await fresh(st); await page.click('#aiButton'); await page.fill('#aiReply', '润色发送请求的描述'); await page.locator('#aiTask > summary').click(); await page.selectOption('#aiScope', 'manual'); await page.fill('#aiSearch', '发送请求'); await page.click('#aiLocate');
    await page.waitForSelector('.ai-candidate'); assert.equal(await page.locator('.ai-candidate').filter({ hasText: '发送请求' }).count(), 2); assert.equal(await page.locator('#aiSend').isEnabled(), true);
    await page.locator('.ai-candidate').filter({ hasText: 'b.dita' }).click(); await page.waitForSelector('.ai-change', {state:'attached'}); await page.click('#aiApply');
    await page.waitForFunction(() => document.getElementById('aiStatus').textContent.includes('已应用'));
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('b.dita').current), second.replace('发送', '发起'));
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original);
  });
  await t.test('missing technical facts produce questions without an applicable proposal', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '参数值待确认'); await page.click('#aiSend'); await page.waitForSelector('#aiQuestions li');
    assert.equal(await page.locator('#aiApply').isVisible(), false); assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').dirty), false);
  });
  await t.test('malformed model edits are rejected and error text remains actionable', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '非法输出'); await page.click('#aiSend'); await page.waitForSelector('#aiReplyStatus.is-error');
    assert.match(await page.locator('#aiStatus').textContent(), /越界/); assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').dirty), false);
  });
  await t.test('cancellation discards delayed responses and keeps the user instruction', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '慢速润色'); await page.click('#aiSend'); await page.click('#aiCancel');
    assert.match(await page.locator('#aiStatus').textContent(), /已取消/); await page.waitForTimeout(1400);
    assert.equal(await page.locator('#aiReview').isVisible(), false); assert.equal(await page.locator('#aiReply').inputValue(), '慢速润色');
  });
  await t.test('new working edits invalidate a pending model response', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '慢速润色'); await page.click('#aiSend');
    await page.evaluate(() => { const A = window.DitaApp, file = A.state.filesMap.get('a.dita'); A.setFileContent(file, file.current.replace('检查', '人工核对')); });
    await page.waitForTimeout(1400); assert.equal(await page.locator('#aiReview').isVisible(), false); assert.match(await page.locator('#aiStatus').textContent(), /变化/);
    assert.match(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), /人工核对/);
  });
  await t.test('review treats model text as text and remains usable across skins and narrow screens', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '恶意摘要润色'); await page.click('#aiSend'); await page.waitForSelector('.ai-change', {state:'attached'});
    assert.equal(await page.locator('.ai-turn-assistant img').count(), 0); assert.match(await page.locator('.ai-turn-assistant p').last().textContent(), /<img/);
    for (const theme of ['forest', 'blue', 'paper', 'dark']) {
      await page.evaluate(theme => window.DitaTheme.set(theme), theme);
      await page.setViewportSize({ width: 390, height: 844 });
      const size = await page.locator('#aiDialog').evaluate(node => ({ width: node.getBoundingClientRect().width, scroll: node.scrollWidth, client: node.clientWidth }));
      assert.ok(size.width <= 390); assert.ok(size.scroll <= size.client + 1);
    }
    await page.screenshot({ path: '/tmp/dita-ai-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.evaluate(() => window.DitaTheme.set('forest')); await page.screenshot({ path: '/tmp/dita-ai-review.png' });
  });
  await t.test('AI routes enforce workspace/origin guards and do not block saving during generation', async () => {
    const workspace = await (await fetch(base + '/api/workspace')).json(), token = workspace.workspaceToken;
    const request = (route, body, headers = {}) => fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-workspace-token': token, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await request('/api/ai/config', null, { 'x-workspace-token': 'stale' })).status, 409);
    assert.equal((await request('/api/ai/config', null, { origin: 'https://evil.test' })).status, 403);
    assert.doesNotMatch(await (await request('/api/ai/config')).text(), /browser-test-secret/);
    const pending = request('/api/ai/propose', { source: original, start: original.indexOf('发送'), end: original.indexOf('发送') + 4, instruction: '慢速润色' });
    let resolved = false; pending.then(() => { resolved = true; });
    const saved = await fetch(base + '/api/file', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-workspace-token': token }, body: JSON.stringify({ path: 'a.dita', content: original, expectedContent: original }) });
    assert.equal(saved.status, 200); assert.equal(resolved, false); assert.equal((await pending).status, 200);
  });
  await t.test('connection UI updates server settings without returning or storing a secret', async st => {
    const page = await fresh(st); await select(page); await page.click('#aiSettingsButton'); await page.waitForFunction(() => !document.getElementById('aiConnectionFields').disabled);
    await page.fill('#aiKey', 'replaced-test-key'); await page.click('#aiConnectionSave');
    await page.waitForFunction(() => document.getElementById('aiConnectionHint').textContent.includes('已保存'));
    assert.equal(await page.locator('#aiKey').inputValue(), '');
    assert.match(await page.locator('#aiKey').getAttribute('placeholder'), /已配置/);
    assert.doesNotMatch(await page.locator('#aiDialog').textContent(), /replaced-test-key/);
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('replaced-test-key')), false);
    await page.click('#aiConnectionClose'); await page.fill('#aiReply', '润色'); await page.click('#aiSend'); await page.waitForSelector('.ai-change', {state:'attached'});
  });
  await t.test('answering a question continues the same task and produces an applicable modification', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '参数值待确认'); await page.click('#aiSend'); await page.waitForSelector('#aiQuestions li');
    await page.fill('#aiReply', '已核实，60 秒'); await page.click('#aiSend');
    await page.waitForFunction(() => document.querySelector('.ai-after pre')?.textContent.includes('60 秒'));
    assert.equal(await page.locator('.ai-turn-user').count(), 2); assert.equal(await page.locator('#aiReply').inputValue(), '');
    assert.deepEqual(received.at(-1).conversation.instructions, ['参数值待确认']); assert.deepEqual(received.at(-1).conversation.previousResult.questions, ['请提供已经核实的值。']);
    assert.equal(await page.locator('#aiApply').isEnabled(), true); await page.click('#aiApply');
    await page.waitForFunction(() => window.DitaApp.state.filesMap.get('a.dita').current.includes('60 秒'));
    assert.equal(await fs.readFile(path.join(temporary, 'a.dita'), 'utf8'), original);
  });
  await t.test('continuous revision keeps previous changes and applies one cumulative proposal', async st => {
    const page = await fresh(st); await select(page, '发送请求，然后检查返回值。'); await page.fill('#aiReply', '润色并保留技术术语'); await page.click('#aiSend'); await page.waitForSelector('.ai-change', {state:'attached'});
    await page.fill('#aiReply', '再简短些'); await page.locator('#aiReply').press('Control+Enter');
    await page.waitForFunction(() => document.querySelector('.ai-after pre')?.textContent === '发起请求，检查返回值。');
    assert.deepEqual(received.at(-1).conversation.instructions, ['润色并保留技术术语']);
    assert.equal(received.at(-1).conversation.previousResult.edits[0].after, '发起请求，然后检查返回值。');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original);
    await page.click('#aiApply'); await page.waitForFunction(() => window.DitaApp.state.filesMap.get('a.dita').current.includes('发起请求，检查返回值。'));
    await page.click('#aiClose'); await page.locator('#editor').focus(); await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original);
  });
  await t.test('partial known work is applicable while missing facts remain available for followup', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '先润色并确认参数'); await page.click('#aiSend'); await page.waitForSelector('#aiQuestions li');
    assert.equal(await page.locator('#aiApply').isEnabled(), true); assert.equal(await page.locator('.ai-after pre').textContent(), '发起请求');
    await page.click('#aiApply'); await page.waitForFunction(() => document.getElementById('aiReplyStatus').textContent.includes('已应用'));
    await page.fill('#aiReply', '已核实，60 秒'); await page.click('#aiSend'); await page.waitForSelector('.ai-change', {state:'attached'});
    assert.equal(received.at(-1).document.parts[0].text, '发起请求'); assert.deepEqual(received.at(-1).conversation.previousResult.edits, []);
    assert.deepEqual(received.at(-1).conversation.previousResult.questions, ['尚未提供超时值。']);
  });
  await t.test('closing and reopening preserves the same conversation and an unsent reply', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '润色'); await page.click('#aiSend'); await page.waitForSelector('.ai-change', {state:'attached'});
    await page.fill('#aiReply', '还需要补充的要求'); await page.click('#aiClose'); await page.click('#aiButton');
    assert.equal(await page.locator('.ai-turn-user').count(), 1); assert.equal(await page.locator('#aiReply').inputValue(), '还需要补充的要求');
    assert.equal(await page.locator('#aiApply').isEnabled(), true);
  });
  await t.test('a cancelled followup preserves the last proposal, prior turns and reply for retry', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '润色'); await page.click('#aiSend'); await page.waitForSelector('.ai-change', {state:'attached'});
    await page.fill('#aiReply', '慢速修改'); await page.click('#aiSend'); await page.click('#aiCancel'); await page.waitForTimeout(1400);
    assert.equal(await page.locator('.ai-after pre').textContent(), '发起请求'); assert.equal(await page.locator('.ai-turn-user').count(), 1);
    assert.equal(await page.locator('#aiReply').inputValue(), '慢速修改'); assert.equal(await page.locator('#aiApply').isEnabled(), true);
  });
  await t.test('a user can draft the next message during generation without having it cleared by the response', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '润色'); await page.click('#aiSend'); await page.waitForSelector('.ai-change', {state:'attached'});
    await page.fill('#aiReply', '慢速修改'); await page.click('#aiSend'); await page.fill('#aiReply', '下一条补充，先不要发送');
    await page.waitForFunction(() => document.querySelectorAll('.ai-turn-user').length === 2);
    assert.equal(await page.locator('#aiReply').inputValue(), '下一条补充，先不要发送');
    assert.equal(received.at(-1).instruction, '慢速修改');
  });
  await t.test('changing document starts a fresh task and model settings are outside the conversation', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '润色'); await page.click('#aiSend'); await page.waitForSelector('.ai-change', {state:'attached'});
    assert.equal(await page.locator('#aiDialog #aiKey').count(), 0);
    await page.click('#aiClose'); await page.evaluate(() => window.DitaApp.openFile('b.dita')); await page.click('#aiButton');
    assert.equal(await page.locator('.ai-turn').count(), 0); assert.equal(await page.locator('#aiReply').inputValue(), '');
  });
  await t.test('an explicit conversational apply command applies the displayed proposal without asking the model again', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '润色'); await page.click('#aiSend'); await page.waitForSelector('.ai-change', {state:'attached'});
    const requests = received.length; await page.fill('#aiReply', '按这个改'); await page.click('#aiSend');
    await page.waitForFunction(() => window.DitaApp.state.filesMap.get('a.dita').current.includes('发起请求'));
    assert.equal(received.length, requests); assert.equal(await page.locator('#aiReply').inputValue(), '');
    assert.equal(await fs.readFile(path.join(temporary, 'a.dita'), 'utf8'), original);
  });
  await t.test('an apply command without a proposal explains the missing work without repeating model calls', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '参数值待确认'); await page.click('#aiSend'); await page.waitForSelector('#aiQuestions li');
    const requests = received.length; await page.fill('#aiReply', '应用这版'); await page.click('#aiSend');
    assert.match(await page.locator('#aiReplyStatus').textContent(), /没有可应用/); assert.equal(received.length, requests);
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original);
  });
  await t.test('a negated apply phrase stays a revision request and does not modify the document', async st => {
    const page = await fresh(st); await select(page); await page.fill('#aiReply', '润色'); await page.click('#aiSend'); await page.waitForSelector('.ai-change', {state:'attached'});
    await page.fill('#aiReply', '不要按这个改'); await page.click('#aiSend'); await page.waitForFunction(() => document.querySelectorAll('.ai-turn-user').length === 2);
    assert.equal(received.at(-1).instruction, '不要按这个改');
    assert.equal(await page.evaluate(() => window.DitaApp.state.filesMap.get('a.dita').current), original);
  });
  await t.test('opening AI starts with a focused chat composer and automatically uses the current document', async st => {
    const page = await fresh(st); await page.evaluate(()=>{window.DitaApp.setMode('editor');const e=document.getElementById('editor');e.focus();e.setSelectionRange(0,0);});
    await page.click('#aiButton'); await page.waitForFunction(()=>document.getElementById('aiProvider').textContent.includes('test-model'));
    assert.equal(await page.locator('#aiTask').evaluate(n=>n.open),false); assert.equal(await page.locator('#aiReply').evaluate(n=>n===document.activeElement),true);
    await page.fill('#aiReply','先给我修改方案');await page.click('#aiSend');await page.waitForFunction(()=>document.querySelectorAll('.ai-turn-assistant').length===1);
    assert.equal(await page.locator('#aiReview').isVisible(),false);assert.equal(await page.evaluate(()=>window.DitaApp.state.filesMap.get('a.dita').current),original);
    assert.ok(received.at(-1).document.parts.length>1);assert.deepEqual(received.at(-1).conversation.instructions,[]);
    await page.fill('#aiReply','按这个改');await page.click('#aiSend');await page.waitForFunction(()=>window.DitaApp.state.filesMap.get('a.dita').current.includes('发起请求'));
    assert.deepEqual(received.at(-1).conversation.instructions,['先给我修改方案']);
  });
  await t.test('numeric changes are highlighted with exact source locations for review', async st => {
    const page = await fresh(st);await select(page);await page.fill('#aiReply','已核实，60 秒');await page.click('#aiSend');await page.waitForSelector('#aiTechnicalReview');
    assert.match(await page.locator('#aiTechnicalReview').textContent(),/数值或范围变化/);await page.locator('#aiDiff > summary').click();
    assert.match(await page.locator('.ai-change-location').first().textContent(),/第 \d+ 行/);assert.equal(await page.evaluate(()=>window.DitaApp.state.filesMap.get('a.dita').current),original);
  });
  await t.test('optional manual scope is honored when sending chat directly without pressing Locate', async st => {
    const page=await fresh(st);await page.click('#aiButton');await page.waitForFunction(()=>document.getElementById('aiProvider').textContent.includes('test-model'));
    await page.locator('#aiTask > summary').click();await page.selectOption('#aiScope','manual');await page.fill('#aiReply','润色配置证书后的操作说明');await page.click('#aiSend');
    await page.waitForFunction(()=>document.getElementById('aiContextLabel').textContent.includes('b.dita'));await page.waitForSelector('.ai-change',{state:'attached'});
    assert.equal(await page.evaluate(()=>window.DitaApp.state.filesMap.get('a.dita').current),original);
    assert.ok(received.at(-1).document.parts.some(part=>part.text==='配置证书后发送请求。'));
  });
  assert.deepEqual(errors, []);
});

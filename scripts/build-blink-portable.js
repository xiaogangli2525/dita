'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { unzipSync, zipSync } = require('fflate');
const { bookFromPath, flatten } = require('../lib/knowledge-book');
const { validate, PROFILE } = require('../public/knowledge-semantic');
const { createEncoder } = require('../lib/semantic-encoder');

async function main() {
  const [input, destination = 'dist/blink-cli-windows-x64.zip', htmlInput] = process.argv.slice(2);
  if (!input) throw Error('用法：npm run build:blink -- <含语义索引的知识库.json或ZIP> [输出.zip] [原HTML知识库.zip]');
  const root = path.join(__dirname, '..'), book = bookFromPath(input);
  validate(flatten(book), book.semantic);
  const htmlSource = htmlInput || (/\.zip$/i.test(input) ? input : '');
  let htmlFiles = {};
  if (htmlSource) {
    const original = bookFromPath(htmlSource);
    const identity = value => flatten(value).map(row => [row.manualId, row.anchor, row.title, row.text]);
    if (original.model !== book.model || original.sdkVersion !== book.sdkVersion || JSON.stringify(identity(original)) !== JSON.stringify(identity(book))) throw Error('HTML 来源与语义知识库的型号、版本或正文不一致');
    const names = new Set(['docs/index.html', 'docs/manifest.json', 'docs/README.txt', ...book.manuals.map(manual => 'docs/manuals/' + manual.id + '.html')]);
    htmlFiles = unzipSync(await fs.readFile(htmlSource), { filter: item => names.has(item.name) });
    for (const name of names) if (name.endsWith('.html') && !htmlFiles[name]) throw Error('原知识库缺少 HTML 文件：' + name);
  }
  const modelRoot = process.env.BLINK_MODELS || path.join(root, 'models');
  await createEncoder(modelRoot).check();
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'blink-portable-'));
  try {
    const bundle = path.join(stage, 'blink-cli'), app = path.join(bundle, 'runtime', 'app');
    await fs.mkdir(app, { recursive: true });
    const files = ['bin/blink-cli.js', 'lib/knowledge-book.js', 'lib/knowledge-semantic.js', 'lib/semantic-encoder.js',
      'public/knowledge-search.js', 'public/knowledge-retrieval.js', 'public/knowledge-semantic.js'];
    for (const name of files) { await fs.mkdir(path.dirname(path.join(app, name)), { recursive: true }); await fs.copyFile(path.join(root, name), path.join(app, name)); }
    await fs.cp(path.join(modelRoot, PROFILE.model), path.join(bundle, 'runtime', 'models', PROFILE.model), { recursive: true });
    await fs.cp(path.join(root, 'docs', 'licenses'), path.join(bundle, 'runtime', 'licenses'), { recursive: true });
    const notices = path.join(bundle, 'runtime', 'licenses', 'onnxruntime-third-party-1.21.0.txt');
    execFileSync('curl', ['--fail', '--location', '--retry', '2', '--max-time', '30',
      'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.21.0/ThirdPartyNotices.txt', '--output', notices], { stdio: 'inherit' });
    if (createHash('sha256').update(await fs.readFile(notices)).digest('hex') !== '8c06e8cff286a4a117b3b246a4c7da68428a144af757823db50e3d6520941ec6') throw Error('运行库第三方许可文件校验失败');
    await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'blink-offline-search', version: '1.0.0', private: true,
      type: 'commonjs', dependencies: { '@huggingface/transformers': '3.8.1', fflate: '0.8.3' } }, null, 2));
    // Install target-platform CPU dependencies at build time; end users unpack them.
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--ignore-scripts', '--os=win32', '--cpu=x64', '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
    const runtime = path.join(app, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
    for (const name of await fs.readdir(runtime)) if (name !== 'win32') await fs.rm(path.join(runtime, name), { recursive: true });
    await fs.rm(path.join(runtime, 'win32', 'arm64'), { recursive: true, force: true });
    // Native ONNX is used for CPU inference; browser WASM and source maps are unused.
    const webDist = path.join(app, 'node_modules', 'onnxruntime-web', 'dist');
    for (const name of await fs.readdir(webDist)) if (name.endsWith('.wasm') || name.endsWith('.map')) await fs.rm(path.join(webDist, name));
    const transformer = path.join(app, 'node_modules', '@huggingface', 'transformers');
    for (const name of ['src', 'types']) await fs.rm(path.join(transformer, name), { recursive: true, force: true });
    for (const name of await fs.readdir(path.join(transformer, 'dist'))) if (name !== 'transformers.node.cjs' && name !== 'transformers.node.mjs') await fs.rm(path.join(transformer, 'dist', name));
    const nodeZip = path.join(stage, 'node.zip');
    execFileSync('curl', ['--fail', '--location', '--retry', '2', '--max-time', '180',
      'https://nodejs.org/dist/v22.23.5/node-v22.23.5-win-x64.zip', '--output', nodeZip], { stdio: 'inherit' });
    const bytes = await fs.readFile(nodeZip);
    if (createHash('sha256').update(bytes).digest('hex') !== '4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3') throw Error('Windows Node 运行时校验失败');
    const nodeFiles = unzipSync(bytes, { filter: item => /\/(node.exe|LICENSE)$/.test(item.name) });
    for (const [name, data] of Object.entries(nodeFiles)) await fs.writeFile(path.join(bundle, 'runtime', path.basename(name)), data);
    await fs.mkdir(path.join(bundle, 'docs'));
    for (const [name, data] of Object.entries(htmlFiles)) {
      const target = path.join(bundle, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data);
    }
    if (htmlFiles['docs/manifest.json']) {
      const manifest = JSON.parse(new TextDecoder().decode(htmlFiles['docs/manifest.json']));
      manifest.semantic = { profile: book.semantic.profile, chunks: book.semantic.chunks.length, data: 'knowledge.json#semantic' };
      await fs.writeFile(path.join(bundle, 'docs', 'manifest.json'), JSON.stringify(manifest, null, 2));
    }
    await fs.writeFile(path.join(bundle, 'docs', 'knowledge.json'), JSON.stringify(book));
    await fs.writeFile(path.join(bundle, 'blink-cli.cmd'), '@echo off\r\nsetlocal\r\nif not defined BLINK_KB set "BLINK_KB=%~dp0docs\\knowledge.json"\r\nif not defined BLINK_MODELS set "BLINK_MODELS=%~dp0runtime\\models"\r\n"%~dp0runtime\\node.exe" "%~dp0runtime\\app\\bin\\blink-cli.js" %*\r\n');
    const htmlHelp = htmlFiles['docs/index.html'] ? '双击 docs/index.html 阅读手册。' : '本包提供 CLI 检索。构建时可指定原知识库 ZIP，一并保留 HTML。';
    await fs.writeFile(path.join(bundle, 'README.txt'), '离线知识库检索验证版\n\n' + htmlHelp + '向量数据位于 docs/knowledge.json 的 semantic 字段。\n\n在解压目录打开 PowerShell，执行\n.\\blink-cli.cmd --info\n.\\blink-cli.cmd KB "怎么把日志取出来"\n.\\blink-cli.cmd KB "看一下还有多少内存可用" --json\n.\\blink-cli.cmd KB "webui二次认证"\n\n随包提供 Windows x64 Node、CPU 推理运行库、分词器、量化模型和知识库。运行时从本地加载全部资源。搜索结果是原文线索，请结合章节核对。\n模型来源 https://huggingface.co/Xenova/bge-small-zh-v1.5\n基础模型 https://huggingface.co/BAAI/bge-small-zh-v1.5\n运行依赖位于 runtime/app/node_modules；模型位于 runtime/models；许可说明位于 runtime/licenses 和 runtime/LICENSE。\n');
    const archive = {};
    async function collect(dir, prefix) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const source = path.join(dir, entry.name), name = prefix + '/' + entry.name;
        if (entry.isDirectory()) await collect(source, name);
        else if (entry.isFile()) archive[name] = new Uint8Array(await fs.readFile(source));
      }
    }
    await collect(bundle, 'blink-cli');
    const target = path.resolve(destination); await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, zipSync(archive, { level: 6 }));
    console.log('Windows 离线便携包已生成：' + target);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

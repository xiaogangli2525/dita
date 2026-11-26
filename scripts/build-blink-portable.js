'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { unzipSync, zipSync } = require('fflate');
const { bookFromPath, flatten } = require('../lib/knowledge-book');
const { validate, PROFILE, COMPACT_SCHEMA, vectorEncoding } = require('../public/knowledge/knowledge-semantic');
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
    const files = ['bin/blink-cli.js', 'lib/knowledge-book.js', 'lib/abort.js', 'lib/knowledge-semantic.js', 'lib/knowledge-index.js', 'lib/knowledge-vector-cache.js', 'lib/semantic-encoder.js', 'lib/knowledge-structure.js',
      'lib/http-utils.js', 'lib/knowledge-reader-server.js', 'public/knowledge/knowledge-reader.js',
      'public/knowledge/knowledge-search.js', 'public/knowledge/knowledge-search-profile.js', 'public/knowledge/knowledge-retrieval.js',
      'public/knowledge/knowledge-ranking.js', 'public/knowledge/knowledge-semantic.js', 'public/knowledge/semantic-model-assets.json',
      'public/knowledge/knowledge-structure.js', 'public/knowledge/knowledge-limits.js'];
    for (const name of files) { await fs.mkdir(path.dirname(path.join(app, name)), { recursive: true }); await fs.copyFile(path.join(root, name), path.join(app, name)); }
    await fs.cp(path.join(modelRoot, PROFILE.model), path.join(bundle, 'runtime', 'models', PROFILE.model), { recursive: true });
    const onnxVersion = '1.21.0';
    await fs.cp(path.join(root, 'docs', 'licenses'), path.join(bundle, 'runtime', 'licenses'), { recursive: true });
    const notices = path.join(bundle, 'runtime', 'licenses', 'onnxruntime-third-party-' + onnxVersion + '.txt');
    if (createHash('sha256').update(await fs.readFile(notices)).digest('hex') !== '8c06e8cff286a4a117b3b246a4c7da68428a144af757823db50e3d6520941ec6') throw Error('运行库第三方许可文件校验失败');
    await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'blink-offline-search', version: '1.0.0', private: true,
      type: 'commonjs', dependencies: { '@huggingface/transformers': '3.8.1', fflate: '0.8.3', parse5: '7.3.0' } }, null, 2));
    // Install target-platform CPU dependencies at build time; end users unpack them.
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--ignore-scripts', '--os=win32', '--cpu=x64', '--no-audit', '--no-fund'], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });
    const onnx = path.join(app, 'node_modules', 'onnxruntime-node');
    const installedVersion = JSON.parse(await fs.readFile(path.join(onnx, 'package.json'), 'utf8')).version;
    if (installedVersion !== onnxVersion) throw Error('ONNX Runtime 版本与许可通知不匹配：' + installedVersion);
    const runtime = path.join(onnx, 'bin', 'napi-v3');
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
    const nodeRoot = 'node-v22.23.5-win-x64/';
    const nodeFiles = unzipSync(bytes, { filter: item => item.name === nodeRoot + 'node.exe' || item.name === nodeRoot + 'LICENSE' });
    for (const name of ['node.exe', 'LICENSE']) {
      const data = nodeFiles[nodeRoot + name];
      if (!data?.length) throw Error('Windows Node 压缩包缺少文件：' + name);
      await fs.writeFile(path.join(bundle, 'runtime', name), data);
    }
    await fs.mkdir(path.join(bundle, 'docs'));
    for (const [name, data] of Object.entries(htmlFiles)) {
      const target = path.join(bundle, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data);
    }
    if (htmlFiles['docs/manifest.json']) {
      const manifest = JSON.parse(new TextDecoder().decode(htmlFiles['docs/manifest.json']));
      manifest.semantic = { profile: book.semantic.profile, chunks: book.semantic.chunks.length,
        ...(book.semantic.schema === COMPACT_SCHEMA ? { vectorEncoding: vectorEncoding(book.semantic.schema) } : {}), data: 'knowledge.json#semantic' };
      await fs.writeFile(path.join(bundle, 'docs', 'manifest.json'), JSON.stringify(manifest, null, 2));
    }
    await fs.writeFile(path.join(bundle, 'docs', 'knowledge.json'), JSON.stringify(book));
    await fs.writeFile(path.join(bundle, 'blink-cli.cmd'), '@echo off\r\nsetlocal\r\nif not defined BLINK_KB set "BLINK_KB=%~dp0docs\\knowledge.json"\r\nif not defined BLINK_MODELS set "BLINK_MODELS=%~dp0runtime\\models"\r\n"%~dp0runtime\\node.exe" "%~dp0runtime\\app\\bin\\blink-cli.js" %*\r\n');
    if (htmlFiles['docs/index.html']) await fs.writeFile(path.join(bundle, 'blink-reader.cmd'), '@echo off\r\ncall "%~dp0blink-cli.cmd" --serve\r\n');
    const htmlHelp = htmlFiles['docs/index.html'] ? '请先完整解压 ZIP。双击 blink-reader.cmd，把窗口显示的本机地址复制到浏览器。保持窗口开启，勾选“本机语义检索”，输入问题后按回车。结果上方显示“本机混合搜索”时，查询已完成。\n只需阅读和关键词检索时，可直接打开 docs/index.html。\n' : '本包提供 CLI 检索。构建时可指定原知识库 ZIP，一并保留 HTML。';
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

#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require('fflate');
const { createSearchEngine } = require('../public/knowledge-search');

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 128 * 1024 * 1024;

function decode(value) {
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}

function jsonEnd(source, start) {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) return i + 1;
      if (depth < 0) break;
    }
  }
  throw new Error('知识库 HTML 中的结构化数据不完整');
}

function bookFromHtml(html) {
  const script = html.indexOf('<script>');
  const marker = html.indexOf('})({', script < 0 ? 0 : script);
  if (marker < 0) throw new Error('找不到知识库数据。请使用新版本导出的知识库 ZIP。');
  const start = marker + 3;
  return JSON.parse(html.slice(start, jsonEnd(html, start)));
}

function parseBook(value, sourceName) {
  let book;
  try { book = JSON.parse(value); }
  catch (error) { throw new Error(sourceName + ' 不是有效的 JSON：' + error.message, { cause: error }); }
  if (!book || book.schema !== 1 || !Array.isArray(book.manuals)) {
    throw new Error(sourceName + ' 不是受支持的知识库数据格式');
  }
  const entries = book.manuals.reduce((sum, manual) => sum + (Array.isArray(manual.entries) ? manual.entries.length : 0), 0);
  if (!book.manuals.length || !entries) throw new Error('知识库中没有可检索的章节');
  return book;
}

function bookFromArchive(bytes) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('知识库 ZIP 超过 64 MiB 安全读取上限');
  let files;
  try { files = unzipSync(bytes); }
  catch (error) { throw new Error('无法读取知识库 ZIP：' + error.message, { cause: error }); }
  const names = Object.keys(files);
  if (names.length > 2000) throw new Error('知识库 ZIP 文件数量异常');
  let unpacked = 0;
  for (const value of Object.values(files)) {
    unpacked += value.byteLength;
    if (unpacked > MAX_UNPACKED_BYTES) throw new Error('知识库 ZIP 解压后超过 128 MiB 安全读取上限');
  }
  const data = files['docs/knowledge.json'] || files['knowledge.json'];
  if (data) return parseBook(decode(data), 'docs/knowledge.json');
  const html = files['docs/index.html'] || files['index.html'];
  if (html) return bookFromHtml(decode(html));
  throw new Error('ZIP 中没有 docs/knowledge.json 或 docs/index.html');
}

function bookFromPath(input) {
  const target = path.resolve(input);
  if (!fs.existsSync(target)) throw new Error('知识库路径不存在：' + target);
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const candidates = [
      path.join(target, 'docs', 'knowledge.json'),
      path.join(target, 'knowledge.json'),
      path.join(target, 'docs', 'index.html'),
      path.join(target, 'index.html')
    ];
    const found = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!found) throw new Error('目录中没有 knowledge.json 或 index.html：' + target);
    if (fs.statSync(found).size > MAX_ARCHIVE_BYTES) throw new Error('知识库文件超过 64 MiB 安全读取上限');
    const value = fs.readFileSync(found);
    return found.endsWith('.json') ? parseBook(value.toString('utf8'), found) : bookFromHtml(value.toString('utf8'));
  }
  if (!stat.isFile()) throw new Error('知识库路径不是普通文件：' + target);
  if (stat.size > MAX_ARCHIVE_BYTES) throw new Error('知识库文件超过 64 MiB 安全读取上限');
  const value = fs.readFileSync(target);
  if (/\.zip$/i.test(target)) return bookFromArchive(value);
  if (/\.json$/i.test(target)) return parseBook(value.toString('utf8'), target);
  if (/\.html?$/i.test(target)) return bookFromHtml(value.toString('utf8'));
  throw new Error('不支持的知识库文件类型，请使用 ZIP、JSON 或 HTML');
}

function defaultKnowledgePath() {
  const candidates = [
    process.env.BLINK_KB,
    path.resolve(process.cwd(), 'docs', 'knowledge.json'),
    path.resolve(process.cwd(), 'knowledge.json'),
    path.resolve(process.cwd(), 'docs', 'index.html'),
    path.resolve(process.cwd(), 'index.html')
  ].filter(Boolean);
  const existing = candidates.find(candidate => fs.existsSync(candidate));
  if (existing) return existing;
  const archives = fs.readdirSync(process.cwd()).filter(name => /knowledge.*\\.zip$/i.test(name));
  return archives.length === 1 ? path.resolve(process.cwd(), archives[0]) : '';
}

function parseArgs(args) {
  const options = { query: [], json: false, limit: 10 };
  const values = new Set(['--kb', '--limit', '--manual', '--module', '--mode', '--get']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--info') options.info = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (values.has(arg)) {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error(arg + ' 缺少参数');
      options[arg.slice(2)] = args[++i];
    } else if (arg.startsWith('-')) throw new Error('未知参数：' + arg);
    else options.query.push(arg);
  }
  if (options.limit !== undefined) {
    options.limit = Number(options.limit);
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) throw new Error('--limit 必须是 1～50 的整数');
  }
  if ([options.list, options.info, Boolean(options.get)].filter(Boolean).length > 1) throw new Error('--list、--info 和 --get 不能同时使用');
  if ((options.list || options.info || options.get) && options.query.length) throw new Error('管理命令不能同时带搜索问题');
  if (!options.list && !options.info && !options.get && !options.query.length && !options.help) throw new Error('请输入搜索内容，或使用 --list / --info');
  return options;
}

function resolveManual(book, value) {
  const key = String(value).trim().toLocaleLowerCase();
  const exact = book.manuals.find(manual => manual.id.toLocaleLowerCase() === key || manual.title.toLocaleLowerCase() === key);
  if (exact) return exact;
  const matches = book.manuals.filter(manual => manual.title.toLocaleLowerCase().includes(key));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error('--manual 匹配到多份手册，请使用完整手册名称或 ID');
  throw new Error('找不到手册：' + value);
}

function flatten(book) {
  return book.manuals.flatMap(manual => manual.entries.map(entry => ({
    ...entry, manualId: manual.id, manualTitle: manual.title, mode: manual.mode || 'other',
    module: manual.module || manual.title
  })));
}

function sourceFor(book, manualId) {
  const manual = book.manuals.find(item => item.id === manualId);
  return manual ? { repository: manual.source?.repository || '', commit: manual.source?.commit || null, dirty: manual.source?.dirty ?? null } : null;
}

function outputJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write('错误：' + error.message + '\n'); process.exitCode = 2; return; }
  if (options.help) {
    process.stdout.write([
      'blink-cli — 离线 DITA 知识库检索',
      '',
      '用法：',
      '  blink-cli "搜索问题" [--json] [--limit 10]',
      '  blink-cli "搜索问题" --manual "HTTP/HTTPS用户手册"',
      '  blink-cli --list [--json]',
      '  blink-cli --info [--json]',
      '  blink-cli --get "手册ID#章节锚点" [--json]',
      '',
      '选项：',
      '  --kb <路径>       知识库 ZIP、解压目录、knowledge.json 或 index.html',
      '  --manual <名称>   限定手册',
      '  --module <模块>   限定功能模块',
      '  --mode <AT|OC>   限定开发方式',
      '  --limit <1-50>   返回数量，默认 10',
      '  --json            输出机器可读 JSON',
      '  --list            列出手册',
      '  --info            显示知识库版本和来源',
      '  --get <引用>      读取完整章节，引用格式为 manualId#anchor',
      '',
      '知识库路径优先级：--kb、BLINK_KB 环境变量、当前目录下 docs/knowledge.json、docs/index.html，或唯一的 *knowledge*.zip。'
    ].join('\n') + '\n');
    return;
  }

  try {
    const knowledgePath = options.kb || defaultKnowledgePath();
    if (!knowledgePath) throw new Error('没有找到知识库。请使用 --kb 指定 ZIP/目录，或设置 BLINK_KB 环境变量。');
    const book = bookFromPath(knowledgePath);
    const records = flatten(book);
    const engine = createSearchEngine();
    const engineVersion = require('../public/knowledge-retrieval').createSdkSearch().version;
    let searchIndex = book.index?.compiled ? book.index : null;
    function ensureSearchIndex() { if (!searchIndex) searchIndex = engine.build(records); return searchIndex; }

    if (options.info) {
      const info = { schema: 1, title: book.title, model: book.model, sdkVersion: book.sdkVersion,
        generatedAt: book.generatedAt, manualCount: book.manuals.length, chapterCount: records.length,
        searchEngine: engineVersion, manuals: book.manuals.map(manual => ({
          id: manual.id, title: manual.title, version: manual.version, chapters: manual.entries.length,
          module: manual.module || manual.title, source: sourceFor(book, manual.id)
        })) };
      if (options.json) outputJson(info);
      else {
        process.stdout.write(book.title + '\n型号：' + book.model + ' · SDK：' + book.sdkVersion +
          '\n手册：' + book.manuals.length + ' · 章节：' + records.length + ' · 检索引擎：' + engineVersion + '\n');
      }
      return;
    }

    if (options.list) {
      const manuals = book.manuals.map(manual => ({ id: manual.id, title: manual.title,
        version: manual.version, chapters: manual.entries.length, module: manual.module || manual.title }));
      if (options.json) outputJson({ schema: 1, title: book.title, manuals });
      else manuals.forEach(manual => process.stdout.write(manual.title + ' [' + manual.id + '] · ' + manual.chapters + ' 章\n'));
      return;
    }

    if (options.get) {
      const split = options.get.indexOf('#');
      if (split < 1 || split === options.get.length - 1) throw new Error('--get 引用格式应为 manualId#章节锚点');
      const manualId = options.get.slice(0, split), anchor = options.get.slice(split + 1);
      const manual = book.manuals.find(item => item.id === manualId);
      if (!manual) throw new Error('找不到手册 ID：' + manualId);
      const entry = manual.entries.find(item => item.anchor === anchor);
      if (!entry) throw new Error('找不到章节锚点：' + anchor);
      const result = { schema: 1, id: manual.id + '#' + entry.anchor, title: entry.title,
        manual: manual.title, module: manual.module || manual.title, text: entry.text,
        sourcePath: entry.sourcePath || '', fingerprint: entry.fingerprint || '', source: sourceFor(book, manual.id) };
      if (options.json) outputJson(result);
      else process.stdout.write(result.title + '\n手册：' + result.manual + '\n来源：' + (result.source.repository || '未知') +
        ' / ' + (result.source.commit || '无提交记录') + '\n\n' + result.text + '\n');
      return;
    }

    const manual = options.manual ? resolveManual(book, options.manual) : null;
    const query = options.query.join(' ').trim();
    if (query.length > 500) throw new Error('搜索内容不能超过 500 个字符');
    const filters = { module: options.module || '', mode: options.mode || '' };
    const hits = engine.search(records, ensureSearchIndex(), query, manual?.id || '', options.limit, filters);
    const results = hits.map(hit => {
      const record = records[hit.position], source = sourceFor(book, record.manualId);
      return { id: record.manualId + '#' + record.anchor, title: record.title, manual: record.manualTitle,
        manualId: record.manualId, module: record.module, mode: record.mode, anchor: record.anchor,
        score: hit.score, reason: hit.reason, matchedTerms: hit.matchedTerms,
        sourcePath: record.sourcePath || '', fingerprint: record.fingerprint || '',
        excerpt: engine.excerpt(record.text, query), source };
    });
    if (options.json) outputJson({ schema: 1, query, knowledgeBase: { title: book.title, model: book.model, sdkVersion: book.sdkVersion },
      searchEngine: engineVersion, count: results.length, results });
    else if (!results.length) process.stdout.write('没有找到相关内容：' + query + '\n');
    else {
      process.stdout.write('知识库：' + book.title + '\n搜索：' + query + '\n找到 ' + results.length + ' 条相关内容\n\n');
      results.forEach((result, index) => {
        process.stdout.write('[' + (index + 1) + '] ' + result.title + '\n');
        process.stdout.write('    手册：' + result.manual + ' · 模块：' + result.module + '\n');
        process.stdout.write('    匹配：' + result.reason + ' · 相关度：' + result.score + '\n');
        process.stdout.write('    摘要：' + result.excerpt + '\n');
        process.stdout.write('    来源：' + (result.source.repository || '未知') + ' / ' + (result.source.commit || '无提交记录') + '\n');
        process.stdout.write('    读取：blink-cli --get "' + result.id + '"\n\n');
      });
    }
  } catch (error) {
    process.stderr.write('错误：' + error.message + '\n');
    process.exitCode = 1;
  }
}

main();

#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { bookFromPath, flatten, mergeBooks } = require('../lib/knowledge-book');
const semantic = require('../lib/knowledge-semantic');
const semanticData = require('../public/knowledge-semantic');
const { createSearchEngine } = require('../public/knowledge-search');

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
  const archives = fs.readdirSync(process.cwd()).filter(name => /knowledge.*\.zip$/i.test(name));
  return archives.length === 1 ? path.resolve(process.cwd(), archives[0]) : '';
}

function parseArgs(args) {
  const options = { query: [], json: false, limit: 10, merge: [] };
  const values = new Set(['--kb', '--limit', '--manual', '--module', '--mode', '--get', '--search', '--build-index']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--merge') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('--merge 缺少参数');
      options.merge.push(args[++i]);
      if (options.merge.length > 29) throw Error('最多合并 30 个知识库包');
    } else if (arg === '--json') options.json = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--info') options.info = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (values.has(arg)) {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error(arg + ' 缺少参数');
      options[arg.slice(2)] = args[++i];
    } else if (arg.startsWith('-')) throw new Error('未知参数：' + arg);
    else options.query.push(arg);
  }
  if (options.query.length > 1 && /^kb$/i.test(options.query[0])) options.query.shift();
  if (options.limit !== undefined) {
    options.limit = Number(options.limit);
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) throw new Error('--limit 必须是 1～50 的整数');
  }
  if (options.search && !['auto', 'lexical', 'hybrid', 'semantic'].includes(options.search)) throw Error('--search 须为 auto、lexical、hybrid 或 semantic');
  if ([options.list, options.info, Boolean(options.get), Boolean(options['build-index'])].filter(Boolean).length > 1) throw new Error('管理命令不能同时使用');
  if ((options.list || options.info || options.get || options['build-index']) && options.query.length) throw new Error('管理命令不能同时带搜索问题');
  if (!options.list && !options.info && !options.get && !options['build-index'] && !options.query.length && !options.help) throw new Error('请输入搜索内容，或使用 --list / --info');
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

function sourceFor(book, manualId) {
  const manual = book.manuals.find(item => item.id === manualId);
  return manual ? { repository: manual.source?.repository || '', commit: manual.source?.commit || null, dirty: manual.source?.dirty ?? null } : null;
}

function outputJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function shellQuote(value) {
  // POSIX shells and Windows PowerShell use single-quoted literal arguments.
  const quote = process.platform === 'win32' ? "''" : "'\\''";
  return "'" + value.replace(/'/g, quote) + "'";
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { process.stderr.write('错误：' + error.message + '\n'); process.exitCode = 2; return; }
  if (options.help) {
    process.stdout.write([
      'blink-cli — 离线 DITA 知识库检索',
      '',
      '用法：',
      '  blink-cli "搜索问题" [--json] [--limit 10]',
      '  blink-cli KB "搜索问题" [--json]',
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
      '  --search <方式>   auto（默认）、lexical、hybrid、semantic；后两项需要离线模型与语义索引',
      '  --build-index <文件.json>  为发布内容生成离线语义索引，写入新 JSON 文件',
      '  --merge <路径>    加入其它手册包，可重复指定；产品型号和 SDK 版本须一致',
      '',
      '知识库路径优先级：--kb、BLINK_KB 环境变量、当前目录下 docs/knowledge.json、docs/index.html，或唯一的 *knowledge*.zip。'
    ].join('\n') + '\n');
    return;
  }

  try {
    const selectedPath = options.kb || defaultKnowledgePath();
    if (!selectedPath) throw new Error('没有找到知识库。请使用 --kb 指定 ZIP/目录，或设置 BLINK_KB 环境变量。');
    const knowledgePath = path.resolve(selectedPath);
    const knowledgePaths = [knowledgePath, ...options.merge.map(name => path.resolve(name))];
    const books = knowledgePaths.map(bookFromPath);
    const outdated = books.some(value => value.semantic && !semanticData.compatible(value.semantic));
    const ignoreSemantic = !!options['build-index'] || options.search === 'lexical' || outdated;
    const book = books.length === 1 ? books[0] : mergeBooks(books, { ignoreSemantic });
    const knowledgeBase = { path: knowledgePath, paths: knowledgePaths, title: book.title, model: book.model, sdkVersion: book.sdkVersion };
    const records = flatten(book);
    if (options['build-index']) {
      const target = path.resolve(options['build-index']);
      if (!target.endsWith('.json')) throw Error('语义知识库请使用 .json 文件名');
      if (fs.existsSync(target)) throw Error('输出文件已存在，请使用新的文件名：' + target);
      const index = semanticData.compatible(book.semantic) ? book.semantic : await semantic.build(records, (done, total) => process.stderr.write('正在离线向量化 ' + done + '/' + total + '\n'));
      semanticData.validate(records, index);
      const output = { ...book, index: undefined, semantic: index,
        manuals: book.manuals.map(({ body: _body, toc: _toc, ...manual }) => manual) };
      fs.writeFileSync(target, JSON.stringify(output), { flag: 'wx' });
      if (options.json) outputJson({ schema: 1, path: target, model: book.model, profile: index.profile.id, chunks: index.chunks.length });
      else process.stdout.write('已生成离线语义知识库：' + target + '\n');
      return;
    }
    const engine = createSearchEngine();
    const engineVersion = require('../public/knowledge-retrieval').createSdkSearch().version;
    let searchIndex = book.index?.compiled ? book.index : null;
    function ensureSearchIndex() { if (!searchIndex) searchIndex = engine.build(records); return searchIndex; }

    if (options.info) {
      const info = { schema: 1, title: book.title, model: book.model, sdkVersion: book.sdkVersion,
        generatedAt: book.generatedAt, manualCount: book.manuals.length, chapterCount: records.length,
        searchEngine: engineVersion, semantic: book.semantic ? { profile: book.semantic.profile.id, chunks: book.semantic.chunks.length, compatible: semanticData.compatible(book.semantic) } : null, manuals: book.manuals.map(manual => ({
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
        sourcePath: entry.sourcePath || '', fingerprint: entry.fingerprint || '', source: sourceFor(book, manual.id), knowledgeBase };
      if (options.json) outputJson(result);
      else process.stdout.write(result.title + '\n手册：' + result.manual + '\n来源：' + (result.source.repository || '未知') +
        ' / ' + (result.source.commit || '无提交记录') + '\n\n' + result.text + '\n');
      return;
    }

    const manual = options.manual ? resolveManual(book, options.manual) : null;
    const query = options.query.join(' ').trim();
    if (query.length > 500) throw new Error('搜索内容不能超过 500 个字符');
    const filters = { module: options.module || '', mode: options.mode || '' };
    let searchMode = options.search || 'auto';
    if (searchMode === 'auto') searchMode = semanticData.compatible(book.semantic) ? 'hybrid' : 'lexical';
    const warnings = outdated && searchMode === 'lexical' ? ['语义索引版本已更新，当前使用关键词检索。请使用 --build-index 重新生成以启用新版语义检索。'] : [];
    if (searchMode !== 'lexical' && outdated) throw Error('语义索引编码配置已更新，请使用 --build-index 重新生成');
    const lexical = engine.search(records, ensureSearchIndex(), query, manual?.id || '', 50, filters);
    // Exact command names and error codes retain their existing hard constraints.
    const exactLookup = /^(?:at\+[a-z0-9_]+|[a-z_][a-z0-9_]*_[a-z0-9_]*|-?\d+)$/i.test(query) || /(?:错误|状态码|返回值|结果码|返回).*\d|\d.*(?:错误|状态码)/i.test(query);
    let hits = lexical.slice(0, options.limit);
    if (searchMode !== 'lexical' && !exactLookup) {
      if (!book.semantic) throw Error('此知识库尚无语义索引，请在工作台勾选离线语义索引后重新发布，或由发布人员使用 --build-index 生成');
      hits = await semantic.search(records, book.semantic, query, lexical, { ...filters, manualId: manual?.id || '', limit: options.limit, semanticOnly: searchMode === 'semantic' });
    }
    const results = hits.map(hit => {
      const record = records[hit.position], source = sourceFor(book, record.manualId);
      const entity = query.match(/\b(?:https?|ftp|mqtt|webui|gpio|pdp|apn|ssl|tls|tcp|udp|dns|ntp)\b/i)?.[0];
      const bodyMention = entity && record.text.toLowerCase().includes(entity.toLowerCase()) && ![record.title, record.manualTitle, record.module].join(' ').toLowerCase().includes(entity.toLowerCase());
      return { id: record.manualId + '#' + record.anchor, title: record.title, manual: record.manualTitle,
        manualId: record.manualId, module: record.module, mode: record.mode, anchor: record.anchor,
        score: hit.score, reason: hit.reason + (bodyMention ? ' · 正文提及 ' + entity : ''), matchedTerms: hit.matchedTerms,
        evidence: bodyMention ? 'body-mention' : 'chapter-match',
        sourcePath: record.sourcePath || '', fingerprint: record.fingerprint || '',
        excerpt: hit.excerpt || engine.excerpt(record.text, query), semanticScore: hit.semanticScore, source };
    });
    if (options.json) outputJson({ schema: 1, query, knowledgeBase,
      searchEngine: engineVersion, searchMode, warnings, count: results.length, results });
    else if (!results.length) {
      warnings.forEach(message => process.stderr.write(message + '\n'));
      process.stdout.write('没有找到相关内容：' + query + '\n');
    } else {
      warnings.forEach(message => process.stderr.write(message + '\n'));
      process.stdout.write('知识库：' + book.title + '\n搜索：' + query + '\n找到 ' + results.length + ' 条相关内容' + (searchMode === 'lexical' ? '' : ' · 离线混合检索，请结合原文核对') + '\n\n');
      if (results.every(result => result.evidence === 'body-mention')) process.stdout.write('当前命中来自正文提及，请读取原文核对是否包含完整使用步骤。\n\n');
      results.forEach((result, index) => {
        process.stdout.write('[' + (index + 1) + '] ' + result.title + '\n');
        process.stdout.write('    手册：' + result.manual + ' · 模块：' + result.module + '\n');
        process.stdout.write('    匹配：' + result.reason + ' · 相关度：' + result.score + '\n');
        process.stdout.write('    摘要：' + result.excerpt + '\n');
        process.stdout.write('    来源：' + (result.source.repository || '未知') + ' / ' + (result.source.commit || '无提交记录') + '\n');
        process.stdout.write('    读取：blink-cli --kb ' + shellQuote(knowledgePath) + options.merge.map(name => ' --merge ' + shellQuote(path.resolve(name))).join('') + ' --get ' + shellQuote(result.id) + '\n\n');
      });
    }
  } catch (error) {
    process.stderr.write('错误：' + error.message + '\n');
    process.exitCode = 1;
  }
}

main();


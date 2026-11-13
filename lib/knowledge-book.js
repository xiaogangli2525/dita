'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync, Unzip, UnzipInflate } = require('fflate');

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
  return parseBook(html.slice(start, jsonEnd(html, start)), '知识库 HTML');
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
  const candidates = ['docs/knowledge.json', 'knowledge.json', 'docs/index.html', 'index.html'];
  const files = new Map();
  try {
    let count = 0;
    // Read the directory without decompressing assets or independent manuals.
    unzipSync(bytes, { filter(file) {
      if (++count > 2000) throw new Error('知识库 ZIP 文件数量异常');
      if (candidates.includes(file.name)) {
        if (files.has(file.name)) throw new Error('知识库 ZIP 中存在重复数据文件：' + file.name);
        files.set(file.name, file);
      }
      return false;
    } });
    const selected = candidates.find(name => files.has(name));
    if (!selected) throw new Error('ZIP 中没有 docs/knowledge.json 或 docs/index.html');
    if (files.get(selected).originalSize > MAX_UNPACKED_BYTES) throw new Error('知识库数据解压后超过 128 MiB 安全读取上限');
    const chunks = [];
    let unpacked = 0, complete = false, started = false;
    const stream = new Unzip(file => {
      if (file.name !== selected) return;
      if (started) throw new Error('知识库 ZIP 中存在重复数据文件：' + selected);
      started = true;
      file.ondata = (error, chunk, final) => {
        if (error) throw error;
        unpacked += chunk.byteLength;
        if (unpacked > MAX_UNPACKED_BYTES) throw new Error('知识库数据解压后超过 128 MiB 安全读取上限');
        chunks.push(Buffer.from(chunk));
        complete = final;
      };
      file.start();
    });
    stream.register(UnzipInflate);
    // Bound each inflater input even when the ZIP's declared size is inaccurate.
    for (let offset = 0; offset < bytes.byteLength; offset += 1024) {
      stream.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.byteLength);
    }
    if (!complete) throw new Error('知识库 ZIP 数据不完整');
    const value = decode(Buffer.concat(chunks, unpacked));
    return selected.endsWith('.json') ? parseBook(value, selected) : bookFromHtml(value);
  } catch (error) {
    throw new Error('无法读取知识库 ZIP：' + error.message, { cause: error });
  }
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

function flatten(book) {
  return book.manuals.flatMap(manual => manual.entries.map(entry => ({
    ...entry, manualId: manual.id, manualTitle: manual.title, mode: manual.mode || 'other',
    module: manual.module || manual.title
  })));
}

function mergeBooks(books) {
  const base = books[0], manuals = [], identities = new Set(), vectorRows = [];
  const semanticData = require('../public/knowledge-semantic');
  const semanticCount = books.filter(book => book.semantic).length;
  if (semanticCount && semanticCount !== books.length) throw Error('合并时所有手册包须同时包含语义索引，请补齐后重试');
  for (const book of books) {
    if (book.model !== base.model || book.sdkVersion !== base.sdkVersion) throw Error('合并的产品型号和 SDK 版本须一致');
    for (const manual of book.manuals) {
      if (identities.has(manual.id)) throw Error('合并包存在重复手册，请移除旧包：' + manual.title);
      identities.add(manual.id); manuals.push(manual);
    }
    if (book.semantic) {
      const values = semanticData.validate(flatten(book), book.semantic), dimensions = semanticData.PROFILE.dimensions;
      for (let offset = 0; offset < values.length; offset += dimensions) vectorRows.push(Array.from(values.subarray(offset, offset + dimensions)));
    }
  }
  if (manuals.length > 30) throw Error('总知识库最多组合 30 份手册');
  const merged = { ...base, manuals, index: undefined, semantic: undefined };
  if (semanticCount) merged.semantic = semanticData.createIndex(semanticData.chunksFor(flatten(merged)), vectorRows);
  return merged;
}
module.exports = { bookFromPath, flatten, mergeBooks };

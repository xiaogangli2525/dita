'use strict';
const fs = require('fs/promises');
const path = require('path');
const iconv = require('iconv-lite');
const { randomUUID } = require('crypto');

function normalizeEncodingName(encoding) {
  const name = String(encoding || '').trim().toLowerCase();
  if (name === 'utf8' || name === 'utf-8') return 'utf-8';
  if (['gb2312', 'gbk', 'cp936'].includes(name)) return 'gb18030';
  return name || null;
}

function declaredEncoding(source) {
  const declaration = /^\uFEFF?<\?xml\s[\s\S]*?\?>/.exec(source)?.[0] || '';
  return /\sencoding\s*=\s*(["'])([^"']+)\1/i.exec(declaration)?.[2];
}

function decodeXmlBuffer(buffer) {
  let utf16;
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe || buffer[0] === 0x3c && buffer[1] === 0x00) {
      utf16 = 'utf-16le';
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff || buffer[0] === 0x00 && buffer[1] === 0x3c) {
      utf16 = 'utf-16be';
    }
  }
  if (utf16) {
    try { return new TextDecoder(utf16, { fatal: true, ignoreBOM: true }).decode(buffer); }
    catch (cause) { throw Object.assign(new Error('XML 文件包含无效的 ' + utf16 + ' 编码，请修复原文件后重试', { cause }), { status: 400 }); }
  }

  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8');
  const declared = declaredEncoding(head);
  const candidates = [...new Set([normalizeEncodingName(declared), 'utf-8', 'gb18030'].filter(Boolean))];

  for (const candidate of candidates) {
    try {
      // Fatal decoding already rejects malformed bytes. A literal U+FFFD in
      // valid UTF-8 is document content, not evidence for a legacy fallback.
      return new TextDecoder(candidate, { fatal: true, ignoreBOM: true }).decode(buffer);
    } catch {
      // Try the next supported encoding candidate.
    }
  }

  throw Object.assign(new Error('XML 文件无法无损解码，请检查原文件编码后重试'), { status: 400 });
}

async function readXmlFile(file) { return decodeXmlBuffer(await fs.readFile(file)); }

function encodeXmlFile(content) {
  // Decode legacy GBK-compatible input leniently, but never widen the declared
  // output encoding or silently replace unrepresentable characters with '?'.
  const encoding = declaredEncoding(content) || 'utf-8';
  if (!iconv.encodingExists(encoding)) {
    throw Object.assign(new Error('不支持的 XML 编码：' + encoding), { status: 400 });
  }
  const bytes = iconv.encode(content, encoding, { addBOM: false });
  if (iconv.decode(bytes, encoding, { stripBOM: false }) !== content || decodeXmlBuffer(bytes) !== content) {
    throw Object.assign(new Error('内容无法以 ' + encoding + ' 编码无损保存。请先将 XML 声明改为 UTF-8 后重试；原文件未修改。'), { status: 400 });
  }
  return bytes;
}

async function writeXmlFile(file, content, { createOnly = false } = {}) {
  await atomicWrite(file, encodeXmlFile(content), createOnly);
}

async function resolveWorkspacePath(root, relative, { create = false } = {}) {
  const actualRoot = await fs.realpath(root);
  const target = path.resolve(root, relative);
  const inside = value => value === actualRoot || value.startsWith(actualRoot + path.sep);
  let real;
  try { real = await fs.realpath(target); }
  catch (error) {
    if (!create || error.code !== 'ENOENT') throw error;
    // Broken links are never treated as new documents.
    if (await fs.lstat(target).catch(() => null)) throw Object.assign(new Error('Invalid symbolic link'), { status: 403 });
    real = path.join(await fs.realpath(path.dirname(target)), path.basename(target));
  }
  if (!inside(real)) throw Object.assign(new Error('Path escapes the configured DITA root'), { status: 403 });
  return real;
}

function createAtomicWriter(io = fs) {
  return async function atomicWrite(file, bytes, createOnly) {
    const temporary = path.join(path.dirname(file), '.dita-save-' + randomUUID());
    const mode = (await io.stat(file).catch(() => null))?.mode;
    let created = false, stage = '创建临时文件';
    try {
      const handle = await io.open(temporary, 'wx', mode == null ? 0o600 : mode & 0o777);
      created = true; stage = '写入临时文件';
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      stage = '提交目标文件';
      if (createOnly) {
        try { await io.link(temporary, file); }
        catch (error) { if (error.code === 'EEXIST') error.status = 409; throw error; }
      } else { await io.rename(temporary, file); created = false; }
    } catch (error) {
      if (['EPERM', 'EACCES', 'EROFS'].includes(error.code)) {
        throw Object.assign(new Error(`无法保存 ${file}：${stage}失败（${error.code}）。请检查仓库目录的写入权限、目标文件的只读属性，以及安全软件是否阻止 Node.js 写入。未改用非原子写入，请保留当前内容后重试。`, { cause: error }), { code: error.code, status: 403 });
      }
      throw error;
    } finally {
      if (created) try { await io.rm(temporary, { force: true }); }
      catch (error) { console.warn('临时保存文件清理失败：', temporary, error.code || error.message); }
    }
  };
}

const atomicWrite = createAtomicWriter();

module.exports = { atomicWrite, createAtomicWriter, readXmlFile, writeXmlFile, decodeXmlBuffer, encodeXmlFile, resolveWorkspacePath };

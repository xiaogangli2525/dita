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

function decodeXmlBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }

  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  const declared = /encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1];
  const candidates = [...new Set([normalizeEncodingName(declared), 'utf-8', 'gb18030'].filter(Boolean))];

  for (const candidate of candidates) {
    try {
      const text = new TextDecoder(candidate, { fatal: true }).decode(buffer);
      if (candidate === 'utf-8' && text.includes('\uFFFD')) continue;
      return text;
    } catch {
      // Try the next supported encoding candidate.
    }
  }

  return buffer.toString('utf-8');
}

async function readXmlFile(file) { return decodeXmlBuffer(await fs.readFile(file)); }

async function writeXmlFile(file, content, { createOnly = false } = {}) {
  const declared = /encoding\s*=\s*["']([^"']+)["']/i.exec(content)?.[1];
  const encoding = normalizeEncodingName(declared);
  if (encoding && encoding !== 'utf-8') {
    await atomicWrite(file, iconv.encode(content, encoding), createOnly);
  } else {
    await atomicWrite(file, Buffer.from(content, 'utf8'), createOnly);
  }
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

module.exports = { atomicWrite, createAtomicWriter, readXmlFile, writeXmlFile, decodeXmlBuffer, resolveWorkspacePath };

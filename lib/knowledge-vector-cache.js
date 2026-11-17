'use strict';
const fs = require('node:fs/promises'), { constants } = require('node:fs');
const path = require('node:path'), os = require('node:os'), { createHash, randomUUID } = require('node:crypto');
const data = require('../public/knowledge-semantic');
const CACHE_SCHEMA = 1, CACHE_RULES = 'manual-index-v2';
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const aborted = signal => { if (signal?.aborted) throw Object.assign(Error('已取消向量生成'), { name: 'AbortError' }); };
function cacheDirectory(env = process.env) {
  if (env.DITA_SEMANTIC_CACHE_DIR) return path.resolve(env.DITA_SEMANTIC_CACHE_DIR);
  const base = process.platform === 'win32' ? env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local') : env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'dita-lite', 'knowledge-vectors-v1');
}
function identity(records, model, profile, encoding) {
  if (!Array.isArray(records) || !records.length || records.length > 12000 || records.some(record => !record || typeof record.manualId !== 'string' || !record.manualId || typeof record.title !== 'string' || typeof record.text !== 'string')) throw Error('手册向量来源无效');
  const manualId = records[0].manualId;
  if (records.some(record => record.manualId !== manualId)) throw Error('每个缓存条目只能包含一份手册');
  // Release labels, timestamps, Git status and aliases do not enter the encoder.
  // Keep only fields that bind chunk text, location or the chosen model scope.
  const entries = records.map(record => [record.manualId, record.manualTitle || '', record.title, record.anchor || '', record.sourcePath || '', record.text,
    record.structure ? [record.structure.schema, record.structure.source, record.structure.units?.map(unit => [unit.id, unit.kind, unit.section, unit.context, unit.text, unit.notes?.map(note => [note.id, note.text]), unit.sourceAnchor, unit.fingerprint])] : null]);
  return digest([CACHE_SCHEMA, CACHE_RULES, encoding, profile, String(model || ''), entries]);
}
function createVectorCache({ directory = cacheDirectory(), encoding = '', maxBytes = 256 * 1024 * 1024, maxEntries = 64, maxEntryBytes = 64 * 1024 * 1024, logger = console } = {}) {
  const fileFor = key => { if (!/^[a-f0-9]{64}$/.test(key)) throw Error('缓存标识无效'); return path.join(directory, 'manual-' + key + '.json'); };
  function warning(action, cause) { logger.warn('手册向量缓存' + action, cause.code || cause.name); return '本机向量缓存' + action + '，本次仍可生成交付文件。'; }
  async function get(records, model, profile) {
    const key = identity(records, model, profile, encoding), file = fileFor(key); let handle;
    try {
      const before = await fs.lstat(file); if (!before.isFile() || before.isSymbolicLink() || before.size > maxEntryBytes) throw Error('invalid cache file');
      // Windows requires a writable handle for futimes. Keep readable caches
      // usable when an administrator deliberately marks them read-only.
      const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW || 0;
      try { handle = await fs.open(file, (process.platform === 'win32' ? constants.O_RDWR : constants.O_RDONLY) | noFollow); }
      catch (cause) {
        if (process.platform !== 'win32' || !['EACCES', 'EPERM', 'EROFS'].includes(cause.code)) throw cause;
        handle = await fs.open(file, constants.O_RDONLY);
      }
      const stat = await handle.stat(); if (!stat.isFile() || stat.size > maxEntryBytes || stat.dev !== before.dev || stat.ino !== before.ino) throw Error('cache changed during open');
      const bytes = Buffer.alloc(stat.size + 1); let length = 0;
      while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, null); if (!read.bytesRead) break; length += read.bytesRead; }
      if (length > stat.size) throw Error('cache changed during read');
      const value = JSON.parse(bytes.subarray(0, length).toString('utf8'));
      if (value.schema !== CACHE_SCHEMA || value.key !== key || value.checksum !== digest(value.index) || value.index?.profile.id !== profile.id) throw Error('cache checksum mismatch');
      data.validate(records, value.index);
      const now = new Date();
      try { await handle.utimes(now, now); } catch (cause) { warning('访问时间未能更新', cause); }
      return { key, index: value.index, warnings: [] };
    } catch (cause) {
      if (cause.code === 'ENOENT') return { key, index: null, warnings: [] };
      return { key, index: null, warnings: [warning('不可用，已改为重新生成', cause)] };
    } finally { if (handle) { try { await handle.close(); } catch (cause) { warning('读取句柄关闭失败', cause); } } }
  }
  async function prune(protectedFile) {
    const files = [];
    for (const name of await fs.readdir(directory)) {
      if (!/^manual-[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(directory, name);
      try { const stat = await fs.lstat(file); if (stat.isFile() && !stat.isSymbolicLink()) files.push({ file, size: stat.size, time: stat.mtimeMs }); }
      catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
    }
    files.sort((a, b) => a.time - b.time || a.file.localeCompare(b.file));
    let size = files.reduce((sum, item) => sum + item.size, 0), count = files.length;
    for (const item of files) {
      if (size <= maxBytes && count <= maxEntries) break;
      if (item.file === protectedFile) continue;
      await fs.rm(item.file, { force: true }); size -= item.size; count--;
    }
  }
  async function put(records, model, profile, index, { signal } = {}) {
    data.validate(records, index);
    if (index.profile.id !== profile.id) throw Error('缓存编码配置不一致');
    const key = identity(records, model, profile, encoding), target = fileFor(key), temporary = path.join(directory, '.manual-' + key + '-' + randomUUID() + '.tmp');
    const value = JSON.stringify({ schema: CACHE_SCHEMA, key, checksum: digest(index), index });
    if (Buffer.byteLength(value) > Math.min(maxEntryBytes, maxBytes)) return { key, warnings: ['这份手册的向量超过本机缓存容量，本次交付文件仍正常生成。'] };
    let created = false;
    try {
      aborted(signal); await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const handle = await fs.open(temporary, 'wx', 0o600); created = true;
      try { await handle.writeFile(value); } finally { await handle.close(); }
      aborted(signal);
      await fs.rename(temporary, target); created = false; await prune(target);
      return { key, warnings: [] };
    } catch (cause) {
      if (cause.name === 'AbortError') throw cause;
      return { key, warnings: [warning('未能保存', cause)] };
    } finally {
      if (created) { try { await fs.rm(temporary, { force: true }); } catch (cause) { warning('临时文件清理失败', cause); } }
    }
  }
  return { directory, get, put, key: (records, model, profile) => identity(records, model, profile, encoding) };
}
module.exports = { CACHE_SCHEMA, CACHE_RULES, cacheDirectory, createVectorCache, aborted };

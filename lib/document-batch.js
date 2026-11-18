'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createAtomicWriter, decodeXmlBuffer, encodeXmlFile, resolveWorkspacePath } = require('./document-files');

const MAX_FILES = 512;
const MAX_BYTES = 40 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');
const failure = (message, status = 409) => Object.assign(Error(message), { status });
const conflict = name => failure(name + ' 已在磁盘上变化，请保留编辑内容并重新打开比较。');
const identity = /^[a-f0-9-]{36}$/;
const hash = /^[a-f0-9]{64}$/;
const isDocument = name => typeof name === 'string' && name.length <= 4096 &&
  /\.(dita|ditamap|xml)$/i.test(name) && !name.includes('\0');
const isRelative = name => isDocument(name) && !name.split('/').some(part => !part ||
  part === '.' || part === '..' || part.toLowerCase() === '.git') && !name.includes('\\') && !path.isAbsolute(name);

function journalDirectory(env = process.env) {
  const windows = process.platform === 'win32';
  return env.DITA_SAVE_JOURNAL_DIR || path.join(windows ?
    env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local') :
    env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), windows ? 'DITA Lite' : 'dita-lite', 'map-saves');
}

// The caller serializes workspace writes. A private journal survives a process
// restart; staged and backup files live beside each target for same-volume rename.
function createDocumentBatch({ io = fs, directory = journalDirectory() } = {}) {
  const writeJournal = createAtomicWriter(io);
  const recovering = new Map();
  const active = new Set();
  const journalPath = root => path.join(directory, digest(root) + '.json');
  const absent = error => { if (error.code === 'ENOENT') return null; throw error; };
  const stat = file => io.lstat(file).catch(absent);

  function paths(root, plan, entry, index) {
    const target = path.join(root, entry.name);
    const stem = path.join(path.dirname(target), '.dita-batch-' + plan.id + '-' + index);
    return { target, next: stem + '.next', backup: stem + '.previous' };
  }

  async function checkParent(file) {
    const parent = path.dirname(file);
    if (await io.realpath(parent) !== parent) throw failure('批量保存期间目标目录已变化。');
  }

  async function readTarget(root, entry) {
    const target = path.join(root, entry.name);
    const actual = await io.realpath(target).catch(absent);
    const info = actual === target ? await stat(target) : null;
    if (!info?.isFile()) throw conflict(entry.name);
    if (info.size > MAX_BYTES) throw failure(entry.name + ' 超过批量保存的文件大小上限。', 413);
    return { info, bytes: await io.readFile(target) };
  }

  async function stage(file, bytes, mode) {
    await checkParent(file);
    const handle = await io.open(file, 'wx', mode & 0o777);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
  }

  async function cleanup(root, plan) {
    for (const [index, entry] of plan.entries.entries()) {
      const { next, backup } = paths(root, plan, entry, index);
      await checkParent(backup);
      await io.rm(backup, { force: true });
      await io.rm(next, { force: true });
    }
    await io.rm(journalPath(root), { force: true });
  }

  async function rollback(root, plan) {
    const blocked = [];
    for (const [index, entry] of plan.entries.entries()) {
      const { target, next, backup } = paths(root, plan, entry, index);
      try {
        // A consumed staging file identifies a replacement. Compare the live
        // bytes before restoring so an outside edit never gets rolled back.
        await checkParent(next);
        if (await stat(next)) continue;
        const { bytes } = await readTarget(root, entry);
        const current = digest(bytes);
        if (current === entry.before) continue;
        if (current !== entry.after || !(await stat(backup))?.isFile() ||
            digest(await io.readFile(backup)) !== entry.before) throw conflict(entry.name);
        await io.rename(backup, target);
      } catch { blocked.push(entry.name); }
    }
    if (blocked.length) throw failure('批量保存恢复未完成，原始备份已保留。请检查这些文件的权限、占用或外部修改后刷新工作区：' + blocked.join('、'));
  }

  async function persist(root, plan, exclusive = false) {
    await writeJournal(journalPath(root), Buffer.from(JSON.stringify(plan)), exclusive);
  }

  async function recoverRoot(root) {
    const file = journalPath(root), info = await stat(file);
    if (!info) return;
    let plan;
    try {
      if (!info.isFile() || info.size > 4 * 1024 * 1024) throw Error('invalid journal');
      plan = JSON.parse(await io.readFile(file, 'utf8'));
      if (plan.root !== root || !identity.test(plan.id) || !['staging', 'prepared', 'committed', 'rolledBack'].includes(plan.phase) ||
          !Number.isSafeInteger(plan.pid) || plan.pid < 1 || typeof plan.host !== 'string' ||
          !Array.isArray(plan.entries) || plan.entries.length > MAX_FILES ||
          plan.entries.some(entry => !isRelative(entry.name) || !hash.test(entry.before) || !hash.test(entry.after))) throw Error('invalid journal');
    } catch (cause) {
      throw Object.assign(failure('无法读取批量保存恢复记录，原始备份已保留。'), { cause });
    }
    if (plan.host !== os.hostname()) throw failure('批量保存记录属于另一台计算机，请在原计算机恢复。');
    if (active.has(root) || plan.pid !== process.pid && processExists(plan.pid)) throw failure('此仓库已有另一个工作台操作在保存。');
    if (plan.phase === 'prepared') await restore(root, plan);
    await cleanup(root, plan);
  }

  function processExists(pid) {
    try { return process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  }

  async function restore(root, plan) {
    await rollback(root, plan);
    await persist(root, { ...plan, phase: 'rolledBack' });
  }

  async function recover(root) {
    const canonical = await io.realpath(root).catch(absent);
    if (!canonical) return;
    let pending = recovering.get(canonical);
    if (!pending) {
      pending = recoverRoot(canonical).finally(() => recovering.delete(canonical));
      recovering.set(canonical, pending);
    }
    await pending;
  }

  async function save(root, requests, { validate = () => {} } = {}) {
    root = await io.realpath(root);
    await recover(root);
    const plan = { root, id: randomUUID(), phase: 'staging', pid: process.pid, host: os.hostname(), entries: [] };
    const seen = new Set(), files = [];
    const results = [];
    let firstError;
    let size = 0;
    for (const request of requests) {
      try {
        validate(request.content);
        const target = await resolveWorkspacePath(root, request.path);
        const name = path.relative(root, target).split(path.sep).join('/');
        if (!isRelative(name)) throw failure('不是可批量保存的 DITA/XML 文件：' + request.path, 400);
        if (seen.has(target)) throw failure('批量保存包含重复文件：' + name, 400);
        seen.add(target);
        const { info, bytes } = await readTarget(root, { name });
        size += bytes.length;
        if (size > MAX_BYTES) throw failure('本批原始内容和修改共超过 40 MiB，请缩小保存范围。', 413);
        if (decodeXmlBuffer(bytes) !== request.expectedContent) throw conflict(name);
        const next = encodeXmlFile(request.content);
        size += next.length;
        if (size > MAX_BYTES) throw failure('本批原始内容和修改共超过 40 MiB，请缩小保存范围。', 413);
        if (!bytes.equals(next)) {
          plan.entries.push({ name, before: digest(bytes), after: digest(next) });
          files.push({ bytes, next, mode: info.mode });
        }
        results.push({ path: request.path, status: 'notWritten' });
      } catch (cause) {
        if (cause.status === 413 && size > MAX_BYTES) throw cause;
        const message = cause.status ? cause.message : cause.code ? '无法读取文件（' + cause.code + '）' : '无法完成文件检查';
        firstError ||= failure(message.startsWith(request.path) ? message : request.path + '：' + message,
          cause.status || (cause.code === 'ENOENT' ? 404 : 500));
        results.push({ path: request.path, status: cause.status === 409 ? 'conflict' : 'failed', message });
      }
    }
    if (firstError) throw Object.assign(firstError, { files: results });
    if (!files.length) return;

    await io.mkdir(directory, { recursive: true, mode: 0o700 });
    await persist(root, plan, true);
    active.add(root);
    try {
      for (const [index, entry] of plan.entries.entries()) {
        const { next, backup } = paths(root, plan, entry, index), file = files[index];
        await stage(next, file.next, file.mode);
        await stage(backup, file.bytes, file.mode);
      }
      await persist(root, { ...plan, phase: 'prepared' });
      plan.phase = 'prepared';
      for (const [index, entry] of plan.entries.entries()) {
        if (digest((await readTarget(root, entry)).bytes) !== entry.before) throw conflict(entry.name);
        const { next, target } = paths(root, plan, entry, index);
        try { await io.rename(next, target); }
        catch (cause) { throw Object.assign(failure('无法写入 ' + entry.name + '（' + (cause.code || '写入失败') + '）。', 500), { cause }); }
      }
      await persist(root, { ...plan, phase: 'committed' });
    } catch (error) {
      try {
        if (plan.phase === 'prepared') await restore(root, plan);
        await cleanup(root, plan);
      } finally { active.delete(root); }
      throw error;
    }
    // The commit decision is durable across process restarts. Cleanup failure
    // must not turn a successful write into a failed acknowledgement.
    try { await cleanup(root, plan); }
    catch (error) { console.warn('批量保存临时文件待清理：', error.code || error.message); }
    finally { active.delete(root); }
  }

  return { save, recover };
}

module.exports = { createDocumentBatch, journalDirectory, isDocument, MAX_FILES, MAX_BYTES };

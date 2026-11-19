'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { validateXml } = require('../public/xml-source');
const { safeError } = require('./remote-repositories');
const fail = (message, status = 400) => Object.assign(Error(message), { status });
const oid = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const split = value => value.split('\0').filter(Boolean);
const isDocument = value => typeof value === 'string' && value.length <= 500 && /\.(dita|ditamap|ditaval|xml)$/i.test(value) &&
  !/[\\\0\r\n]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const changeKind = status => status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified';

async function editIndex(index, copy, edit) {
  const lockPath = index + '.lock';
  let lock = await fs.open(lockPath, 'wx', (await fs.stat(index)).mode & 0o777);
  async function closeLock() {
    const handle = lock;
    lock = null;
    await handle?.close();
  }
  let paths, operationError, operationFailed = false;
  try {
    await fs.copyFile(index, copy);
    paths = await edit({ GIT_INDEX_FILE: copy });
    if (paths.length) {
      await lock.writeFile(await fs.readFile(copy));
      await lock.sync();
      await closeLock();
      await fs.rename(lockPath, index);
      // The rename released our lock. Another Git process can now create its own.
      return paths;
    }
  } catch (error) {
    operationError = error;
    operationFailed = true;
  }
  let cleanupError;
  try { await closeLock(); } catch (error) { cleanupError = error; }
  try { await fs.rm(lockPath, { force: true }); } catch (error) { cleanupError ??= error; }
  if (operationFailed) {
    if (cleanupError) console.warn('Git 索引锁清理失败', cleanupError.code || cleanupError.name);
    throw operationError;
  }
  if (cleanupError) throw cleanupError;
  return paths;
}

function createCommitService({ getRoot, runGit, checkedResolve, readXmlFile }) {
  const git = (args, cwd = getRoot(), options = {}) => runGit(['--literal-pathspecs', ...args], { cwd, ...options });
  async function baseline(cwd) {
    const top = (await git(['rev-parse', '--show-toplevel'], cwd)).trim();
    if (await fs.realpath(top) !== await fs.realpath(cwd)) throw fail('请先选择 Git 仓库根目录');
    const branch = (await git(['branch', '--show-current'], cwd)).trim();
    if (!branch) throw fail('请先切换到本地分支', 409);
    const head = (await git(['rev-parse', '--verify', 'HEAD'], cwd)).trim();
    return { head, branch };
  }
  async function changed(cwd, head) {
    const [diff, cached, untracked] = await Promise.all([
      git(['diff', '--no-renames', '--name-status', '-z', head], cwd),
      git(['diff', '--cached', '--ita-invisible-in-index', '--no-renames', '--name-only', '-z', head], cwd),
      git(['ls-files', '--others', '--exclude-standard', '-z'], cwd)
    ]);
    const paths = new Map(), entries = split(diff);
    for (let at = 0; at < entries.length; at += 2) {
      if (isDocument(entries[at + 1])) paths.set(entries[at + 1], changeKind(entries[at]));
    }
    for (const name of split(untracked).filter(isDocument)) paths.set(name, 'added');
    return { paths, staged: new Set(split(cached)) };
  }
  async function fileVersion(name, kind, cwd, head) {
    const file = path.resolve(cwd, name);
    const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (kind === 'deleted') {
      const entry = await git(['ls-tree', '-z', head, '--', name], cwd);
      if (stat || !/^100(?:644|755) blob /.test(entry)) throw fail('无法核对已删除的普通文档：' + name, 409);
      return { path: name, kind };
    }
    if (!stat?.isFile()) throw fail('请选择普通文档文件：' + name, 409);
    const resolved = await checkedResolve(name);
    return { path: name, kind, oid: (await git(['hash-object', '--path=' + name, '--', resolved], cwd)).trim() };
  }
  async function plan() {
    const cwd = getRoot(), { head, branch } = await baseline(cwd);
    const { paths, staged } = await changed(cwd, head);
    if (paths.size > 100) throw fail('变更文档超过 100 个，请用外部 Git 工具选择范围');
    const files = [];
    for (const [name, kind] of paths) {
      if (staged.has(name)) { files.push({ path: name, kind, reason: '已有暂存内容' }); continue; }
      try { files.push(await fileVersion(name, kind, cwd, head)); }
      catch (error) {
        if (error.code !== 'ENOENT' && ![403, 404, 409].includes(error.status)) throw error;
        files.push({ path: name, kind, reason: '无法核对磁盘文件' });
      }
    }
    return { head, branch, files };
  }
  async function markNewPaths(added, cwd, index, copy) {
    if (!added.length) return [];
    return editIndex(index, copy, async env => {
      const tracked = new Set(split(await git(['ls-files', '--cached', '-z', '--', ...added], cwd, { env })));
      const pending = added.filter(name => !tracked.has(name));
      if (pending.length) await git(['add', '--intent-to-add', '--', ...pending], cwd, { env });
      return pending;
    });
  }
  async function clearNewPaths(added, cwd, index, copy) {
    if (!added.length) return;
    await editIndex(index, copy, async env => {
      const names = option => git(['diff', '--cached', option, '--no-renames', '--name-only', '-z', 'HEAD', '--', ...added], cwd, { env }).then(split);
      const staged = new Set(await names('--ita-invisible-in-index'));
      const intents = (await names('--ita-visible-in-index')).filter(name => !staged.has(name));
      if (intents.length) await git(['reset', '-q', 'HEAD', '--', ...intents], cwd, { env });
      return intents;
    });
  }
  async function commit({ head, branch, files, message } = {}) {
    if (!oid(head) || typeof branch !== 'string' || typeof message !== 'string' || !message.trim() || message.length > 2000 || message.includes('\0') ||
        !Array.isArray(files) || !files.length || files.length > 100 ||
        files.some(file => !isDocument(file?.path) ||
          (file.kind === 'deleted' ? file.oid !== undefined : ![undefined, 'added', 'modified'].includes(file.kind) || !oid(file.oid))) ||
        new Set(files.map(file => file.path)).size !== files.length) throw fail('请核对文档范围并填写提交说明');
    files = files.map(file => ({ path: file.path, kind: file.kind ?? 'modified', ...(file.oid ? { oid: file.oid } : {}) }));
    const cwd = getRoot(), current = await baseline(cwd);
    if (current.branch !== branch || current.head !== head) throw fail('分支或基线已变化，请重新核对', 409);
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
      const file = (await git(['rev-parse', '--git-path', marker], cwd)).trim();
      if (await fs.lstat(path.resolve(cwd, file)).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw fail('请在 Git 工具中完成当前合并、变基或拣选', 409);
    }
    const { paths, staged } = await changed(cwd, head);
    for (const file of files) {
      if (paths.get(file.path) !== file.kind || staged.has(file.path) ||
          (await fileVersion(file.path, file.kind, cwd, head)).oid !== file.oid) throw fail('磁盘或暂存状态已变化：' + file.path, 409);
      if (file.kind !== 'deleted') validateXml(await readXmlFile(await checkedResolve(file.path)));
    }
    const index = path.resolve(cwd, (await git(['rev-parse', '--git-path', 'index'], cwd)).trim());
    const hooks = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-commit-'));
    const copy = path.join(hooks, 'index-copy');
    let marked = [], committed = false;
    try {
      const planPath = path.join(hooks, 'plan.json');
      await fs.writeFile(planPath, JSON.stringify({ head, branch, files, index }), { mode: 0o600 });
      await fs.writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexec "$DITA_COMMIT_NODE" "$DITA_COMMIT_GUARD"\n', { mode: 0o700 });
      marked = await markNewPaths(files.filter(file => file.kind === 'added').map(file => file.path), cwd, index, copy);
      await git(['-c', 'core.hooksPath=' + hooks, 'commit', '--only', '-m', message.trim(), '--', ...files.map(file => file.path)], cwd, {
        errorStatus: 409, env: { GIT_TERMINAL_PROMPT: '0', DITA_COMMIT_NODE: process.execPath,
          DITA_COMMIT_GUARD: require.resolve('./git-commit-guard'), DITA_COMMIT_PLAN: planPath }
      });
      committed = true;
      return { branch, head: (await git(['rev-parse', 'HEAD'], cwd)).trim(), files: files.map(file => file.path) };
    } catch (error) {
      if (!committed) try { await clearNewPaths(marked, cwd, index, copy); }
      catch {
        throw fail(safeError(error) + '。部分新文件仍处于待添加状态，请重新核对。', error.status || 409);
      }
      if (error.code === 'EEXIST') throw fail('Git 索引正被使用，请稍后重新核对提交范围。', 409);
      throw fail(safeError(error), error.status || 500);
    }
    finally { await fs.rm(hooks, { recursive: true, force: true }).catch(error => console.warn('Git 核对临时目录清理失败', error.code)); }
  }
  return { plan, commit };
}
module.exports = { createCommitService };

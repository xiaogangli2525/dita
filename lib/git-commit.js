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
    const [paths, cached] = await Promise.all([
      git(['diff', '--no-renames', '--name-only', '-z', head], cwd),
      git(['diff', '--cached', '--no-renames', '--name-only', '-z', head], cwd)
    ]);
    return { paths: split(paths).filter(isDocument), staged: new Set(split(cached)) };
  }
  async function fileVersion(name, cwd) {
    const file = await checkedResolve(name);
    if (!(await fs.lstat(file)).isFile()) throw fail('请选择普通文档文件：' + name);
    return { path: name, oid: (await git(['hash-object', '--path=' + name, '--', file], cwd)).trim() };
  }
  async function plan() {
    const cwd = getRoot(), { head, branch } = await baseline(cwd);
    const { paths, staged } = await changed(cwd, head);
    if (paths.length > 100) throw fail('变更文档超过 100 个，请用外部 Git 工具选择范围');
    const files = [];
    for (const name of paths) {
      if (staged.has(name)) { files.push({ path: name, reason: '已有暂存内容' }); continue; }
      try { files.push(await fileVersion(name, cwd)); }
      catch (error) { if (error.code !== 'ENOENT' && error.status !== 404) throw error; files.push({ path: name, reason: '磁盘文件已删除' }); }
    }
    return { head, branch, files };
  }
  async function commit({ head, branch, files, message } = {}) {
    if (!oid(head) || typeof branch !== 'string' || typeof message !== 'string' || !message.trim() || message.length > 2000 || message.includes('\0') ||
        !Array.isArray(files) || !files.length || files.length > 100 ||
        files.some(file => !isDocument(file?.path) || !oid(file.oid)) || new Set(files.map(file => file.path)).size !== files.length) throw fail('请核对文档范围并填写提交说明');
    const cwd = getRoot(), current = await baseline(cwd);
    if (current.branch !== branch || current.head !== head) throw fail('分支或基线已变化，请重新核对', 409);
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
      const file = (await git(['rev-parse', '--git-path', marker], cwd)).trim();
      if (await fs.lstat(path.resolve(cwd, file)).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw fail('请在 Git 工具中完成当前合并、变基或拣选', 409);
    }
    const { paths, staged } = await changed(cwd, head);
    for (const file of files) {
      if (!paths.includes(file.path) || staged.has(file.path) || (await fileVersion(file.path, cwd)).oid !== file.oid) throw fail('磁盘或暂存状态已变化：' + file.path, 409);
      validateXml(await readXmlFile(await checkedResolve(file.path)));
    }
    const hooks = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-commit-'));
    try {
      const planPath = path.join(hooks, 'plan.json');
      const index = path.resolve(cwd, (await git(['rev-parse', '--git-path', 'index'], cwd)).trim());
      await fs.writeFile(planPath, JSON.stringify({ head, branch, files, index }), { mode: 0o600 });
      await fs.writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexec "$DITA_COMMIT_NODE" "$DITA_COMMIT_GUARD"\n', { mode: 0o700 });
      await git(['-c', 'core.hooksPath=' + hooks, 'commit', '--only', '-m', message.trim(), '--', ...files.map(file => file.path)], cwd, {
        errorStatus: 409, env: { GIT_TERMINAL_PROMPT: '0', DITA_COMMIT_NODE: process.execPath,
          DITA_COMMIT_GUARD: require.resolve('./git-commit-guard'), DITA_COMMIT_PLAN: planPath }
      });
      return { branch, head: (await git(['rev-parse', 'HEAD'], cwd)).trim(), files: files.map(file => file.path) };
    } catch (error) { throw fail(safeError(error), error.status || 500); }
    finally { await fs.rm(hooks, { recursive: true, force: true }).catch(error => console.warn('Git 核对临时目录清理失败', error.code)); }
  }
  return { plan, commit };
}
module.exports = { createCommitService };

'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function validateRemote(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\\]/.test(value)) throw fail('请输入有效的 HTTPS 或 SSH Git 地址');
  if (/^[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9][A-Za-z0-9.-]*:[A-Za-z0-9_./%~-]+$/.test(value)) return value;
  let url; try { url = new URL(value); } catch { throw fail('仅支持 HTTPS 和 SSH Git 地址'); }
  if (!['https:', 'ssh:'].includes(url.protocol) || !url.hostname || url.hostname.startsWith('-') || url.password || url.search || url.hash || url.protocol === 'https:' && url.username || !url.pathname || url.pathname === '/') throw fail('仅支持不含密码、Token、查询参数的 HTTPS 或 SSH 仓库地址');
  if (url.protocol === 'ssh:' && url.username && !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(url.username)) throw fail('SSH 用户名无效');
  let pathname; try { pathname = decodeURIComponent(url.pathname); } catch { throw fail('仓库地址编码无效'); }
  if (/[\s\x00-\x1f\\]/.test(pathname)) throw fail('仓库地址路径无效');
  return value;
}
function validateName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) || value.includes('..') || /\.$|\.lock$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw fail('本地名称须为 1–64 位字母、数字、短横线或下划线');
  return value;
}
function safeError(error) {
  return String(error.message || error).replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@').replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]').replace(/(Authorization\s*:\s*(?:Bearer|Basic)\s+)\S+/gi, '$1[redacted]').replace(/((?:password|access_token|token)\s*[:=]\s*)\S+/gi, '$1[redacted]');
}
// Transport injection is for local bare-repository tests, never HTTP input.
function createRemoteRepositories({ getRoot, repositoriesRoot, runGit, transport = value => value }) {
  async function branch(value, optional = false) {
    if (optional && !value) return '';
    if (typeof value !== 'string' || value.length > 200 || value.startsWith('-') || /[\s\x00-\x1f]/.test(value)) throw fail('分支名称无效');
    try { await runGit(['check-ref-format', '--branch', value], { cwd: await fs.realpath(repositoriesRoot) }); } catch { throw fail('分支名称无效'); }
    return value;
  }
  async function command(args, cwd, network = false) {
    const hooks = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-empty-hooks-'));
    try {
      return await runGit(['-c', 'core.hooksPath=' + hooks, '-c', 'submodule.recurse=false', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.ssh.allow=always', ...args], {
        cwd, timeoutMs: network ? 120000 : 30000, processGroup: true, maxOutputBytes: 2 * 1024 * 1024,
        env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1', ...(!process.env.GIT_SSH_COMMAND ? { GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oStrictHostKeyChecking=yes -oConnectTimeout=15' } : {}) }
      });
    } catch (error) { throw fail(safeError(error) + (network ? '\n请检查网络及运行服务机器的 Git 凭据／SSH 主机信任配置。' : ''), network ? 502 : error.status || 500); }
    finally { await fs.rm(hooks, { recursive: true, force: true }); }
  }
  async function listBranches(url) {
    url = validateRemote(url); await fs.mkdir(repositoriesRoot, { recursive: true });
    const output = await command(['ls-remote', '--symref', '--', transport(url), 'HEAD', 'refs/heads/*'], await fs.realpath(repositoriesRoot), true);
    const names = new Set(); let defaultBranch = '';
    for (const line of output.split(/\r?\n/)) {
      const symbolic = /^ref: refs\/heads\/(.+)\tHEAD$/.exec(line); if (symbolic) defaultBranch = symbolic[1];
      const ref = /^[a-f0-9]{40,64}\trefs\/heads\/(.+)$/.exec(line); if (ref) names.add(ref[1]);
    }
    if (names.size > 500) throw fail('远程分支超过 500 个，请精简仓库分支后重试');
    return { branches: [...names].sort(), defaultBranch };
  }
  async function clone({ url, name, branch: requested = '' }) {
    url = validateRemote(url); name = validateName(name); await fs.mkdir(repositoriesRoot, { recursive: true }); requested = await branch(requested, true);
    const root = await fs.realpath(repositoriesRoot), target = path.join(root, name);
    if (await fs.lstat(target).catch(() => null)) throw fail('本地名称已存在，请换一个名称', 409);
    const temporary = await fs.mkdtemp(path.join(root, '.dita-import-'));
    try {
      await command(['clone', '--no-recurse-submodules', '--single-branch', '--no-tags', ...(requested ? ['--branch', requested] : []), '--', transport(url), temporary], root, true);
      await command(['remote', 'set-url', 'origin', url], temporary); await current(temporary);
      if (await fs.lstat(target).catch(() => null)) throw fail('本地名称已存在，请换一个名称', 409);
      await fs.rename(temporary, target); return { path: target, name, url };
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }
  async function current(cwd = getRoot()) {
    cwd = await fs.realpath(cwd);
    const top = (await command(['rev-parse', '--show-toplevel'], cwd)).trim();
    if (await fs.realpath(top) !== cwd) throw fail('请先选择 Git 仓库根目录');
    let url = '', name = '';
    try { url = (await command(['remote', 'get-url', 'origin'], cwd)).trim(); name = (await command(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd)).trim(); }
    catch { throw fail('此仓库没有 origin 或处于游离 HEAD 状态，暂不能远程更新'); }
    validateRemote(url); await branch(name);
    const merge = (await command(['config', '--get', 'branch.' + name + '.merge'], cwd).catch(() => '')).trim();
    const remote = (await command(['config', '--get', 'branch.' + name + '.remote'], cwd).catch(() => '')).trim();
    if (remote !== 'origin' || !merge.startsWith('refs/heads/')) throw fail('当前分支没有跟踪 origin 分支，请先在 Git 中配置上游');
    const upstreamBranch = await branch(merge.slice(11)), head = (await command(['rev-parse', '--verify', 'HEAD'], cwd)).trim();
    const changes = (await command(['status', '--porcelain', '--untracked-files=normal'], cwd)).trim();
    return { cwd, url, branch: name, upstreamBranch, head, dirty: Boolean(changes), changes: changes ? changes.split(/\r?\n/) : [] };
  }
  async function info() { try { return { available: true, ...(await current()) }; } catch (error) { return { available: false, message: safeError(error) }; } }
  async function check() {
    const before = await current(), ref = 'refs/remotes/origin/' + before.upstreamBranch;
    await command(['fetch', '--no-tags', '--no-recurse-submodules', '--', transport(before.url), '+refs/heads/' + before.upstreamBranch + ':' + ref], before.cwd, true);
    const remoteHead = (await command(['rev-parse', '--verify', ref + '^{commit}'], before.cwd)).trim(), after = await current();
    if (after.cwd !== before.cwd || after.head !== before.head || after.branch !== before.branch || after.url !== before.url || after.upstreamBranch !== before.upstreamBranch) throw fail('本地仓库或分支已变化，请重新检查', 409);
    const [ahead, behind] = (await command(['rev-list', '--left-right', '--count', after.head + '...' + remoteHead], after.cwd)).trim().split(/\s+/).map(Number);
    return { available: true, ...after, remoteHead, ahead, behind };
  }
  async function update({ expectedHead, expectedRemoteHead }) {
    if (![expectedHead, expectedRemoteHead].every(value => typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value))) throw fail('请先检查远程更新');
    const before = await current(); if (before.dirty) throw fail('Git 工作区有未提交或未跟踪的文件，请先提交或暂存；内容已保留', 409);
    if (before.head !== expectedHead) throw fail('本地提交已变化，请重新检查', 409);
    const status = await check();
    if (status.head !== expectedHead || status.remoteHead !== expectedRemoteHead) throw fail('远程版本已变化，请重新检查', 409);
    if (status.dirty) throw fail('Git 工作区已变化，请先提交或暂存', 409);
    if (status.ahead) throw fail(status.behind ? '本地与远程已分叉，请在 Git 中处理后重试' : '本地有尚未推送的提交，请先在 Git 中处理', 409);
    if (!status.behind) return { updated: false, info: status };
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
      const file = (await command(['rev-parse', '--git-path', marker], status.cwd)).trim();
      if (await fs.lstat(path.resolve(status.cwd, file)).catch(() => null)) throw fail('Git 正在合并、变基或拣选，请先完成当前操作', 409);
    }
    await command(['merge', '--ff-only', '--no-edit', '--no-overwrite-ignore', expectedRemoteHead], status.cwd);
    return { updated: true, info: await current() };
  }
  return { listBranches, clone, info, check, update };
}
module.exports = { createRemoteRepositories, validateRemote, validateName, safeError };

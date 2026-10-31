'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const { decodeXmlBuffer } = require('./document-files');

// Read the workspace root at each operation. A repository switch must never
// leave Git pointing at the root captured when the server was constructed.
function createGitService({ getRoot, repositoriesRoot, checkedResolve }) {
  function cleanGitError(error) {
    const detail = String(error.stderr || error.stdout || error.message || '').trim();
    return detail || error.message || 'Git command failed';
  }

  function gitError(message, status = 400) {
    return Object.assign(new Error(message), { status });
  }

  async function runGitOnce(executable, args, options) {
    const output = path.join(os.tmpdir(), `dita-git-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
    let handle;
    try {
      handle = await fs.open(output, 'w');
      await new Promise((resolve, reject) => {
        const child = spawn(executable, args, {
          cwd: options.cwd,
          windowsHide: true,
          stdio: ['ignore', handle.fd, 'pipe']
        });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
        const timer = setTimeout(() => { child.kill(); reject(new Error('Git command timed out')); }, 30000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(Object.assign(new Error(`Git command failed with exit code ${code}`), { code, stderr }));
        });
      });
      return await fs.readFile(output, options.binary ? undefined : 'utf8');
    } finally {
      await handle?.close().catch(() => {});
      await fs.rm(output, { force: true }).catch(() => {});
    }
  }

  async function runGit(args, options = {}) {
    try {
      const git = await findGitExecutable();
      return await runGitOnce(git, args, { cwd: options.cwd || getRoot(), binary: options.binary });
    } catch (error) {
      throw Object.assign(new Error(cleanGitError(error)), { status: Number(options.errorStatus || 500) });
    }
  }


  async function findGitExecutable() {
    if (process.env.GIT_EXECUTABLE) return process.env.GIT_EXECUTABLE;
    const candidates = process.platform === 'win32'
      ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'), 'C:\\Program Files\\Git\\cmd\\git.exe', 'git.exe', 'git']
      : ['git'];
    for (const candidate of candidates) {
      const available = await new Promise(resolve => {
        const child = spawn(candidate, ['--version'], { windowsHide: true, stdio: 'ignore' });
        child.once('error', () => resolve(false));
        child.once('spawn', () => {
          child.kill();
          resolve(true);
        });
      });
      if (available) return candidate;
    }
    throw gitError('Git executable not available', 500);
  }
  async function gitRoot(target = getRoot()) {
    const stdout = await runGit(['rev-parse', '--show-toplevel'], { cwd: target, errorStatus: 404 });
    return path.resolve(stdout.trim());
  }

  async function isGitRepository(directory) {
    try {
      const root = await gitRoot(directory);
      return { ok: true, root };
    } catch {
      return { ok: false, root: null };
    }
  }

  async function resolveSelectedRepository(value) {
    const target = await fs.realpath(path.resolve(String(value || '')));
    const allowedRoot = await fs.realpath(repositoriesRoot);
    const parent = path.dirname(target);
    if (target !== allowedRoot && parent !== allowedRoot) {
      throw gitError('Repository must be a direct child of the repositories root', 403);
    }
    const stat = await fs.stat(target).catch(() => null);
    if (!stat?.isDirectory()) throw gitError('Repository directory not found', 404);
    const info = await isGitRepository(target);
    if (!info.ok) throw gitError('Selected directory is not a Git repository', 400);
    return target;
  }

  async function listRepositories() {
    const entries = await fs.readdir(repositoriesRoot, { withFileTypes: true });
    const repositories = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const absolute = path.join(repositoriesRoot, entry.name);
      const info = await isGitRepository(absolute);
      if (info.ok) repositories.push({ path: absolute, name: path.basename(absolute) });
    }
    repositories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return repositories;
  }

  async function listBranches() {
    let current = '';
    try {
      current = (await runGit(['branch', '--show-current'])).trim();
    } catch {
      current = '';
    }
    const stdout = await runGit(['for-each-ref', '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:iso8601)', 'refs/heads']);
    const branches = stdout.split(/\r?\n/).filter(Boolean).map(line => {
      const [name, commit, date = ''] = line.split('\t');
      return { name, commit, date, current: name === current };
    });
    return { current: current || '(detached)', branches };
  }

  async function gitWorktreeStatus() {
    const stdout = await runGit(['status', '--porcelain']);
    return { clean: !stdout.trim(), changes: stdout.trim() ? stdout.trim().split(/\r?\n/) : [] };
  }


  async function gitInfo(relativeFilePath) {
    try {
      const absolute = await checkedResolve(relativeFilePath);
      const root = await gitRoot(path.dirname(absolute));
      const gitRelative = path.relative(root, absolute).replace(/\\/g, '/');
      let status = 'unknown';
      try {
        const statusResult = await runGit(['status', '--porcelain', '--', gitRelative], { cwd: root });
        status = statusResult.trim() ? statusResult.trim().slice(0, 2) : 'clean';
      } catch {
        status = 'unknown';
      }
      try {
        const content = decodeXmlBuffer(await runGit(['show', `HEAD:${gitRelative}`], { cwd: root, binary: true }));
        return { available: true, status, content };
      } catch {
        return { available: false, status, content: '' };
      }
    } catch {
      return null;
    }
  }

  async function switchBranch(value) {
    const branch = String(value || '').trim();
    if (!branch || /[\r\n\0^:?*[\\]/.test(branch) || branch.startsWith('-') || branch === '.' || branch === '..') {
      throw gitError('Invalid branch name');
    }
    const branches = await listBranches();
    if (!branches.branches.some(item => item.name === branch)) throw gitError('Branch not found', 404);
    const status = await gitWorktreeStatus();
    if (!status.clean) {
      throw gitError('工作区有尚未提交的修改。请先提交或暂存（git stash），再切换分支；当前内容已保留。', 409);
    }
    await runGit(['switch', branch]);
  }

  return { runGit, gitInfo, listRepositories, listBranches, gitWorktreeStatus,
    resolveSelectedRepository, switchBranch };
}
module.exports = { createGitService };

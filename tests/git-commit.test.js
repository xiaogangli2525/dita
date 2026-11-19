'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createGitService } = require('../lib/git-service');
const { createCommitService } = require('../lib/git-commit');
const { resolveWorkspacePath, readXmlFile } = require('../lib/document-files');

test('commit verifies the selected disk snapshot and leaves unrelated stages and write history alone', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-git-only-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const selected = '手册 A.dita', other = 'staged.dita', original = '<topic id="t"><title>旧版</title></topic>';
  const write = (name, text) => fs.writeFile(path.join(cwd, name), original.replace('旧版', text));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await write(selected, '旧版'); await write(other, '旧版');
  git('add', '.'); git('commit', '-m', 'start');
  await write(other, '独立暂存'); git('add', '--', other); await write(other, '独立正文');
  await write(selected, '要提交');
  const getRoot = () => cwd, checkedResolve = name => resolveWorkspacePath(cwd, name);
  const service = createGitService({ getRoot, repositoriesRoot: cwd, checkedResolve });
  let lateEdit = false;
  const commits = createCommitService({ getRoot, checkedResolve, readXmlFile, async runGit(args, options) {
    if (lateEdit && args.includes('commit')) await write(selected, '其他工具晚到的修改');
    return service.runGit(args, options);
  } });
  const prior = await commits.plan(), pick = plan => plan.files.filter(file => file.path === selected);
  assert.equal(prior.files.find(file => file.path === other).reason, '已有暂存内容');
  lateEdit = true;
  await assert.rejects(commits.commit({ ...prior, files: pick(prior), message: '未核对的版本' }), /磁盘版本已变化/);
  assert.equal(git('rev-parse', 'HEAD'), prior.head);
  lateEdit = false;
  const fresh = await commits.plan();
  const committed = await commits.commit({ ...fresh, files: pick(fresh), message: '更新 HTTP 手册' });
  assert.notEqual(committed.head, prior.head);
  assert.match(git('show', 'HEAD:' + selected), /其他工具晚到的修改/);
  assert.match(git('show', 'HEAD:' + other), /旧版/);
  assert.match(git('show', ':' + other), /独立暂存/);
  assert.match(await fs.readFile(path.join(cwd, other), 'utf8'), /独立正文/);
  await assert.rejects(commits.commit({ ...fresh, files: pick(fresh), message: '过期请求' }), /分支或基线已变化/);
});

test('new and deleted documents can be committed together while failed commits preserve the index', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-git-add-delete-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const added = '新增 A.dita', removed = '待删除.dita', modified = 'modified.ditamap';
  const old = '<topic id="t"><title>原文</title></topic>', next = old.replace('原文', '新版本');
  const write = (file, content) => fs.writeFile(path.join(cwd, file), content);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const stages = option => git('diff', '--cached', option, '--name-only', '-z').split('\0').filter(Boolean);
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await Promise.all([write(removed, old), write(modified, '<map/>'), write('unrelated.txt', 'old'), write('.gitignore', 'ignored.dita\n')]);
  git('add', '.'); git('commit', '-m', 'Start');
  await Promise.all([
    fs.rm(path.join(cwd, removed)), write(modified, '<map><title>New</title></map>'), write(added, next),
    write('unselected.dita', old), write('ignored.dita', old), write('unrelated.txt', 'staged elsewhere')
  ]);
  git('add', 'unrelated.txt');
  const getRoot = () => cwd, checkedResolve = name => resolveWorkspacePath(cwd, name);
  const service = createGitService({ getRoot, repositoriesRoot: cwd, checkedResolve });
  let beforeCommit;
  const commits = createCommitService({ getRoot, checkedResolve, readXmlFile, async runGit(args, options) {
    if (args.includes('commit')) await beforeCommit?.();
    return service.runGit(args, options);
  } });
  const pick = plan => plan.files.filter(file => [added, removed, modified].includes(file.path));
  async function checkedCommit() {
    const plan = await commits.plan();
    return commits.commit({ ...plan, files: pick(plan), message: '提交新增、修改和删除' });
  }
  const initial = await commits.plan();
  assert.equal(initial.files.some(file => file.path === 'ignored.dita'), false);
  assert.deepEqual(Object.fromEntries(pick(initial).map(({ path, kind }) => [path, kind])), {
    [added]: 'added', [removed]: 'deleted', [modified]: 'modified'
  });
  await t.test('an index rename error survives a lock cleanup error and closes the handle once', async t => {
    const index = path.join(cwd, '.git', 'index'), lock = index + '.lock';
    const before = await fs.readFile(index);
    const open = fs.open, rename = fs.rename, rm = fs.rm;
    const warnings = t.mock.method(console, 'warn', () => {});
    let closeCalls = 0;
    t.mock.method(fs, 'open', async (file, ...args) => {
      const handle = await open(file, ...args);
      if (file === lock) {
        const close = handle.close.bind(handle);
        t.mock.method(handle, 'close', async () => { closeCalls++; await close(); });
      }
      return handle;
    });
    t.mock.method(fs, 'rename', async (from, to) => {
      if (from === lock) throw Object.assign(new Error('EBUSY replacing the Git index'), { code: 'EBUSY' });
      return rename(from, to);
    });
    t.mock.method(fs, 'rm', async (file, options) => {
      if (file === lock) throw Object.assign(new Error('EPERM cleaning up the Git index lock'), { code: 'EPERM' });
      return rm(file, options);
    });
    try {
      await assert.rejects(commits.commit({ ...initial, files: pick(initial), message: 'Rename should fail' }), /EBUSY replacing the Git index/);
      assert.equal(closeCalls, 1);
      assert.equal(warnings.mock.callCount(), 1);
      assert.equal(warnings.mock.calls[0].arguments.at(-1), 'EPERM');
      assert.deepEqual(await fs.readFile(index), before);
    } finally { await rm(lock, { force: true }); }
  });
  beforeCommit = () => write(added, old);
  await assert.rejects(checkedCommit(), /磁盘版本已变化/);
  assert.equal(git('rev-parse', 'HEAD'), initial.head);
  assert.deepEqual(stages('--ita-visible-in-index'), ['unrelated.txt']);
  beforeCommit = () => write(removed, old);
  await assert.rejects(checkedCommit(), /Git 实际提交范围已变化/);
  assert.deepEqual(stages('--ita-visible-in-index'), ['unrelated.txt']);
  await fs.rm(path.join(cwd, removed));
  beforeCommit = () => git('add', '--', added);
  await assert.rejects(checkedCommit(), /暂存状态已变化/);
  assert.equal(git('show', ':' + added), old);
  assert.equal((await commits.plan()).files.find(file => file.path === added).reason, '已有暂存内容');
  git('reset', 'HEAD', '--', added);
  git('add', '-N', 'unselected.dita');
  beforeCommit = undefined;
  await write(added, next);
  const result = await checkedCommit();
  assert.deepEqual(new Set(result.files), new Set([added, removed, modified]));
  assert.equal(git('rev-parse', 'HEAD'), result.head);
  assert.equal(git('show', 'HEAD:' + added), next);
  assert.equal(git('show', 'HEAD:' + modified), '<map><title>New</title></map>');
  assert.equal(git('ls-tree', 'HEAD', '--', removed, 'unselected.dita'), '');
  assert.equal(git('show', ':unrelated.txt'), 'staged elsewhere');
  assert.deepEqual(stages('--ita-invisible-in-index'), ['unrelated.txt']);
  assert.deepEqual(stages('--ita-visible-in-index'), ['unrelated.txt', 'unselected.dita']);
});

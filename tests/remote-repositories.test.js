'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const { fixture, git, url } = require('./remote-fixture'), { validateRemote, validateName, safeError } = require('../lib/remote-repositories');
test('remote inputs accept HTTPS/SSH and reject credentials, helpers, local paths and traversal', () => {
  for (const value of [url, 'git@example.invalid:team/manual.git', 'ssh://git@example.invalid:2222/team/manual.git']) assert.equal(validateRemote(value), value);
  for (const value of ['file:///tmp/docs', '/tmp/docs', 'ext::command', 'http://host/repo', 'https://user:secret@host/repo', 'ssh://user:secret@host/repo', 'https://host/repo?token=x', 'https://host/repo#x', 'https://host/%zz', 'https://host/a%0Ab', '--upload-pack=bad']) assert.throws(() => validateRemote(value));
  for (const value of ['../docs', '.', '.hidden', 'a/b', 'a\\b', 'CON', 'NUL.dita', '-option', 'bad.lock']) assert.throws(() => validateName(value));
  assert.equal(validateName('mqtt-manual_1'), 'mqtt-manual_1');
  assert.doesNotMatch(safeError(new Error('https://name:secret@host/repo Authorization: Bearer fake-token ghp_abc123')), /secret|fake-token|ghp_abc123/);
});
test('real branch discovery, selected-branch clone, collision refusal and failed-clone cleanup', async t => {
  const f = await fixture(t), branches = await f.remote.listBranches(url); assert.deepEqual(branches.branches, ['main', 'release']); assert.equal(branches.defaultBranch, 'main');
  await f.clone('release-copy', 'release'); assert.equal(git(f.root, 'branch', '--show-current'), 'release'); assert.equal((await f.remote.info()).url, url);
  await assert.rejects(f.remote.clone({ url, name: 'release-copy' }), error => error.status === 409);
  await assert.rejects(f.remote.clone({ url, name: 'failed', branch: 'missing' })); assert.deepEqual(await fs.readdir(f.managed), ['release-copy']);
  await fs.symlink(f.source, path.join(f.managed, 'linked')); await assert.rejects(f.remote.clone({ url, name: 'linked' }), error => error.status === 409);
  assert.match(await fs.readFile(path.join(f.source, 'a.dita'), 'utf8'), /原始内容/);
});
test('checks do not modify documents and updates fast-forward exactly the checked commit', async t => {
  const f = await fixture(t); await f.clone(); const before = await fs.readFile(path.join(f.root, 'a.dita'), 'utf8'), remoteHead = await f.advance(), checked = await f.remote.check();
  assert.equal(checked.behind, 1); assert.equal(checked.ahead, 0); assert.equal(await fs.readFile(path.join(f.root, 'a.dita'), 'utf8'), before);
  const result = await f.remote.update({ expectedHead: checked.head, expectedRemoteHead: checked.remoteHead }); assert.equal(result.updated, true); assert.equal(result.info.head, remoteHead); assert.match(await fs.readFile(path.join(f.root, 'a.dita'), 'utf8'), /远程更新/);
  const current = await f.remote.check(); assert.equal((await f.remote.update({ expectedHead: current.head, expectedRemoteHead: current.remoteHead })).updated, false);
});
test('tracked and untracked changes block updates and preserve exact bytes', async t => {
  const f = await fixture(t); await f.clone(); await f.advance(); const checked = await f.remote.check(), expected = { expectedHead: checked.head, expectedRemoteHead: checked.remoteHead };
  await fs.writeFile(path.join(f.root, 'draft.dita'), '<topic>untracked</topic>'); await assert.rejects(f.remote.update(expected), error => error.status === 409);
  assert.equal(await fs.readFile(path.join(f.root, 'draft.dita'), 'utf8'), '<topic>untracked</topic>'); await fs.rm(path.join(f.root, 'draft.dita'));
  await fs.writeFile(path.join(f.root, 'a.dita'), '<topic>local edit</topic>'); await assert.rejects(f.remote.update(expected), /未提交/);
  assert.equal(await fs.readFile(path.join(f.root, 'a.dita'), 'utf8'), '<topic>local edit</topic>'); assert.equal(git(f.root, 'rev-parse', 'HEAD'), checked.head);
});
test('stale remote versions, local-ahead commits and divergence never reset or merge local history', async t => {
  const f = await fixture(t); await f.clone(); await f.advance('first'); const checked = await f.remote.check(); await f.advance('second');
  await assert.rejects(f.remote.update({ expectedHead: checked.head, expectedRemoteHead: checked.remoteHead }), /远程版本已变化/); assert.equal(git(f.root, 'rev-parse', 'HEAD'), checked.head);
  const latest = await f.remote.check(); await f.remote.update({ expectedHead: latest.head, expectedRemoteHead: latest.remoteHead });
  await fs.writeFile(path.join(f.root, 'local.dita'), '<topic>local commit</topic>'); git(f.root, 'add', '.'); git(f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'local');
  const ahead = await f.remote.check(); assert.equal(ahead.ahead, 1); assert.equal(ahead.behind, 0); await assert.rejects(f.remote.update({ expectedHead: ahead.head, expectedRemoteHead: ahead.remoteHead }), /尚未推送/);
  await f.advance('third'); const divergent = await f.remote.check(); assert.equal(divergent.ahead, 1); assert.equal(divergent.behind, 1); await assert.rejects(f.remote.update({ expectedHead: divergent.head, expectedRemoteHead: divergent.remoteHead }), /分叉/); assert.equal(git(f.root, 'rev-parse', 'HEAD'), ahead.head);
});
test('fast-forward also protects ignored local files newly tracked by the remote', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.source, '.gitignore'), 'private.txt\n'); git(f.source, 'add', '.'); git(f.source, 'commit', '-m', 'ignore'); git(f.source, 'push', 'origin', 'main'); await f.clone();
  await fs.writeFile(path.join(f.root, 'private.txt'), 'local private notes'); await fs.writeFile(path.join(f.source, 'private.txt'), 'remote file'); git(f.source, 'add', '-f', 'private.txt'); git(f.source, 'commit', '-m', 'remote file'); git(f.source, 'push', 'origin', 'main');
  const checked = await f.remote.check(); assert.equal(checked.dirty, false); await assert.rejects(f.remote.update({ expectedHead: checked.head, expectedRemoteHead: checked.remoteHead }));
  assert.equal(await fs.readFile(path.join(f.root, 'private.txt'), 'utf8'), 'local private notes'); assert.equal(git(f.root, 'rev-parse', 'HEAD'), checked.head);
});

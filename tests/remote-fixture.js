'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), { execFileSync } = require('node:child_process');
const { createGitService } = require('../lib/git-service'), { createRemoteRepositories } = require('../lib/remote-repositories');
const url = 'https://example.invalid/company/manual.git';
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-remote-')), source = path.join(temp, 'source'), bare = path.join(temp, 'origin.git'), managed = path.join(temp, 'managed');
  await fs.mkdir(source); await fs.mkdir(managed); git(source, 'init', '-b', 'main'); git(source, 'config', 'user.name', 'Test'); git(source, 'config', 'user.email', 'test@example.invalid');
  await fs.writeFile(path.join(source, 'a.dita'), '<topic id="a"><title>MQTT 手册</title><body><p>原始内容</p></body></topic>');
  await fs.writeFile(path.join(source, 'main.ditamap'), '<map><title>MQTT 功能手册</title><topicref href="a.dita"/></map>');
  git(source, 'add', '.'); git(source, 'commit', '-m', 'initial'); git(source, 'branch', 'release'); git(temp, 'clone', '--bare', source, bare); git(source, 'remote', 'add', 'origin', bare);
  let root = path.join(managed, 'not-loaded');
  const base = createGitService({ getRoot: () => root, repositoriesRoot: managed });
  const remote = createRemoteRepositories({ getRoot: () => root, repositoriesRoot: managed,
    runGit: (args, options) => base.runGit(['-c', 'protocol.file.allow=always', ...args], options),
    transport: value => { if (value !== url) throw new Error('No fixture transport'); return bare; } });
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  return { temp, source, bare, managed, remote, base, get root() { return root; }, select: value => { root = value; },
    async clone(name = 'manual', branch = '') { const result = await remote.clone({ url, name, branch }); root = result.path; return result; },
    async advance(text = '远程更新') { await fs.writeFile(path.join(source, 'a.dita'), '<topic id="a"><title>MQTT 手册</title><body><p>' + text + '</p></body></topic>'); git(source, 'add', '.'); git(source, 'commit', '-m', text); git(source, 'push', 'origin', 'main'); return git(source, 'rev-parse', 'HEAD'); }
  };
}
module.exports = { fixture, git, url };

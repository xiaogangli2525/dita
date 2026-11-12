'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process'), { createGitService } = require('../lib/git-service');
const { createRepositoryAccess } = require('../lib/knowledge-repository');
const { createKnowledgeHandler } = require('../lib/knowledge-routes');
async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-multi-source-')); t.after(() => fs.rm(base, { recursive: true, force: true }));
  const roots = [path.join(base, 'HTTP'), path.join(base, 'TCP')];
  const command = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const [index, root] of roots.entries()) {
    await fs.mkdir(path.join(root, 'topics'), { recursive: true });
    await fs.writeFile(path.join(root, 'manual.ditamap'), '<map><title>Manual ' + index + '</title><topicref href="topics/a.dita"/></map>');
    await fs.writeFile(path.join(root, 'topics/a.dita'), '<topic id="a"><title>接口 ' + index + '</title><body><p>AT+TEST_' + index + '<fn product="ML307G">G_ONLY</fn><fn product="ML307N">N_ONLY</fn></p><p product="ML307N">PRIVATE_N</p></body></topic>');
    await fs.writeFile(path.join(root, 'g.ditaval'), '<val><prop att="product" val="ML307N" action="exclude"/></val>');
    command(root, 'init', '-b', 'main'); command(root, 'add', '.'); command(root, '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'initial');
  }
  const [root] = roots, git = createGitService({ getRoot: () => root, repositoriesRoot: base, checkedResolve: () => { throw Error('active workspace resolver must not be used'); } });
  const access = createRepositoryAccess({ git, getRoot: () => root });
  const handle = createKnowledgeHandler({ workspace: { root }, git });
  async function call(endpoint, body) {
    let value; const res = { writeHead: status => { assert.equal(status, 200); }, end: bytes => { value = JSON.parse(bytes); } };
    const req = { method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
    assert.equal(await handle(req, res, '/api/knowledge/' + endpoint), true); return value;
  }
  return { base, roots, access, command, call, recipe: root => ({ repositoryRoot: root, branch: 'main', path: 'manual.ditamap', model: 'ML307G', filterPath: 'g.ditaval', prefixes: true }) };
}
test('isolated captures from different repositories keep same-path documents and saved changes separate', async t => {
  const { roots, call, recipe, command } = await setup(t);
  await fs.appendFile(path.join(roots[1], 'topics/a.dita'), '<!-- saved but uncommitted -->');
  const [a, b] = await Promise.all(roots.map(root => call('capture', recipe(root))));
  const hydrated = require('../public/knowledge-source-data').hydrate(a); assert.equal(hydrated.snapshot.root, roots[0]);
  assert.throws(() => require('../public/knowledge-source-data').hydrate({ ...a, schema: 99 }), /格式无效/);
  assert.match(new Map(a.snapshot.files).get('topics/a.dita').current, /TEST_0/); assert.match(new Map(b.snapshot.files).get('topics/a.dita').current, /TEST_1/);
  assert.match(new Map(b.snapshot.files).get('topics/a.dita').current, /saved but uncommitted/); assert.equal(b.provenance.dirty, true);
  for (const root of roots) assert.equal(command(root, 'branch', '--show-current'), 'main');
  assert.equal((await call('verify', b.receipt)).current, true);
  await fs.appendFile(path.join(roots[1], 'topics/a.dita'), '<!-- changed after capture -->');
  await assert.rejects(call('verify', b.receipt), /已变化/);
});
test('a branch, tag or commit reads Git objects without checking out over dirty files', async t => {
  const { roots: [root], call, recipe, command } = await setup(t), source = path.join(root, 'topics/a.dita');
  command(root, 'switch', '-c', 'release'); await fs.writeFile(source, '<topic id="release"><title>发布版</title><body><p>AT+RELEASE</p></body></topic>'); command(root, 'add', '.'); command(root, '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'release');
  const sha = command(root, 'rev-parse', 'HEAD'); command(root, 'tag', 'sdk-v1'); command(root, 'switch', 'main'); await fs.appendFile(source, '<!-- DIRTY_KEPT -->');
  const disk = await fs.readFile(source, 'utf8');
  for (const revision of ['refs/heads/release', 'refs/tags/sdk-v1', sha]) {
    const result = await call('capture', { ...recipe(root), revision });
    assert.match(new Map(result.snapshot.files).get('topics/a.dita').current, /AT\+RELEASE/); assert.equal(result.provenance.commit, sha); assert.equal(result.provenance.dirty, false);
    assert.equal((await call('verify', result.receipt)).current, true);
  }
  assert.equal(await fs.readFile(source, 'utf8'), disk); assert.equal(command(root, 'branch', '--show-current'), 'main');
  await assert.rejects(call('capture', { ...recipe(root), branch: 'release' }), /与方案/);
});
test('missing and malformed settings, symlinks and unregistered roots fail without arbitrary reads', async t => {
  const { base, roots: [root], call, access, recipe } = await setup(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-outside-')); t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'private.dita'), '<topic/>');
  await assert.rejects(call('catalog', { repositoryRoot: outside }), /direct child/);
  await fs.symlink(path.join(outside, 'private.dita'), path.join(root, 'private.dita'));
  await assert.rejects(call('capture', { ...recipe(root), path: 'private.dita' }), /不存在|符号链接/);
  await assert.rejects(call('capture', { ...recipe(root), path: '../TCP/manual.ditamap' }), /路径无效/);
  await assert.rejects(access.open({ repositoryRoot: root, revision: '--help' }), /版本无效/);
  await assert.rejects(call('capture', { ...recipe(root), filterPath: 'missing.ditaval' }), /不存在/);
  const good = await call('capture', recipe(root));
  await assert.rejects(call('verify', { ...good.receipt, files: [{ path: '.git/config', sha256: null }] }), /类型不受支持/);
  await fs.writeFile(path.join(root, '.dita-project.json'), '{broken'); await assert.rejects(call('verify', good.receipt), /已变化/);
  await assert.rejects(call('capture', recipe(root)), /项目配置无效/);
  const nested = path.join(base, 'not-a-repository'); await fs.mkdir(nested);
  execFileSync('git', ['init', '-q'], { cwd: base });
  await assert.rejects(access.open({ repositoryRoot: nested }), /仓库的根目录/);
});
test('image bytes and sidecar absence participate in source verification', async t => {
  const { roots: [root], call, recipe } = await setup(t);
  const source = path.join(root, 'topics/a.dita'); await fs.writeFile(source, '<topic id="a"><title>图片</title><body><image href="test.svg"/></body></topic>');
  await fs.writeFile(path.join(root, 'topics/test.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const bundle = await call('capture', recipe(root)); assert.equal(bundle.assets.length, 1);
  await fs.writeFile(source, '<topic id="a"><title>引用注脚图片</title><body><p><xref href="../defs.dita#D/n" type="fn"/></p></body></topic>');
  await fs.writeFile(path.join(root, 'defs.dita'), '<topic id="D"><title>定义</title><body><p><fn id="n" product="ML307G"><image href="topics/test.svg?v=1"/></fn></p></body></topic>');
  const note = await call('capture', recipe(root)); assert.equal(note.assets.length, 1);
  assert.equal(note.assets[0][0], 'topics/test.svg');
  await fs.appendFile(path.join(root, 'topics/test.svg'), '<!-- change -->'); await assert.rejects(call('verify', bundle.receipt), /已变化/);
});
test('nested repositories and unsupported config files cannot silently supply publication content or rules', async t => {
  const { roots: [root], call, recipe, command } = await setup(t);
  const nested = path.join(root, 'vendor'); await fs.mkdir(nested);
  command(nested, 'init', '-q'); await fs.writeFile(path.join(nested, 'nested.ditamap'), '<map/>');
  const catalog = await call('catalog', { repositoryRoot: root });
  assert.ok(!catalog.maps.some(item => item.path === 'vendor/nested.ditamap'));
  const before = await call('capture', recipe(root));
  const settings = '.dita-note-rules.json';
  await fs.symlink('absent-rules.json', path.join(root, settings));
  await assert.rejects(call('verify', before.receipt), /来源配置已变化/);
  await assert.rejects(call('capture', recipe(root)), /配置须为普通文件/);
  command(root, 'add', settings); command(root, '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', 'linked rules');
  await assert.rejects(call('capture', { ...recipe(root), revision: 'HEAD' }), /配置须为普通文件/);
});
test('saved sources guard detached checkouts even when the commit stays the same', async t => {
  const { roots: [root], call, recipe, command } = await setup(t);
  command(root, 'checkout', '--detach', 'HEAD');
  const catalog = await call('catalog', { repositoryRoot: root }); assert.equal(catalog.branch, '(detached)');
  const capture = await call('capture', { ...recipe(root), branch: catalog.branch });
  command(root, 'switch', 'main');
  await assert.rejects(call('verify', capture.receipt), /与方案/);
  await assert.rejects(call('capture', { ...recipe(root), branch: '' }), /与方案/);
});
test('saved source provenance flags an ignored input used in an otherwise clean Git repository', async t => {
  const { roots: [root], call, recipe, command } = await setup(t);
  await fs.appendFile(path.join(root, '.git/info/exclude'), '\nlocal.ditaval\n');
  await fs.writeFile(path.join(root, 'local.ditaval'), '<val/>');
  assert.equal(command(root, 'status', '--porcelain'), '');
  const ordinary = await call('capture', recipe(root)); assert.equal(ordinary.provenance.dirty, false);
  const local = await call('capture', { ...recipe(root), filterPath: 'local.ditaval' }); assert.equal(local.provenance.dirty, true);
});
test('simultaneous catalog requests share the two active source slots', async t => {
  const { roots: [root], call } = await setup(t);
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => call('catalog', { repositoryRoot: root })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 2);
  const rejected = results.filter(item => item.status === 'rejected'); assert.equal(rejected[0].reason.status, 429);
  assert.equal((await call('catalog', { repositoryRoot: root })).root, root);
});
test('knowledge capture skips only the shared support Topics and keeps their published children', async t => {
  const { roots: [root], call, recipe } = await setup(t);
  const en = 'contentmodule/topics/reusable_general_en/g_service_and_support_en.dita';
  const cn = 'contentmodule/topics/reusable_general_cn/g_service_and_support_cn.dita';
  const similarlyNamed = 'topics/g_service_and_support_cn.dita';
  await fs.copyFile(path.join(root, 'topics/a.dita'), path.join(root, similarlyNamed));
  const manual = '<map><topicref href="' + cn + '"><topicref href="topics/a.dita"/></topicref><topicref href="' + en + '"/><topicref href="' + similarlyNamed + '"/></map>';
  await fs.writeFile(path.join(root, 'manual.ditamap'), manual);
  const source = await call('capture', recipe(root));
  assert.deepEqual(source.snapshot.files.map(([name]) => name), ['topics/a.dita', similarlyNamed]);
  assert.equal(await fs.readFile(path.join(root, 'manual.ditamap'), 'utf8'), manual);
  await assert.rejects(call('capture', { ...recipe(root), path: cn }), /不在本次发布范围/);
  await fs.unlink(path.join(root, 'topics/a.dita')); await assert.rejects(call('capture', recipe(root)), /来源文件不存在.*topics\/a\.dita/);
});
test('shared Git content follows saved files or the parent gitlink and explains an uninitialized dependency', async t => {
  const { roots: [root], call, recipe, command } = await setup(t), mount = 'common', child = path.join(root, mount);
  const file = path.join(child, 'shared.dita'), topic = title => '<topic id="shared"><title>' + title + '</title></topic>';
  await fs.mkdir(child); command(child, 'init', '-b', 'main');
  const commit = (repo, message) => { command(repo, 'add', '.'); command(repo, '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-qm', message); };
  await fs.writeFile(file, topic('pinned')); commit(child, 'shared pin');
  await fs.writeFile(path.join(root, '.gitmodules'), '[submodule "common"]\n path = common\n url = ../shared.git\n');
  await fs.writeFile(path.join(root, 'manual.ditamap'), '<map><topicref href="common/shared.dita"/></map>');
  commit(root, 'pin shared module'); command(root, 'submodule', 'absorbgitdirs', '--', mount);
  const clean = await call('capture', recipe(root)); assert.equal(clean.provenance.dirty, false);
  await fs.writeFile(file, topic('next')); commit(child, 'new version');
  await fs.writeFile(file, topic('working'));
  const saved = await call('capture', recipe(root)), pinned = await call('capture', { ...recipe(root), revision: 'HEAD' });
  assert.match(new Map(saved.texts).get('common/shared.dita'), /working/); assert.equal(saved.provenance.dirty, true);
  assert.match(new Map(pinned.texts).get('common/shared.dita'), /pinned/); assert.equal(pinned.provenance.dirty, false);
  assert.equal((await call('verify', pinned.receipt)).current, true);
  await fs.writeFile(file, topic('changed')); await assert.rejects(call('verify', saved.receipt), /已变化/);
  command(root, 'submodule', 'deinit', '-f', '--', mount);
  for (const revision of ['', 'HEAD']) await assert.rejects(call('capture', { ...recipe(root), revision }), /尚未初始化.*common/);
});

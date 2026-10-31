'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createGitService } = require('../lib/git-service');
const { resolveWorkspacePath } = require('../lib/document-files');
const { createEditorController } = require('../public/editor-controller');
const domain = require('../public/manual-core');
const core = require('../public/app-core');
const { buildMockDom } = require('./dom-mock');

test('Git service instances stay isolated and follow the selected workspace root', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-services-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const roots = [];
  for (const name of ['first repo', 'second repo']) {
    const directory = path.join(temporary, name); await fs.mkdir(directory); roots.push(directory);
    await fs.writeFile(path.join(directory, 'a.dita'), `<topic><title>${name}</title></topic>`);
    const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'ignore' });
    git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', name);
    git('branch', 'feature');
  }
  let selected = roots[0];
  const moving = createGitService({ getRoot: () => selected, repositoriesRoot: temporary, checkedResolve: relative => resolveWorkspacePath(selected, relative) });
  const fixed = createGitService({ getRoot: () => roots[0], repositoriesRoot: temporary, checkedResolve: relative => resolveWorkspacePath(roots[0], relative) });
  assert.match((await moving.gitInfo('a.dita')).content, /first repo/);
  selected = roots[1];
  assert.equal(await moving.resolveSelectedRepository(selected), selected);
  assert.deepEqual((await moving.listRepositories()).map(repo => repo.name), ['first repo', 'second repo']);
  assert.match((await moving.gitInfo('a.dita')).content, /second repo/);
  assert.match((await fixed.gitInfo('a.dita')).content, /first repo/);
  await moving.switchBranch('feature');
  assert.equal((await moving.listBranches()).current, 'feature');
  assert.notEqual((await fixed.listBranches()).current, 'feature');
  await fs.writeFile(path.join(selected, 'a.dita'), '<topic>unsaved worktree</topic>');
  const previous = (await moving.listBranches()).branches.find(branch => branch.name !== 'feature').name;
  await assert.rejects(moving.switchBranch(previous), error => error.status === 409);
  assert.equal((await moving.listBranches()).current, 'feature');
  await assert.rejects(moving.switchBranch('--detach'), error => error.status === 400);
});

function editor() {
  const { document } = buildMockDom();
  const create = name => document.createElement(name);
  const topic = { path: 'a.dita', current: '<topic>A</topic>', disk: '<topic>A</topic>' };
  const map = { path: 'main.ditamap', current: '<map/>', disk: '<map/>' };
  const other = { path: 'other.dita', current: '<topic>other</topic>', disk: '<topic>other</topic>' };
  const events = domain.createEvents(), changes = [], requests = [];
  events.on('document:changed', file => changes.push(file.path));
  const state = { activePath: map.path, historyTargetPath: map.path, mode: 'editor', filesMap: new Map([map, topic, other].map(file => [file.path, file])), mapAuthorPaths: new Set([topic.path]), mapAuthorRenderToken: 0, maps: [], reviewDecisions: new Map() };
  const A = { state, events, ditaCore: core, api: { token: 'first', request: async url => { requests.push(url); throw new Error('Unexpected IO'); } },
    dom: { editor: create('textarea'), visualEditor: create('div'), undoButton: create('button'), redoButton: create('button') },
    setStatus() {}, refreshChrome() {}, validateXml: source => core.parseXml(source) };
  const controller = createEditorController(A, { renderTabs() {}, renderOutline() {}, renderInspector() {}, updateTree() {}, refreshChrome() {} });
  return { A, controller, topic, other, map, changes, requests };
}

test('editor coordination keeps Map child undo and review decisions on the same document history', () => {
  const { A, controller, topic, other, changes } = editor();
  controller.setFileContent(topic, '<topic>B</topic>', { render: false, historyMeta: { reviewDecisionsBefore: new Map(), reviewDecisionsAfter: new Map([[0, 'accept']]) } });
  controller.setFileContent(other, '<topic>background edit</topic>', { render: false });
  assert.equal(A.state.historyTargetPath, topic.path);
  controller.undoFile();
  assert.equal(topic.current, topic.disk); assert.equal(topic.dirty, false);
  assert.equal(other.current, '<topic>background edit</topic>');
  assert.equal(A.state.reviewDecisions.size, 0);
  controller.redoFile();
  assert.equal(topic.current, '<topic>B</topic>'); assert.equal(topic.dirty, true);
  assert.equal(A.state.reviewDecisions.get(0), 'accept');
  assert.deepEqual(changes, ['a.dita', 'other.dita', 'a.dita', 'a.dita']);
});

test('workspace changes invalidate the editor render generation and discard pending Map refreshes', async () => {
  const { A, controller, map, requests } = editor();
  const generation = A.state.mapAuthorRenderToken;
  controller.setFileContent(map, '<map><title>Pending edit</title></map>');
  A.events.emit('workspace:willChange');
  assert.ok(A.state.mapAuthorRenderToken > generation);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(requests.length, 0); assert.equal(map.current, '<map><title>Pending edit</title></map>');
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createAiConfigStore } = require('../lib/ai-config-store'), { createAiSettings } = require('../lib/ai-settings');
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dita-ai-settings-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return { root, file: path.join(root, 'private', 'ai.json') }; }
const input = { baseUrl: 'https://model.example.test/v1', model: 'test-model', key: 'stored-test-key', allowHttp: false, noAuth: false };
test('connection persists across service instances without putting a key into the public config response', t => {
  const { file } = fixture(t), env = { DITA_AI_CONFIG_FILE: file };
  const first = createAiSettings({ env }); assert.equal(first.configuration().available, false); first.update(input);
  const second = createAiSettings({ env }); assert.equal(second.configuration().available, true); assert.equal(second.configuration().persisted, true);
  assert.equal(second.configuration().model, input.model); assert.equal(second.configuration().keyConfigured, true);
  assert.doesNotMatch(JSON.stringify(second.configuration()), /stored-test-key/);
  const saved = JSON.parse(fs.readFileSync(file)); assert.deepEqual(Object.keys(saved).sort(), ['schema','baseUrl','model','key','allowHttp','noAuth'].sort());
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['ai.json']);
});
test('corrupt stored config stays disabled until repaired and demo mode does not read it', t => {
  const { file } = fixture(t), store = createAiConfigStore({ DITA_AI_CONFIG_FILE: file }); store.save(input); fs.writeFileSync(file, '{broken test-key');
  const settings = createAiSettings({ env: { DITA_AI_CONFIG_FILE: file } }); assert.equal(settings.configuration().available, false); assert.match(settings.configuration().message, /无法读取/);
  settings.update(input); assert.equal(settings.configuration().available, true);
  let read = false; createAiSettings({ demoMode: true, env: {}, store: { load: () => { read = true; }, save() {} } }); assert.equal(read, false);
});
test('a failed persistent save leaves the existing connection unchanged and redacts filesystem errors', t => {
  const { root } = fixture(t), blocker = path.join(root, 'not-a-directory'); fs.writeFileSync(blocker, 'x');
  const store = createAiConfigStore({ DITA_AI_CONFIG_FILE: path.join(blocker, 'ai.json') });
  assert.throws(() => store.save(input), e => !e.message.includes(root) && !e.message.includes(input.key));
  const env = { DITA_AI_BASE_URL: input.baseUrl, DITA_AI_MODEL: input.model, DITA_AI_API_KEY: input.key };
  const settings = createAiSettings({ env, store: { load: () => null, save: () => { throw Error('save failed'); } } });
  assert.throws(() => settings.update({ ...input, baseUrl: 'https://new.example.test/v1' })); assert.equal(settings.configuration().baseUrl, input.baseUrl);
});

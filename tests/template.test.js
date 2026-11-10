'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const core = require('../public/template-core'), pdf = require('../public/template-pdf'), { createTemplateStore } = require('../lib/template-store');
const html = require('../public/delivery-document').renderHtmlDocument({ title: '原始标题', model: 'M100', version: 'V1', sections: [{ title: '命令', body: '<p>AT+TEST 原始内容</p>' }] });
const packageValue = () => core.builtins()[0];
test('template capture is detached, explicit and deterministic across property order', () => {
  const pack = packageValue(), snapshot = core.capture(pack, { 'manual.title': 'HTTP 手册', 'manual.model': 'M100', 'company.name': '示例企业' });
  pack.colors.primary = '#FFFFFF'; pack.cover.fields.length = 0;
  assert.equal(snapshot.package.colors.primary, '#145A78'); assert.ok(snapshot.package.cover.fields.length);
  const reversed = Object.fromEntries(Object.entries(snapshot.package).reverse());
  assert.deepEqual(core.normalizePackage(reversed), snapshot.package); assert.equal(snapshot.fields['manual.releaseDate'], '');
  assert.throws(() => core.capture(packageValue(), { 'manual.title': '手册', 'manual.releaseDate': '2026-02-30' }), /发布日期/);
  assert.throws(() => core.capture(packageValue(), { 'manual.title': '手册', 'manual.releaseDate': '2026-13-01' }), /发布日期/);
});
test('template boundary rejects unsupported execution, formats, paths and layout capabilities', () => {
  for (const changed of [{ script: 'alert(1)' }, { schemaVersion: 2 }, { renderer: 'custom-js' }, { formats: ['docx'] }, { id: '../../private' }, { id: ['test'] }, { version: ['1.0.0'] }, { name: ' ' },
    { page: { ...packageValue().page, size: 'custom' } }, { numbering: { basis: 'body', startAt: 1 } },
    { company: { name: '', logo: 'file:///secret' } }, { assets: { '../logo.png': 'data:image/png;base64,AAAA' } },
    { assets: { 'assets/logo.png': 'data:image/svg+xml,<svg/>' } }, { cover: { ...packageValue().cover, fields: ['window.location'] } },
    { watermark: { ...packageValue().watermark, opacity: 1 } }]) assert.throws(() => core.normalizePackage({ ...packageValue(), ...changed }), /交付模板/);
});
test('embedded image boundaries enforce decoded byte size and dimensions before rendering', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZtkAAAAASUVORK5CYII=', 'base64');
  const pack = packageValue(), withImage = bytes => ({ ...pack, assets: { 'assets/logo.png': 'data:image/png;base64,' + bytes.toString('base64') } });
  assert.ok(core.normalizePackage(withImage(png)));
  const wide = Buffer.from(png); wide.writeUInt32BE(8001, 16); assert.throws(() => core.normalizePackage(withImage(wide)), /8000/);
  const large = Buffer.alloc(500001); png.copy(large); assert.throws(() => core.normalizePackage(withImage(large)), /500 KB/);
});
test('PDF template keeps content and escapes user fields without replacement-string or CSS injection', () => {
  const snapshot = core.capture(packageValue(), { 'manual.title': '$& <script>标题</script>', 'company.name': 'a";}</style><script>alert(1)</script>' });
  const output = pdf.render(html, snapshot);
  assert.match(output, /AT\+TEST 原始内容/); assert.match(output, /\$&amp; &lt;script&gt;/);
  assert.doesNotMatch(output, /<script>/); assert.equal((output.match(/class="template-cover /g) || []).length, 1);
  assert.match(output, /@page dita-cover/); assert.match(output, /@page dita-front/); assert.match(output, /counter\(page\)/);
  assert.throws(() => pdf.render('<p>incomplete</p>', snapshot), /完整交付/);
});
test('template registry preserves installed versions and supports a portable package round trip', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-templates-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createTemplateStore({ env: { DITA_TEMPLATE_DIR: directory } }), pack = { ...packageValue(), id: 'company-test' };
  const before = await store.list(); assert.equal(before.templates.length, 2);
  const saved = await store.save(pack); assert.equal(saved.sha256.length, 64);
  assert.deepEqual(await createTemplateStore({ env: { DITA_TEMPLATE_DIR: directory } }).save(JSON.parse(JSON.stringify(pack))), saved);
  await assert.rejects(store.save({ ...pack, name: 'changed' }), error => error.status === 409);
  const second = await store.save({ ...pack, version: '1.1.0', name: 'changed' }); assert.notEqual(second.sha256, saved.sha256);
  assert.equal((await store.list()).templates.length, 4); assert.deepEqual((await fs.readdir(directory)).sort(), ['company-test@1.0.0.json', 'company-test@1.1.0.json']);
});
test('concurrent template imports cannot overwrite one another and corrupt files remain untouched', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-template-race-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createTemplateStore({ env: { DITA_TEMPLATE_DIR: directory } }), pack = { ...packageValue(), id: 'racing' };
  const outcomes = await Promise.allSettled([store.save(pack), store.save({ ...pack, name: 'other' })]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1); assert.equal(outcomes.find(item => item.status === 'rejected').reason.status, 409);
  await fs.writeFile(path.join(directory, 'broken.json'), '{broken');
  const result = await store.list(); assert.equal(result.templates.length, 3); assert.equal(result.warnings.length, 1);
  assert.equal(await fs.readFile(path.join(directory, 'broken.json'), 'utf8'), '{broken');
});
test('demo template registry never writes persistent user configuration', async () => {
  const store = createTemplateStore({ memory: true, env: { DITA_TEMPLATE_DIR: '/should-not-be-created' } });
  await store.save({ ...packageValue(), id: 'demo-test' }); assert.equal((await store.list()).templates.length, 3);
  assert.equal((await store.list()).temporary, true); assert.equal((await createTemplateStore({ memory: true }).list()).templates.length, 2);
});

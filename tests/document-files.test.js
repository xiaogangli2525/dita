'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const iconv = require('iconv-lite');
const { readXmlFile, writeXmlFile, decodeXmlBuffer } = require('../lib/document-files');

async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dita-encoding-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('encoding-like text outside the XML declaration never controls file decoding or saving', async t => {
  const root = await directory(t), file = path.join(root, 'topic.dita');
  for (const source of [
    '<topic><title>中文</title><body><p>encoding="latin1"</p></body></topic>',
    '<?xml version="1.0"?><topic encoding="ISO-8859-1"><title>中文</title></topic>',
    '<!-- encoding="ASCII" -->\n<topic><title>中文 😊</title></topic>',
    '<?xml-stylesheet encoding="latin1"?><topic><title>中文</title></topic>',
    '<?xml version="1.0"?><topic><title><![CDATA[encoding="ASCII" 中文]]></title></topic>'
  ]) {
    const bytes = Buffer.from(source, 'utf8');
    assert.equal(decodeXmlBuffer(bytes), source);
    await writeXmlFile(file, source);
    assert.deepEqual(await fs.readFile(file), bytes);
    assert.equal(await readXmlFile(file), source);
  }
});

test('unrepresentable or unsupported output encodings refuse both replacement and creation', async t => {
  const root = await directory(t), file = path.join(root, 'existing.dita'), created = path.join(root, 'new.dita');
  const original = Buffer.from('<topic><title>Original</title></topic>');
  await fs.writeFile(file, original);
  for (const encoding of ['ISO-8859-1', 'ASCII', 'windows-1252', 'GBK', 'GB2312', 'not-an-encoding']) {
    const source = '<?xml version="1.0" encoding="' + encoding + '"?><topic><title>中文 😊</title></topic>';
    for (const [target, options] of [[file, {}], [created, { createOnly: true }]]) {
      await assert.rejects(writeXmlFile(target, source, options), error => error.status === 400 && /编码/.test(error.message));
    }
    assert.deepEqual(await fs.readFile(file), original);
    await assert.rejects(fs.stat(created), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(root), ['existing.dita']);
  }
});

test('representable declared encodings, BOMs, CRLF and XML declarations survive exact round-trips', async t => {
  const root = await directory(t), file = path.join(root, 'topic.dita');
  for (const encoding of ['UTF-8', 'GBK', 'GB2312', 'GB18030', 'UTF-16', 'UTF-16LE', 'UTF-16BE', 'ISO-8859-1']) {
    const text = encoding === 'ISO-8859-1' ? 'café' : '中文';
    const markers = /UTF-/i.test(encoding) ? ['', '\uFEFF'] : [''];
    for (const marker of markers) {
      const source = marker + "<?xml version='1.0' encoding='" + encoding + "'?>\r\n<topic><title>" + text + '</title></topic>\r\n';
      const bytes = iconv.encode(source, encoding, { addBOM: false });
      assert.equal(decodeXmlBuffer(bytes), source, encoding);
      await writeXmlFile(file, source);
      assert.deepEqual(await fs.readFile(file), bytes, encoding);
      assert.equal(await readXmlFile(file), source, encoding);
    }
  }
});

test('valid UTF-8 replacement characters are content rather than a signal to reinterpret the encoding', async t => {
  const root = await directory(t), file = path.join(root, 'topic.dita');
  for (const text of ['��', '�X', '中文��']) {
    for (const declaration of ['', '<?xml version="1.0" encoding="UTF-8"?>']) {
      const source = declaration + '<topic><title>' + text + '</title></topic>';
      assert.equal(decodeXmlBuffer(Buffer.from(source)), source);
      await writeXmlFile(file, source);
      assert.equal(await readXmlFile(file), source);
    }
  }
});

test('undecodable bytes and truncated UTF-16 fail without exposing replacement text for saving', async t => {
  const root = await directory(t), file = path.join(root, 'broken.dita');
  const invalid = [
    Buffer.concat([Buffer.from('<topic>'), Buffer.from([0xff]), Buffer.from('</topic>')]),
    Buffer.from([0xff, 0xfe, 0x3c]),
    Buffer.from([0xfe, 0xff, 0x00, 0x3c, 0xd8, 0x00, 0x00, 0x3e])
  ];
  for (const bytes of invalid) {
    await fs.writeFile(file, bytes);
    assert.throws(() => decodeXmlBuffer(bytes), error => error.status === 400 && /编码|解码/.test(error.message));
    await assert.rejects(readXmlFile(file), error => error.status === 400);
    assert.deepEqual(await fs.readFile(file), bytes);
  }
});

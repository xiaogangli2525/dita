const fs = require('node:fs/promises');
const path = require('node:path');
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const core = require('../server.js');

test('parses declarations, doctype, comments, CDATA, and entities', () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">',
    '<!-- comment -->',
    '<topic id="T &quot;1&quot;">',
    '  <title>A &amp; B</title>',
    '  <body><p><![CDATA[1 < 2]]></p><br/></body>',
    '</topic>',
    '<!-- trailing comment -->'
  ].join('\n');
  const parsed = core.parseXml(xml);
  assert.equal(parsed.declaration, '<?xml version="1.0" encoding="UTF-8"?>');
  assert.ok(parsed.doctype.startsWith('<!DOCTYPE topic'));
  assert.equal(parsed.root.name, 'topic');
  assert.equal(parsed.root.attrs.id, 'T "1"');
  assert.equal(core.childElement(parsed.root, 'title').children[0].value, 'A & B');
  const body = core.childElement(parsed.root, 'body');
  const p = core.childElement(body, 'p');
  assert.equal(p.children[0].cdata, true);
  assert.equal(p.children[0].value, '1 < 2');
  assert.equal(core.childElement(body, 'br').children.length, 0);
});

test('accepts whitespace after the root element', () => {
  const parsed = core.parseXml('<root><child/></root>\n\n');
  assert.equal(parsed.root.name, 'root');
  assert.equal(parsed.root.children.length, 1);
});

test('rejects text outside the root element', () => {
  assert.throws(() => core.parseXml('<root/>text'), /Text outside root element/);
});

test('rejects mismatched and unclosed tags', () => {
  assert.throws(() => core.parseXml('<root></wrong>'), /Mismatched end tag/);
  assert.throws(() => core.parseXml('<root><child></root>'), /Mismatched end tag/);
  assert.throws(() => core.parseXml('<root><child>'), /Unclosed element/);
});

test('resolves map hrefs against the map directory', () => {
  const map = core.parseXml([
    '<map>',
    '<topicref href="../topics/a.dita#frag"><topicmeta><navtitle>A</navtitle></topicmeta></topicref>',
    '<chapter href="chapters/b.dita"/>',
    '</map>'
  ].join(''));
  const [a, b] = core.mapNodeToTree(map.root, 'books/maps/main.ditamap');
  assert.equal(a.title, 'A');
  assert.equal(a.path, 'books/topics/a.dita');
  assert.equal(b.path, 'books/maps/chapters/b.dita');
});

test('keeps all DITA map topic groups and structural containers', () => {
  const map = core.parseXml([
    '<bookmap>',
    '<frontmatter><notices href="notice.dita"/></frontmatter>',
    '<chapter navtitle="Chapter"><topicgroup><topicref href="a.dita"/></topicgroup></chapter>',
    '<backmatter><topicref href="back.dita"/></backmatter>',
    '</bookmap>'
  ].join(''));
  const flattened = [];
  const flatten = nodes => {
    for (const node of nodes) {
      flattened.push([node.type, node.title, node.path]);
      flatten(node.children || []);
    }
  };
  flatten(core.mapNodeToTree(map.root, 'main.ditamap'));
  assert.deepEqual(flattened, [
    ['container', 'frontmatter', ''],
    ['file', 'notice.dita', 'notice.dita'],
    ['container', 'Chapter', ''],
    ['container', 'topicgroup', ''],
    ['file', 'a.dita', 'a.dita'],
    ['container', 'backmatter', ''],
    ['file', 'back.dita', 'back.dita']
  ]);
});

test('decodes XML files using declared and GBK-compatible encodings', async () => {
  const root = 'tests/temp-encoding';
  await fs.mkdir(root, { recursive: true });
  const write = (name, buffer) => fs.writeFile(path.join(root, name), buffer);
  await write('utf8.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><root><title>概论</title></root>'));
  await write('gbk.xml', Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="GB2312"?><root><title>'),
    Buffer.from([0xb8, 0xc5, 0xca, 0xf6]),
    Buffer.from('</title></root>')
  ]));

  const utf8 = await core.readXmlFile(path.join(root, 'utf8.xml'));
  const gbk = await core.readXmlFile(path.join(root, 'gbk.xml'));
  assert.equal(/<title>概论<\/title>/.test(utf8), true);
  assert.equal(/<title>概述<\/title>/.test(gbk), true);

  await fs.rm(root, { recursive: true, force: true });
});

test('keeps map titles for containers without hrefs', () => {
  const map = core.parseXml([
    '<map><part><title>Part</title><chapter href="a.dita"><topicmeta><navtitle>Chapter</navtitle></topicmeta></chapter></part></map>'
  ].join(''));
  const [part] = core.mapNodeToTree(map.root, 'main.ditamap');
  assert.equal(part.type, 'container');
  assert.equal(part.title, 'Part');
  assert.equal(part.children[0].title, 'Chapter');
});

test('serializes map declarations, doctype, comments, processing instructions, and CDATA', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE map PUBLIC "-//OASIS//DTD DITA Map//EN" "map.dtd">
<map><!-- keep --><title>A &amp; B</title><data><![CDATA[1 < 2]]></data></map>`;
  const serialized = core.serializeXmlDocument(core.parseXml(source));
  assert.ok(serialized.includes('<?xml version="1.0" encoding="UTF-8"?>'), serialized);
  assert.ok(serialized.includes('<!DOCTYPE map PUBLIC "-//OASIS//DTD DITA Map//EN" "map.dtd">'), serialized);
  assert.ok(serialized.includes('<!-- keep -->'), serialized);
  assert.ok(serialized.includes('<![CDATA[1 < 2]]>'), serialized);
  const reparsed = core.parseXml(serialized);
  assert.equal(reparsed.root.name, 'map');
  assert.equal(core.textOf(core.childElement(reparsed.root, 'title')), 'A & B');
});

test('map structure operations update source and keep the selected node stable', async () => {
  const original = `<?xml version="1.0" encoding="UTF-8"?>
<map>
  <title>Manual</title>
  <topicref href="a.dita"/>
  <topichead><title>Group</title><topicref href="b.dita"/></topichead>
  <topicref href="c.dita"/>
</map>`;
  const dependencies = { resolveTopicHref: async () => 'topics/new.dita' };
  const run = (content, request) => core.applyMapOperation(content, 'main.ditamap', request, dependencies);

  let result = await run(original, { operation: 'moveDown', sourcePath: '1' });
  assert.equal(result.selectedSourcePath, '2');
  assert.ok(result.content.indexOf('<topichead>') < result.content.indexOf('href="a.dita"'), result.content);

  result = await run(result.content, { operation: 'moveUp', sourcePath: result.selectedSourcePath });
  assert.equal(result.selectedSourcePath, '1');

  result = await run(result.content, { operation: 'demote', sourcePath: '3' });
  assert.equal(result.selectedSourcePath, '2.2');
  result = await run(result.content, { operation: 'promote', sourcePath: result.selectedSourcePath });
  assert.equal(result.selectedSourcePath, '3');
  result = await run(result.content, { operation: 'remove', sourcePath: result.selectedSourcePath });
  assert.equal(result.selectedSourcePath, '');

  result = await run(result.content, { operation: 'addTopichead', sourcePath: '', title: 'New heading' });
  assert.ok(/<topichead>\s*<title>New heading<\/title>\s*<\/topichead>/.test(result.content), result.content);
  result = await run(result.content, { operation: 'addTopicref', sourcePath: result.selectedSourcePath, href: 'topics/new.dita' });
  assert.equal(result.selectedSourcePath, '3.1');


  assert.equal(result.map.children.at(-1).title, 'New heading');
});

test('P0-2: numeric character references decode and survive round-trip', () => {
  const xml = '<root><p>A &#169; B &#x2014; C</p></root>';
  const parsed = core.parseXml(xml);
  const p = core.childElement(core.childElement(parsed.root, 'body') || parsed.root, 'p') || core.childElement(parsed.root, 'p');
  // &#169; should decode to copyright sign, &#x2014; to em dash
  assert.ok(p.children[0].value.includes('\u00A9'), 'copyright sign decoded');
  assert.ok(p.children[0].value.includes('\u2014'), 'em dash decoded');
});

test('P0-3: attributes containing > are parsed correctly', () => {
  const xml = '<root><topic id="a" cond="x > y">text</topic></root>';
  const parsed = core.parseXml(xml);
  const topic = core.childElement(parsed.root, 'topic');
  assert.equal(topic.attrs.id, 'a');
  assert.equal(topic.attrs.cond, 'x > y');
});

test('P0-1: GBK file round-trip preserves Chinese text', async () => {
  const root = 'tests/temp-gbk';
  await fs.mkdir(root, { recursive: true });
  const filePath = path.join(root, 'gbk_test.xml');
  const content = '<?xml version="1.0" encoding="GB2312"?>\n<root><title>\u6982\u8FF0</title></root>';
  await core.writeXmlFile(filePath, content);
  const readBack = await core.readXmlFile(filePath);
  assert.ok(readBack.includes('\u6982\u8FF0'), 'Chinese text preserved after round-trip');
  // Cleanup
  await fs.rm(root, { recursive: true, force: true });
});
test('writeXmlFile UTF-8 round-trip preserves content', async () => {
  const root = 'tests/temp-utf8-write';
  await fs.mkdir(root, { recursive: true });
  const filePath = path.join(root, 'utf8_test.xml');
  const content = '<?xml version="1.0" encoding="UTF-8"?>\n<root><title>\u6982\u8FF0</title></root>';
  await core.writeXmlFile(filePath, content);
  const readBack = await core.readXmlFile(filePath);
  assert.ok(readBack.includes('\u6982\u8FF0'), 'UTF-8 Chinese text preserved');
  await fs.rm(root, { recursive: true, force: true });
});
test('N4: invalid numeric character reference does not throw', () => {
  const xml = '<t>&#99999999;</t>';
  const parsed = core.parseXml(xml);
  assert.equal(parsed.root.name, 't');
  assert.ok(parsed.root.children[0].value.includes('&#99999999;'), 'invalid entity preserved as-is, not RangeError');
});

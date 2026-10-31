'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const templates = require('../public/document-templates'), { parseXml, textOf, childElement } = require('../lib/xml-tree');
test('all business and standard templates produce valid XML with the requested title and root', () => {
  for (const [kind, [, tag]] of Object.entries(templates.definitions)) {
    const { root } = parseXml(templates.create(kind, 'MQTT & TCP <说明>', kind + '.dita'));
    assert.equal(root.name, tag); assert.equal(textOf(childElement(root, 'title')), 'MQTT & TCP <说明>');
  }
});
test('template IDs remain usable for Chinese and numeric filenames and reject unknown templates', () => {
  for (const filename of ['中文.dita', '123-command.dita', 'space name.dita']) assert.match(parseXml(templates.create('command', 'AT', filename)).root.attrs.id, /^[A-Za-z_][\w-]*$/);
  assert.throws(() => templates.create('unknown', 'x', 'x.dita'), /模板/);
});
test('command and parameter templates contain a header and a body row for supported table editing', () => {
  for (const kind of ['command', 'parameters']) { const xml = templates.create(kind, '参数', kind + '.dita'); assert.match(xml, /<thead><row>/); assert.match(xml, /<tbody><row>/); assert.doesNotMatch(xml, /<tr>|<td>/); }
});

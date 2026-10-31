'use strict';

const assert = require('node:assert/strict');
const { renderDitaNode, lineDiff } = require('../public/app-core');
const test = require('node:test');
const { createTestApp, buildMockDom } = require('./visual-harness');

test('visual edits update the current DITA source', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">
<topic id="topic-id" outputclass="manual">
  <title>Original title</title>
  <shortdesc>Keep short description</shortdesc>
  <body>
    <p id="p1">Original paragraph</p>
    <p id="p2">Keep me</p>
  </body>
</topic>`;
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  app.dom.visualEditor.querySelector('h2').textContent = 'Edited title';
  app.dom.visualEditor.querySelector('p').textContent = 'Edited paragraph';
  app.visualToXml();

  const file = app.state.filesMap.get('topic.dita');
  assert.ok(file.current.includes('<title>Edited title</title>'), file.current);
  assert.ok(file.current.includes('<p id="p1">Edited paragraph</p>'), file.current);
  assert.ok(file.current.includes('<p id="p2">Keep me</p>'), file.current);
  assert.ok(file.current.includes('<shortdesc>Keep short description</shortdesc>'), file.current);
  assert.ok(file.current.includes('id="topic-id"'), file.current);
  assert.ok(file.current.includes('outputclass="manual"'), file.current);
  assert.ok(file.current.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), file.current);
  assert.ok(file.current.includes('<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">'), file.current);
  assert.equal(file.dirty, true);
});

test('deleting one visual line preserves source layout for focused review diffs', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<topic id="topic-id">
  <title>Title</title>
  <body>
    <p>Keep one</p>
    <p>Remove this</p>
    <p>Keep three</p>
    <p>Keep four</p>
  </body>
</topic>`;
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  const body = app.dom.visualEditor.childNodes.find(node => node.getAttribute?.('data-dita-body') === 'true');
  body.children[1].remove();
  app.visualToXml();

  const current = app.state.filesMap.get('topic.dita').current;
  const rows = require('../public/app-core').lineDiff(source, current);
  assert.deepEqual(rows.filter(row => row.type === 'old').map(row => row.text), ['    <p>Remove this</p>']);
  assert.deepEqual(rows.filter(row => row.type === 'new'), []);
  assert.deepEqual(rows.filter(row => row.type === 'same').map(row => row.text), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<topic id="topic-id">',
    '  <title>Title</title>',
    '  <body>',
    '    <p>Keep one</p>',
    '    <p>Keep three</p>',
    '    <p>Keep four</p>',
    '  </body>',
    '</topic>'
  ]);
});

test('opening and committing an unchanged Author view keeps source bytes intact', () => {
  const source = [
    "<?xml version='1.0' encoding='UTF-8'?>",
    '<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">',
    '<?review preserve="yes"?>',
    "<topic id='original' outputclass = 'manual'>",
    '  <title>Unchanged &amp; untouched</title>',
    '  <body>',
    '    <!-- This comment has no editable visual node. -->',
    '    <p>Keep  original <b>inline</b> <i>spacing</i>.</p>',
    "    <image href='diagram.svg' />",
    '  </body>',
    '</topic>'
  ].join('\r\n');
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  app.visualToXml();

  const file = app.state.filesMap.get('topic.dita');
  assert.equal(file.current, source);
  assert.equal(file.dirty, false);
});

test('deleting a middle code line changes only that source line in review', () => {
  const source = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<topic id="code">',
    '  <title>Code sample</title>',
    '  <body>',
    '    <codeblock outputclass="language-js">const first = 1;',
    'const remove = 2;',
    'const last = 3;</codeblock>',
    '    <p>Following paragraph stays untouched.</p>',
    '  </body>',
    '</topic>'
  ].join('\r\n');
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  const code = app.dom.visualEditor.querySelector('pre');
  code.textContent = code.textContent.replace('const remove = 2;\r\n', '');
  app.visualToXml();

  const current = app.state.filesMap.get('topic.dita').current;
  assert.equal(current, source.replace('const remove = 2;\r\n', ''));
  const rows = lineDiff(source, current);
  assert.deepEqual(rows.filter(row => row.type === 'old').map(row => row.text), ['const remove = 2;']);
  assert.deepEqual(rows.filter(row => row.type === 'new'), []);
});

test('deleting a nested paragraph retains the layout and nodes after it', () => {
  const source = [
    '<topic id="nested">',
    '  <title>Nested document</title>',
    '  <body>',
    '    <section id="first">',
    '      <title>First section</title>',
    '      <p id="remove">Delete this paragraph.</p>',
    '      <p id="keep">Keep <b>this</b> paragraph.</p>',
    '      <section id="nested-section">',
    '        <title>Nested section</title>',
    '        <p>Nested content.</p>',
    '      </section>',
    '    </section>',
    '    <section id="later">',
    '      <title>Later section</title>',
    '      <p>Later content.</p>',
    '    </section>',
    '  </body>',
    '</topic>'
  ].join('\n');
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  app.dom.visualEditor.querySelector('p').remove();
  app.visualToXml();

  const current = app.state.filesMap.get('topic.dita').current;
  assert.equal(current, source.replace('      <p id="remove">Delete this paragraph.</p>\n', ''));
  const rows = lineDiff(source, current);
  assert.deepEqual(rows.filter(row => row.type === 'old').map(row => row.text), ['      <p id="remove">Delete this paragraph.</p>']);
  assert.deepEqual(rows.filter(row => row.type === 'new'), []);
});

test('a local Author edit retains CRLF, comments, inline spaces, and no final newline', () => {
  const source = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<topic id="comments">',
    '  <title>Comments</title>',
    '  <body>',
    '    <!-- Keep this source-only explanation. -->',
    '    <p>Change this paragraph.</p>',
    '    <?review keep="processing instruction"?>',
    '    <p>Keep  <b>bold</b> <i>italic</i>  spacing.</p>',
    "    <image href='diagram.svg' />",
    '    <!-- Keep the final comment too. -->',
    '  </body>',
    '</topic>'
  ].join('\r\n');
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  app.dom.visualEditor.querySelector('p').textContent = 'Edited paragraph.';
  app.visualToXml();

  const current = app.state.filesMap.get('topic.dita').current;
  assert.equal(current, source.replace('Change this paragraph.', 'Edited paragraph.'));
  assert.deepEqual(lineDiff(source, current).filter(row => row.type === 'old').map(row => row.text), ['    <p>Change this paragraph.</p>']);
  assert.deepEqual(lineDiff(source, current).filter(row => row.type === 'new').map(row => row.text), ['    <p>Edited paragraph.</p>']);
});

test('editing inline content preserves the spaces between adjacent inline elements', () => {
  const source = '<topic><title>Inline text</title><body><p>Read <b>this</b> <i>first</i> before continuing.</p></body></topic>';
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  const inline = app.dom.visualEditor.querySelectorAll('span');
  inline.find(node => node.getAttribute('data-dita-source') === 'b').textContent = 'that';
  app.visualToXml();

  assert.equal(app.state.filesMap.get('topic.dita').current, source.replace('<b>this</b>', '<b>that</b>'));
});

test('code edits retain whitespace changes and deleting all paragraph text works', () => {
  const source = '<topic><title>T</title><body><codeblock>first();\n\nnext();</codeblock><p>Remove text</p></body></topic>';
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  app.dom.visualEditor.querySelector('pre').textContent = 'first();\n    next();';
  app.visualToXml();
  app.dom.visualEditor.querySelector('p').textContent = '';
  app.visualToXml();
  assert.equal(app.state.filesMap.get('topic.dita').current, source.replace('first();\n\nnext();', 'first();\n    next();').replace('<p>Remove text</p>', '<p></p>'));
});

test('inserting then editing a visual paragraph preserves the identities of following nodes', () => {
  const source = "<topic>\n  <title>T</title>\n  <body>\n    <p id='first'>First</p>\n    <p id='last' >Last</p>\n  </body>\n</topic>";
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  const body = app.dom.visualEditor.childNodes.find(node => node.hasAttribute?.('data-dita-body'));
  const inserted = app.document.createElement('p');
  inserted.textContent = 'New';
  body.insertBefore(inserted, body.firstChild);
  app.visualToXml();
  assert.equal(app.state.filesMap.get('topic.dita').current, source.replace("    <p id='first'>", "    <p>New</p>\n    <p id='first'>"));
  body.children[1].remove();
  app.visualToXml();
  body.children[1].textContent = 'Last edited';
  app.visualToXml();
  assert.equal(app.state.filesMap.get('topic.dita').current, source.replace("    <p id='first'>First</p>\n", '    <p>New</p>\n').replace('>Last</p>', '>Last edited</p>'));
});

test('deleting a duplicate table row retains the surviving row and entry attributes', () => {
  const source = '<topic><title>T</title><body><table><tgroup cols="1"><tbody><row id="r1"><entry id="c1">A</entry></row><row id="r2"><entry id="c2">A</entry></row></tbody></tgroup></table></body></topic>';
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  app.dom.visualEditor.querySelectorAll('tr')[0].remove();
  app.visualToXml();
  assert.equal(app.state.filesMap.get('topic.dita').current, source.replace('<row id="r1"><entry id="c1">A</entry></row>', ''));
  app.dom.visualEditor.querySelector('td').textContent = 'B';
  app.visualToXml();
  assert.equal(app.state.filesMap.get('topic.dita').current, source.replace('<row id="r1"><entry id="c1">A</entry></row>', '').replace('>A</entry>', '>B</entry>'));
});

test('visual renderer returns nodes accepted by element parents', () => {
  const { document } = buildMockDom();
  const doc = new DOMParser().parseFromString('<concept><title>T</title><conbody><shortdesc>S</shortdesc><section><p>P</p></section><p>Other</p></conbody></concept>', 'application/xml');
  const visual = document.createElement('div');
  for (const node of doc.documentElement.querySelector('conbody').childNodes) {
    const tag = node.localName;
    const known = node.nodeType === 3 || ['shortdesc','note','codeblock','image','table','ul','ol','sl','p','example','fig','section'].includes(tag || '');
    if (!known) continue;
    const rendered = renderDitaNode(node, document);
    if (rendered) visual.appendChild(rendered);
  }
  assert.equal(visual.nodeType, 1);
  assert.ok(!visual.childNodes.some(child => child.nodeType === 9));
  assert.ok(visual.textContent.includes('P'));
});

test('visual edits preserve mapped container source tags', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<concept id="concept-id">
  <title>Container title</title>
  <conbody>
    <section id="section-id"><title>Section</title><p>Section text</p></section>
    <example id="example-id"><title>Example</title><p>Example text</p></example>
  </conbody>
</concept>`;
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  app.dom.visualEditor.querySelector('p').textContent = 'Edited section';
  app.visualToXml();

  const file = app.state.filesMap.get('topic.dita');
  assert.ok(file.current.includes('<section id="section-id">'), file.current);
  assert.ok(file.current.includes('<example id="example-id">'), file.current);
  assert.ok(file.current.includes('<p>Edited section</p>'), file.current);
});

test('visual round trip preserves common task elements that have no special renderer', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<task id="task-id"><title>Task</title><taskbody><steps><step><cmd>Do this</cmd><info>Extra context</info></step></steps></taskbody></task>`;
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  assert.ok(app.dom.visualEditor.textContent.includes('Do this'));
  const findSource = (node, name) => {
    if (node?.getAttribute?.('data-dita-source') === name) return node;
    for (const child of node?.childNodes || []) {
      const match = findSource(child, name);
      if (match) return match;
    }
    return null;
  };
  findSource(app.dom.visualEditor, 'cmd').textContent = 'Do that';
  app.visualToXml();
  const file = app.state.filesMap.get('topic.dita');
  assert.ok(file.current.includes('<steps>'), file.current);
  assert.ok(file.current.includes('<step>'), file.current);
  assert.ok(file.current.includes('<cmd>Do that</cmd>'), file.current);
  assert.ok(file.current.includes('<info>Extra context</info>'), file.current);
});

test('visual table edits retain title, tgroup metadata, and header rows', () => {
  const source = `<?xml version="1.0" encoding="UTF-8"?>
<topic><title>Table</title><body><table id="tbl"><title>Caption</title><tgroup cols="2" outputclass="wide"><colspec colname="c1"/><colspec colname="c2"/><thead><row><entry>Head A</entry><entry>Head B</entry></row></thead><tbody><row><entry>Cell A</entry><entry>Cell B</entry></row></tbody></tgroup></table></body></topic>`;
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  const findSource = (node, name) => {
    if (node?.getAttribute?.('data-dita-source') === name) return node;
    for (const child of node?.childNodes || []) {
      const match = findSource(child, name);
      if (match) return match;
    }
    return null;
  };
  const table = findSource(app.dom.visualEditor, 'table');
  assert.ok(table.querySelector('h3'));
  table.querySelector('tbody').querySelector('td').textContent = 'Edited cell';
  app.visualToXml();
  const file = app.state.filesMap.get('topic.dita');
  assert.ok(file.current.includes('<title>Caption</title>'), file.current);
  assert.ok(file.current.includes('outputclass="wide"'), file.current);
  assert.ok(file.current.includes('<colspec colname="c1"/>'), file.current);
  assert.ok(file.current.includes('<thead>'), file.current);
  assert.ok(file.current.includes('<entry>Edited cell</entry>'), file.current);
});


test('Author text edits preserve footnote content, links and model metadata', () => {
  const source = '<topic><title>T</title><body><p>Before<fn id="n" product="M100">Keep <xref href="other.dita">link</xref>.</fn> after.</p></body></topic>';
  const app = createTestApp(source);
  app.updateVisualFromXml(source);
  const p = app.dom.visualEditor.querySelector('p');
  p.firstChild.data = 'Edited';
  app.visualToXml();
  assert.equal(app.state.filesMap.get('topic.dita').current, source.replace('Before', 'Edited'));
});

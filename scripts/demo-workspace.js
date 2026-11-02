'use strict';
const fs = require('node:fs'), path = require('node:path'), iconv = require('iconv-lite');
const xml = require('../public/xml-source'), refs = require('../public/publication-resolver');
// Build one manual's dependency closure; avoid copying an entire content library.
function collectDemoFiles(directory, manual) {
  const files = new Map(), root = fs.realpathSync(directory);
  function add(relative) {
    if (files.has(relative)) return;
    const absolute = fs.realpathSync(path.resolve(root, relative));
    if (!absolute.startsWith(root + path.sep)) throw new Error('演示引用超出文档库：' + relative);
    const bytes = fs.readFileSync(absolute); files.set(relative, bytes);
    if (!/\.(dita|ditamap|xml)$/i.test(relative)) return;
    const encoding = bytes.toString('ascii', 0, 200).match(/encoding\s*=\s*["']([^"']+)/i)?.[1] || 'utf8';
    const source = iconv.decode(bytes, encoding);
    refs.walk(xml.inspectSource(source), node => {
      for (const key of ['href', 'conref']) {
        const value = refs.decode(node.attrs[key] || '');
        if (!value || node.attrs.scope === 'external' || /^[a-z][a-z\d+.-]*:/i.test(value)) continue;
        add(refs.localTarget(value, relative).path);
      }
    });
  }
  add(manual);
  if (fs.existsSync(path.join(root, '.dita-project.json'))) add('.dita-project.json');
  const filters = path.join(root, 'filters');
  if (fs.existsSync(filters)) for (const entry of fs.readdirSync(filters)) if (/\.ditaval$/i.test(entry)) add('filters/' + entry);
  return files;
}
module.exports = { collectDemoFiles };

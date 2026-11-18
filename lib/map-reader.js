'use strict';
const path = require('node:path');
const { childElement, textOf } = require('./xml-tree');
const references = require('../public/reference-paths');
const mapContext = require('../public/map-context');

// A missing reference must remain missing. Searching for a matching basename
// can silently publish an archived or unrelated Topic instead of the target.
function resolveMapHref(mapPath, href) {
  const target = references.resolve(mapPath, href);
  if (!target) throw Object.assign(new Error('Map 引用须为工作区内的相对路径：' + href), { status: 400 });
  return target.path;
}

function createMapReader(resolveHref = resolveMapHref) {
  function title(node, fallback) {
    return textOf(childElement(childElement(node, 'topicmeta'), 'navtitle')).trim() || textOf(childElement(node, 'title')).trim() || node.attrs.navtitle || fallback;
  }
  function children(node, mapPath, sourcePath = '', parentContext) {
    const context = mapContext.inherit(node.attrs, parentContext);
    const result = []; let index = -1;
    for (const child of node.children) {
      if (child.type !== 'element') continue; index++;
      if (!mapContext.isReference(child.name)) continue;
      const key = sourcePath ? sourcePath + '.' + index : String(index), childContext = mapContext.inherit(child.attrs, context);
      const nested = children(child, mapPath, key, context);
      // This tree is a local document inventory, not a web-link reader. Keep
      // external links in the source, and retain explicitly local descendants
      // with their original source paths when omitting an external ancestor.
      if (childContext.scope === 'external') { result.push(...nested); continue; }
      const target = child.attrs.href ? resolveHref(mapPath, child.attrs.href) : null;
      if (target || nested.length || !child.attrs.href) result.push({ type: target ? 'file' : 'container', title: title(child, target ? path.basename(target) : child.name), path: target || child.attrs.href || '', sourcePath: key, processingRole: childContext.processingRole, children: nested });
    }
    return result;
  }
  function describe(node, mapPath) {
    return { path: mapPath, name: path.basename(mapPath), title: textOf(childElement(childElement(node, 'booktitle'), 'mainbooktitle')).trim() || textOf(childElement(node, 'title')).trim() || path.basename(mapPath), children: children(node, mapPath) };
  }
  return { title, children, describe };
}
module.exports = { createMapReader, resolveMapHref };

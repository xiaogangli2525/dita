'use strict';
const path = require('node:path');
const { childElement, textOf } = require('./xml-tree');
function createMapReader(resolveHref) {
  function title(node, fallback) {
    return textOf(childElement(childElement(node, 'topicmeta'), 'navtitle')).trim() || textOf(childElement(node, 'title')).trim() || node.attrs.navtitle || fallback;
  }
  function children(node, mapPath, sourcePath = '', processingRole = 'normal') {
    processingRole = node.attrs['processing-role'] || processingRole;
    const result = []; let index = -1;
    for (const child of node.children) {
      if (child.type !== 'element') continue; index++;
      if (!['topicref', 'topichead', 'topicgroup', 'chapter', 'appendix', 'notices', 'preface', 'part', 'frontmatter', 'backmatter', 'booklists'].includes(child.name)) continue;
      const key = sourcePath ? sourcePath + '.' + index : String(index), role = child.attrs['processing-role'] || processingRole;
      const nested = children(child, mapPath, key, role), target = child.attrs.href ? resolveHref(mapPath, child.attrs.href) : null;
      if (target || nested.length || !child.attrs.href) result.push({ type: target ? 'file' : 'container', title: title(child, target ? path.basename(target) : child.name), path: target || child.attrs.href || '', sourcePath: key, processingRole: role, children: nested });
    }
    return result;
  }
  function describe(node, mapPath) {
    return { path: mapPath, name: path.basename(mapPath), title: textOf(childElement(childElement(node, 'booktitle'), 'mainbooktitle')).trim() || textOf(childElement(node, 'title')).trim() || path.basename(mapPath), children: children(node, mapPath) };
  }
  return { title, children, describe };
}
module.exports = { createMapReader };

'use strict';
(function (root) {
  const publication = typeof module !== 'undefined' ? require('./publication-core') : root.DitaPublication;
  function createDeliveryCore({ parseXml, normalizeOxyPIs, resolveAssetPath }) {
    const _ctx = { topicPath: '', imageDataCache: new Map(), mdFootnotes: [] };
const PREVIEW_TOPIC_EXTENSIONS = /\.(dita|xml)$/i;

function collectPreviewPaths(nodes, paths = [], seen = new Set()) {
  for (const node of nodes || []) {
    if (node.type === 'file' && node.processingRole !== 'resource-only' && PREVIEW_TOPIC_EXTENSIONS.test(node.path) && !seen.has(node.path)) {
      seen.add(node.path);
      paths.push({ path: node.path, title: node.title || node.path });
    }
    if (node.children) collectPreviewPaths(node.children, paths, seen);
  }
  return paths;
}

function escapeHtmlAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DITA_HTML_MAP = {
  'topic': 'div', 'concept': 'div', 'reference': 'div', 'task': 'div',
  'body': 'div', 'conbody': 'div', 'refbody': 'div', 'taskbody': 'div',
  'section': 'section', 'example': 'section', 'fig': 'figure',
  'p': 'p', 'title': 'h2', 'shortdesc': 'p',
  'note': 'div', 'codeblock': 'pre', 'codeph': 'code', 'filepath': 'code',
  'varname': 'code', 'parmname': 'code', 'msgph': 'code',
  'sl': 'ul', 'sli': 'li', 'ul': 'ul', 'ol': 'ol', 'li': 'li',
  'dl': 'dl', 'dlentry': 'div', 'dt': 'dt', 'dd': 'dd',
  'simpletable': 'table', 'sthead': 'tr', 'strow': 'tr', 'stentry': 'td',
  'table': 'table', 'tgroup': 'div', 'thead': 'thead', 'tbody': 'tbody',
  'row': 'tr', 'entry': 'td',
  'xref': 'a', 'cite': 'cite', 'keyword': 'span', 'term': 'span',
  'ph': 'span', 'b': 'strong', 'i': 'em', 'u': 'u', 'sup': 'sup', 'sub': 'sub',
  'q': 'q', 'boolean': 'span', 'state': 'span',
  'image': 'img', 'object': 'div', 'pre': 'pre', 'lines': 'pre',
  'menucascade': 'span', 'uicontrol': 'span', 'wintitle': 'span',
  'fn': 'sup', 'abbreviated-form': 'span'
};

const DITA_INLINE_TAGS = new Set([
  'codeph', 'filepath', 'varname', 'parmname', 'msgph', 'keyword', 'term',
  'xref', 'cite', 'ph', 'b', 'i', 'u', 'sup', 'sub', 'q', 'boolean', 'state',
  'menucascade', 'uicontrol', 'wintitle', 'fn', 'abbreviated-form'
]);

function topicIdOf(node) {
  while (node?.nodeType === 1) {
    if (['topic', 'concept', 'task', 'reference'].includes(node.localName)) return node.getAttribute('id') || '';
    node = node.parentNode;
  }
  return '';
}
function publicationAnchors(prepared, entries) {
  const anchors = new Map();
  entries.forEach((entry, index) => {
    const base = 'sec-' + index;
    anchors.set(entry.path + '#', base);
    const doc = parseXml(prepared.files.get(entry.path).current);
    const nodes = [];
    const visit = node => { if (node.localName === 'fn') return; if (node.nodeType === 1 && node.getAttribute('id')) nodes.push(node); Array.from(node.childNodes || []).forEach(visit); };
    visit(doc);
    for (const node of nodes) {
      if (node.localName === 'fn') continue;
      const id = node.getAttribute('id');
      const isTopic = ['topic', 'concept', 'task', 'reference'].includes(node.localName);
      const fragment = isTopic ? id : topicIdOf(node) + '/' + id;
      anchors.set(entry.path + '#' + fragment, node === doc.documentElement || node.localName === 'title' && node.parentNode === doc.documentElement ? base : base + '-node-' + encodeURIComponent(fragment));
    }
  });
  return anchors;
}
function publicationAnchor(node, ctx) {
  if (node.nodeType !== 1 || !node.getAttribute('id')) return '';
  const id = node.getAttribute('id');
  const fragment = ['topic', 'concept', 'task', 'reference'].includes(node.localName) ? id : topicIdOf(node) + '/' + id;
  return ctx.anchors?.get(ctx.topicPath + '#' + fragment) || '';
}
function publicationLink(node, ctx) {
  const href = node.getAttribute('href') || '';
  if (/^(https?:|mailto:|tel:|ftp:)/i.test(href)) return href;
  if (!href) return '';
  const resolver = typeof module !== 'undefined' ? require('./publication-resolver') : window.DitaPublicationResolver;
  const target = resolver.localTarget(href, ctx.topicPath);
  if (!/\.(dita|xml)$/i.test(target.path)) throw new Error('链接资源无法打包进单文件手册：' + href);
  const anchor = ctx.anchors?.get(target.path + '#' + target.fragment);
  if (!anchor) throw new Error('链接目标未包含在当前手册或不存在：' + href);
  ctx.linkedAnchors = ctx.linkedAnchors || new Map();
  ctx.linkedAnchors.set(anchor, ctx.topicPath + '：' + href);
  return '#' + anchor;
}
function validatePublicationLinks(output, ctx) {
  for (const [anchor, source] of ctx.linkedAnchors || []) if (!output.includes('id="' + escapeHtmlAttr(anchor) + '"')) throw new Error('链接目标无法在所选格式中定位（可尝试 HTML）：' + source);
}
function publicationDefinitions(prepared) {
  return new Map(Array.from(prepared.noteDefinitions, ([key, note]) => [key, { node: parseXml(note.xml).documentElement, path: note.path }]));
}
function footnoteReference(node, ctx) {
  let target = node, origin = ctx.topicPath;
  if (node.localName === 'fn' && node.getAttribute('id')) return null;
  if (node.localName === 'xref') {
    const key = publication.referenceKey(node.getAttribute('href') || '', ctx.topicPath, topicIdOf(node));
    const definition = ctx.noteDefinitions?.get(key);
    target = definition?.node; origin = definition?.path;
    if (!target) throw new Error('找不到注脚引用：' + key);
  }
  ctx.noteNumbers = ctx.noteNumbers || new Map();
  let entry = ctx.noteNumbers.get(target);
  if (!entry) { entry = { node: target, path: origin, number: ctx.noteNumbers.size + 1, refs: 0 }; ctx.noteNumbers.set(target, entry); }
  entry.refs++;
  return entry;
}

function ditaToHtml(node, ctx) {
  ctx = ctx || _ctx;
  if (node.nodeType === 3) return node.data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (node.nodeType === 7) return '';
  if (node.nodeType === 8) return '<!--' + node.data + '-->';
  if (node.nodeType !== 1) return '';
  const tag = node.localName;
  if (tag === 'oxy_options') return '';
  if (tag === 'ins' && (node.getAttribute('class') || '').includes('oxy-insert')) {
    return '<ins class="oxy-insert">' + Array.from(node.childNodes).map(function(n) { return ditaToHtml(n, ctx); }).join('') + '</ins>';
  }
  if (tag === 'del' && (node.getAttribute('class') || '').includes('oxy-delete')) {
    return '<del class="oxy-delete">' + escapeHtmlAttr(node.textContent) + '</del>';
  }
  if (tag === 'span' && (node.getAttribute('class') || '').includes('oxy-comment')) {
    const comment = node.getAttribute('data-comment') || '';
    const author = node.getAttribute('data-author') || '';
    const title = author ? author + ': ' + comment : comment;
    return '<span class="oxy-comment" title="' + escapeHtmlAttr(title) + '">' + Array.from(node.childNodes).map(function(n) { return ditaToHtml(n, ctx); }).join('') + '</span>';
  }
  if (tag === 'fn' || tag === 'xref' && node.getAttribute('type') === 'fn') {
    const entry = footnoteReference(node, ctx);
    if (!entry) return '';
    const { node: target, number: n, refs } = entry;
    ctx.htmlFootnotes = ctx.htmlFootnotes || [];
    if (refs === 1) {
      const models = target.getAttribute('product');
      const label = models ? '<small>适用型号：' + escapeHtmlAttr(models) + '</small> ' : '';
      ctx.htmlFootnotes.push('');
      const origin = ctx.topicPath; ctx.topicPath = entry.path;
      try { ctx.htmlFootnotes[n - 1] = label + Array.from(target.childNodes).map(child => ditaToHtml(child, ctx)).join(''); }
      finally { ctx.topicPath = origin; }
    }
    const callout = target.getAttribute('callout') || String(n);
    return '<sup class="fn-ref" id="fnref-' + n + '-' + refs + '"><a href="#fn-' + n + '">[' + escapeHtmlAttr(callout) + ']</a></sup>';
  }
  if (tag === 'image') {
    const href = node.getAttribute('href') || '';
    const alt = node.getAttribute('alt') || '';
    const resolved = resolveAssetPath(href, ctx);
    const src = ctx.imageDataCache.has(resolved) ? ctx.imageDataCache.get(resolved) : /^(https?:|data:)/i.test(resolved) ? resolved : '/api/asset?path=' + encodeURIComponent(resolved);
    const anchor = publicationAnchor(node, ctx);
    return '<img' + (anchor ? ' id="' + escapeHtmlAttr(anchor) + '"' : '') + ' src="' + escapeHtmlAttr(src) + '" alt="' + escapeHtmlAttr(alt) + '" style="max-width:100%;"/>';
  }
  if (tag === 'xref') {
    const href = publicationLink(node, ctx);
    const anchor = publicationAnchor(node, ctx);
    return '<a' + (anchor ? ' id="' + escapeHtmlAttr(anchor) + '"' : '') + ' href="' + escapeHtmlAttr(href) + '">' + Array.from(node.childNodes).map(function(n) { return ditaToHtml(n, ctx); }).join('') + '</a>';
  }
  if (tag === 'tgroup' || tag === 'colspec') return tag === 'tgroup' ? Array.from(node.childNodes).map(child => ditaToHtml(child, ctx)).join('') : '';
  const htmlTag = DITA_HTML_MAP[tag] || 'div';
  const attrs = [];
  const anchor = publicationAnchor(node, ctx);
  if (anchor) attrs.push('id="' + escapeHtmlAttr(anchor) + '"');
  if (tag === 'entry') {
    const rows = Number(node.getAttribute('morerows'));
    if (rows > 0) attrs.push('rowspan="' + (rows + 1) + '"');
    const start = node.getAttribute('namest'), end = node.getAttribute('nameend');
    if (start || end) {
      let group = node.parentNode; while (group && group.localName !== 'tgroup') group = group.parentNode;
      const cols = Array.from(group?.childNodes || []).filter(n => n.localName === 'colspec').map(n => n.getAttribute('colname'));
      const a = cols.indexOf(start), b = cols.indexOf(end);
      if (a < 0 || b < a) throw new Error('表格列跨度无效');
      attrs.push('colspan="' + (b - a + 1) + '"');
    }
  }
  if (tag === 'codeblock') {
    const lang = (node.getAttribute('outputclass') || '').replace('language-', '');
    if (lang) attrs.push('data-lang="' + escapeHtmlAttr(lang) + '"');
  }
  const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
  const children = Array.from(node.childNodes).map(function(n) { return ditaToHtml(n, ctx); }).join('');
  if (!DITA_INLINE_TAGS.has(tag) && !children.trim()) return '';
  return '<' + htmlTag + attrStr + '>' + children + '</' + htmlTag + '>';
}

function serializeOxyNode(node, ctx) {
  return ditaToHtml(node, ctx);
}

async function exportMapToHtml({ map, files, title, loadImageBytes, model = '', version = '', publicationData }) {
  const prepared = publicationData || publication.preparePublication({ map, files, model }, collectPreviewPaths);
  files = prepared.files;
  const ctx = { topicPath: '', imageDataCache: new Map(), fnCounter: 0, mdFnCounter: 0, mdFootnotes: [] };
  ctx.noteDefinitions = publicationDefinitions(prepared);
  const entries = collectPreviewPaths(map.children || []);
  ctx.anchors = publicationAnchors(prepared, entries);
  const sections = [];
  const failures = [];
  ctx.imageDataCache = new Map();
  if (loadImageBytes) {
    const imagePaths = new Set();
    const imageEntries = [...entries.map(entry => ({ path: entry.path, current: files.get(entry.path)?.current })), ...Array.from(prepared.noteDefinitions.values(), note => ({ path: note.path, current: note.xml }))];
    for (const entry of imageEntries) {
      try {
        const cached = entry;
        if (!cached) throw new Error('not loaded');
        const preDoc = parseXml(cached.current);
        ctx.topicPath = entry.path;
        for (const img of preDoc.querySelectorAll('image')) {
          const r2 = resolveAssetPath(img.getAttribute('href') || '', ctx);
          if (r2 && !/^(https?:|data:|\x2f)/i.test(r2)) imagePaths.add(r2);
        }
      } catch (e) { console.warn('image pre-fetch parse error:', e.message); }
    }
    await Promise.all(Array.from(imagePaths).map(async (p) => {
      try {
        const dataUri = await loadImageBytes(p);
        if (dataUri) ctx.imageDataCache.set(p, dataUri);
      } catch (e) { console.warn('image fetch failed:', p, e.message); }
    }));
  }
  for (const entry of entries) {
    try {
      const cached = files.get(entry.path);
      if (!cached) throw new Error('not loaded');
      ctx.topicPath = entry.path;
      const doc = parseXml(cached.current);
      normalizeOxyPIs(doc);
      const topic = doc.documentElement;
      const topicTitle = Array.from(topic?.childNodes || []).find(n => n.localName === 'title');
      let inner = '';
      for (const child of topic?.childNodes || []) {
        if (child === topicTitle) continue;
        inner += serializeOxyNode(child, ctx);
      }
      let fnNum = 0;
      inner = inner.replace(/\[fn\]/g, () => "[" + (++fnNum) + "]");
      inner = inner.replace(/<div class="note([\s\S]*?)<\/div>/g, (match) => {
        if (match.includes('note-icon')) return match;
        const typeMatch = match.match(/data-note-type="([^"]*)"/);
        const noteType = typeMatch ? typeMatch[1] : 'note';
        const icons = { note: 'ℹ', tip: '💡', caution: '⚠️', warning: '⛔', restriction: '⛔', attention: '⚠️', important: '❗' };
        const icon = icons[noteType] || '\u2139';
        return '<div class="dita-note dita-note-' + noteType + '"><span class="note-icon">' + icon + '</span><div class="note-body">' + match.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '') + '</div></div>';
      });
      inner = inner.replace(/<codeblock\b/g, '<pre class="code-block"\u200b');
      inner = inner.replace(/<pre class="code-block"\u200b/g, '<pre class="code-block"');
      sections.push({ path: entry.path, title: topicTitle?.textContent?.trim() || entry.title || entry.path, body: inner });
    } catch (error) {
      throw new Error(entry.path + '：' + error.message);
    }
  }
  const css = [
    'body { font-family: Segoe UI, Microsoft YaHei, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #202124; line-height: 1.7; }',
    'h1 { font-size: 28px; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; }',
    'h2 { font-size: 22px; color: #1a73e8; margin-top: 32px; border-bottom: 1px solid #e4e7ea; padding-bottom: 6px; }',
    'h3 { font-size: 18px; color: #385667; margin-top: 24px; }',
    'hr { border: none; border-top: 1px solid #e4e7ea; margin: 32px 0; }',
    'pre { background: #f8f9fa; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }',
    'code { font-family: Consolas, Courier New, monospace; font-size: 0.9em; }',
    'code.filepath { color: #c5221f; background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }',
    'sup.fn-ref { font-size: 0.8em; color: #1a73e8; cursor: pointer; }',
    'ins.oxy-insert { background: #e6f4ea; border-bottom: 2px solid #34a853; text-decoration: none; }',
    'del.oxy-delete { background: #fce8e6; text-decoration: line-through; color: #d93025; }',
    'span.oxy-comment { border-bottom: 2px dotted #4285f4; cursor: help; background: rgba(66,133,244,0.08); }',
    'table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 14px; }',
    'th, td { border: 1px solid #cbd5dd; padding: 7px 9px; vertical-align: top; }',
    'th { background: #eef2f5; }',
    'dl { margin: 10px 0; padding-left: 16px; }',
    'dt { font-weight: 600; color: #385667; }',
    'dd { margin: 2px 0 6px 16px; }',
    '.toc { background: #f8f9fa; padding: 16px 20px; border-radius: 8px; margin-bottom: 28px; }',
    '.toc h2 { font-size: 18px; margin-top: 0; border: none; }',
    '.toc ol { padding-left: 20px; margin: 8px 0; }',
    '.toc a { color: #1a73e8; text-decoration: none; }',
    '.toc a:hover { text-decoration: underline; }',
    '.error { color: #d93025; font-size: 13px; }',
    '.dita-note { display: flex; gap: 10px; padding: 12px 16px; margin: 14px 0; border-radius: 6px; border-left: 4px solid #4285f4; background: #e8f0fe; }',
    '.dita-note .note-icon { font-size: 16px; flex-shrink: 0; margin-top: 2px; }',
    '.dita-note .note-body { flex: 1; }',
    '.dita-note .note-body ul, .dita-note .note-body ol { margin: 4px 0; padding-left: 20px; }',
    '.dita-note.dita-note-tip { border-color: #34a853; background: #e6f4ea; }',
    '.dita-note.dita-note-caution, .dita-note.dita-note-warning { border-color: #d93025; background: #fce8e6; }',
    '.dita-note.dita-note-important { border-color: #f9ab00; background: #fef7e0; }',
    '.code-block { background: #1e1e2e; color: #cdd6f4; padding: 14px 18px; border-radius: 8px; overflow-x: auto; font-family: Consolas, Fira Code, monospace; font-size: 13px; line-height: 1.55; tab-size: 4; }',
    '.code-block code { color: inherit; font-size: inherit; background: none; padding: 0; }',
    '.dita-note .code-block { background: #282838; margin: 8px 0; }',
    'figure { margin: 16px 0; text-align: center; }',
    'figure figcaption, .figtitle { font-size: 13px; color: #5f6368; margin-top: 8px; font-style: italic; }',
    'section { margin: 20px 0; }'

  ].join('\n');
  let toc = '<nav class="toc"><h2>\u76ee\u5f55</h2><ol>';
  sections.forEach((sec, i) => { toc += '<li><a href="#sec-' + i + '">' + escapeHtmlAttr(sec.title) + '</a></li>'; });
  toc += '</ol></nav>';
  let body = '';
  sections.forEach((sec, i) => {
    body += '<h2 id="sec-' + i + '" style="scroll-margin-top: 20px;">' + escapeHtmlAttr(sec.title) + '</h2>\n' + sec.body + '\n';
    if (i < sections.length - 1) body += '<hr>\n';
  });
  if (ctx.htmlFootnotes?.length) body += '<section class="export-footnotes"><h2>注脚</h2><ol>' + ctx.htmlFootnotes.map((text, i) => '<li id="fn-' + (i + 1) + '">' + text + ' <a href="#fnref-' + (i + 1) + '-1" aria-label="返回正文">↩</a></li>').join('') + '</ol></section>';
  let failuresHtml = '';
  if (failures.length) failuresHtml = '<p class="error">\u4ee5\u4e0b topic \u52a0\u8f7d\u5931\u8d25\uff1a' + failures.map(escapeHtmlAttr).join(', ') + '</p>';
  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN"><head><meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
    '<title>' + escapeHtmlAttr(title || map.title || map.path) + '</title>',
    '<style>' + css + '</style></head><body>',
    '<h1>' + escapeHtmlAttr(title || map.title || map.path) + '</h1>',
    model ? '<p class="publication-scope">适用型号：' + escapeHtmlAttr(model) + '。</p>' : '',
    version ? '<p>文档版本：' + escapeHtmlAttr(version) + '</p>' : '',
    toc,
    body,
    failuresHtml,
    '</body></html>'
  ].join('\n');
  validatePublicationLinks(html, ctx);
  return html;
}

function mdEscape(text) {
  return String(text || '').replace(/([\\`*{}\[\]()#+\-.!])/g, '\\$1');
}

function markdownFootnote(node, ctx) {
  const entry = footnoteReference(node, ctx);
  if (!entry) return '';
  const { node: target, number: index, refs } = entry;
  ctx.mdFootnotes = ctx.mdFootnotes || [];
  if (refs === 1) {
    const models = target.getAttribute('product');
    const origin = ctx.topicPath; ctx.topicPath = entry.path;
    let content;
    try { content = (models ? '**适用型号：' + mdEscape(models) + '。** ' : '') + Array.from(target.childNodes).map(child => mdInline(child, ctx)).join(''); }
    finally { ctx.topicPath = origin; }
    ctx.mdFootnotes.push('[^' + index + ']: ' + content.trim().replace(/\n/g, '\n    '));
  }
  return '[^' + index + ']';
}

function mdInline(node, ctx) {
  ctx = ctx || _ctx;
  const anchor = publicationAnchor(node, ctx);
  return (anchor ? '<a id="' + escapeHtmlAttr(anchor) + '"></a>' : '') + renderMdInline(node, ctx);
}
function renderMdInline(node, ctx) {
  ctx = ctx || _ctx;
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1) return '';
  const tag = node.localName;
  const inner = () => Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('');
  if (tag === 'b') return '**' + inner() + '**';
  if (tag === 'i') return '*' + inner() + '*';
  if (tag === 'u') return inner();
  if (tag === 'sup') return '<sup>' + inner() + '</sup>';
  if (tag === 'sub') return '<sub>' + inner() + '</sub>';
  if (['codeph', 'filepath', 'varname', 'parmname', 'msgph'].includes(tag)) return '`' + node.textContent + '`';
  if (tag === 'xref' && node.getAttribute('type') === 'fn') return markdownFootnote(node, ctx);
  if (tag === 'xref') { const h = publicationLink(node, ctx); return '[' + inner() + '](' + h + ')'; }
  if (tag === 'image') { const resolved = resolveAssetPath(node.getAttribute('href') || '', ctx); const a = node.getAttribute('alt') || ''; const src = ctx.imageDataCache.has(resolved) ? ctx.imageDataCache.get(resolved) : resolved; return '![' + a + '](' + src + ')'; }
  if (tag === 'fn') return markdownFootnote(node, ctx);
  if (tag === 'ins' && (node.getAttribute('class') || '').includes('oxy-insert')) return '**' + inner() + '**';
  if (tag === 'del' && (node.getAttribute('class') || '').includes('oxy-delete')) return '~~' + node.textContent + '~~';
  if (tag === 'span' && (node.getAttribute('class') || '').includes('oxy-comment')) { const c = node.getAttribute('data-comment') || ''; return '<!-- ' + c + ' -->'; }
  if (tag === 'oxy_options') return '';
  return inner();
}



function ditaToMarkdown(node, ctx) {
  ctx = ctx || _ctx;
  const anchor = publicationAnchor(node, ctx);
  return (anchor ? '<a id="' + escapeHtmlAttr(anchor) + '"></a>\n' : '') + renderDitaMarkdown(node, ctx);
}
function renderDitaMarkdown(node, ctx) {
  ctx = ctx || _ctx;
  if (node.nodeType === 3) { const t = node.data.replace(/\s+/g, ' '); return t; }
  if (node.nodeType === 7 || node.nodeType === 8) return '';
  if (node.nodeType !== 1) return '';
  const tag = node.localName;
  if (tag === 'oxy_options') return '';
  const children = () => Array.from(node.childNodes).map(function(n) { return ditaToMarkdown(n, ctx); }).join('');

  if (tag === 'title') return '\n## ' + node.textContent.trim() + '\n\n';
  if (tag === 'p') { const t = Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim(); return t ? t + '\n\n' : ''; }
  if (tag === 'shortdesc') { const t = Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim(); return t ? '> ' + t + '\n\n' : ''; }

  if (tag === 'ul' || tag === 'sl') return mdList(node, false, ctx);
  if (tag === 'ol') return mdList(node, true, ctx);

  if (tag === 'codeblock') {
    const lang = (node.getAttribute('outputclass') || '').replace('language-', '');
    return '\n```' + lang + '\n' + node.textContent.replace(/\n$/, '') + '\n```\n\n';
  }
  if (tag === 'pre' || tag === 'lines') return '\n```\n' + node.textContent.replace(/\n$/, '') + '\n```\n\n';

  if (tag === 'note') {
    const type = node.getAttribute('type') || 'note';
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    const body = Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim();
    return '> **' + label + ':** ' + body + '\n\n';
  }

  if (tag === 'image') {
    const href = node.getAttribute('href') || '';
    const a = node.getAttribute('alt') || '';
    const resolved = resolveAssetPath(href, ctx);
    const src = ctx.imageDataCache.has(resolved) ? ctx.imageDataCache.get(resolved) : resolved;
    return '![' + a + '](' + src + ')\n\n';
  }

  if (tag === 'xref' && node.getAttribute('type') === 'fn') return markdownFootnote(node, ctx);
  if (tag === 'xref') { const h = publicationLink(node, ctx); return '[' + Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('') + '](' + h + ')'; }

  if (tag === 'fig') {
    let r = '\n';
    for (const c of node.childNodes) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'title' || c.localName === 'figtitle') r += '*' + c.textContent.trim() + '*\n\n';
      else r += ditaToMarkdown(c, ctx);
    }
    return r;
  }

  if (tag === 'table' || tag === 'simpletable') return mdTable(node, ctx);
  if (tag === 'dl') return mdDl(node, ctx);

  if (tag === 'fn') return markdownFootnote(node, ctx);

  if (tag === 'section' || tag === 'example') {
    const tEl = Array.from(node.childNodes).find(n => n.localName === 'title');
    return (tEl ? '\n### ' + tEl.textContent.trim() + '\n\n' : '\n') + Array.from(node.childNodes).filter(child => child !== tEl).map(child => ditaToMarkdown(child, ctx)).join('');
  }

  if (['body', 'conbody', 'refbody', 'taskbody', 'topic', 'concept', 'reference', 'task'].includes(tag)) return children();
  if (['figgroup', 'ph', 'keyword', 'term', 'cite', 'q', 'boolean', 'state', 'menucascade', 'uicontrol', 'wintitle', 'abbreviated-form'].includes(tag)) return Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('');
  return children();
}



function mdList(node, ordered, ctx) {
  ctx = ctx || _ctx;
  const items = Array.from(node.childNodes).filter(n => n.localName === 'li' || n.localName === 'sli');
  if (!items.length) return '';
  let r = '';
  items.forEach((li, i) => {
    const prefix = ordered ? (i + 1) + '. ' : '- ';
    const text = Array.from(li.childNodes).filter(n => !['ul', 'ol'].includes(n.localName)).map(function(n) { return mdInline(n, ctx); }).join('').trim();
    const anchor = publicationAnchor(li, ctx);
    r += prefix + (anchor ? '<a id="' + escapeHtmlAttr(anchor) + '"></a>' : '') + text + '\n';
    // nested lists
    for (const c of li.childNodes) {
      if (c.localName === 'ul') r += ditaToMarkdown(c, ctx).split('\n').filter(Boolean).map(l => '  ' + l).join('\n') + '\n';
      if (c.localName === 'ol') r += ditaToMarkdown(c, ctx).split('\n').filter(Boolean).map(l => '  ' + l).join('\n') + '\n';
    }
  });
  return r + '\n';
}

function mdTable(node, ctx) {
  ctx = ctx || _ctx;
  const tgroup = Array.from(node.childNodes).find(n => n.localName === 'tgroup') || node;
  const thead = Array.from(tgroup.childNodes).find(n => n.localName === 'thead');
  const tbody = Array.from(tgroup.childNodes).find(n => n.localName === 'tbody') || tgroup;
  const headRows = node.localName === 'simpletable' ? Array.from(node.childNodes).filter(n => n.localName === 'sthead') : thead ? Array.from(thead.childNodes).filter(n => n.localName === 'row') : [];
  const bodyRows = Array.from(tbody.childNodes).filter(n => n.localName === 'row' || n.localName === 'strow');
  const allRows = [...headRows, ...bodyRows];
  if (!allRows.length) return '';
  if (allRows.some(row => Array.from(row.childNodes).some(cell => Number(cell.getAttribute?.('morerows')) > 0 || cell.getAttribute?.('namest') || cell.getAttribute?.('nameend')))) throw new Error('Markdown 表格不支持合并单元格，请选择 HTML 导出');
  const matrix = allRows.map(row => Array.from(row.childNodes).filter(n => n.localName === 'entry' || n.localName === 'stentry').map(e => Array.from(e.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim().replace(/\|/g, '\\\|')));
  const cols = Math.max(...matrix.map(r => r.length));
  let r = '\n';
  matrix.forEach((row, i) => {
    while (row.length < cols) row.push('');
    r += '| ' + row.join(' | ') + ' |\n';
    if (i === 0) r += '| ' + Array(cols).fill('---').join(' | ') + ' |\n';
  });
  return r + '\n';
}

function mdDl(node, ctx) {
  ctx = ctx || _ctx;
  const entries = Array.from(node.childNodes).filter(n => n.localName === 'dlentry');
  if (!entries.length) return '';
  let r = '\n';
  for (const entry of entries) {
    const dt = Array.from(entry.childNodes).find(n => n.localName === 'dt');
    const dd = Array.from(entry.childNodes).find(n => n.localName === 'dd');
    if (dt) r += '**' + dt.textContent.trim() + '**\n';
    if (dd) r += ': ' + Array.from(dd.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim() + '\n\n';
  }
  return r;
}

async function exportMapToMarkdown({ map, files, title, loadImageBytes, model = '', version = '', publicationData }) {
  const prepared = publicationData || publication.preparePublication({ map, files, model }, collectPreviewPaths);
  files = prepared.files;
  const ctx = { topicPath: '', imageDataCache: new Map(), fnCounter: 0, mdFnCounter: 0, mdFootnotes: [] };
  ctx.mdFnCounter = 0;
  ctx.mdFootnotes = [];
  ctx.noteDefinitions = publicationDefinitions(prepared);
  const entries = collectPreviewPaths(map.children || []);
  ctx.anchors = publicationAnchors(prepared, entries);
  const sections = [];
  const failures = [];
    if (loadImageBytes) {
    const imagePaths = new Set();
    const imageEntries = [...entries.map(entry => ({ path: entry.path, current: files.get(entry.path)?.current })), ...Array.from(prepared.noteDefinitions.values(), note => ({ path: note.path, current: note.xml }))];
    for (const entry of imageEntries) {
      try {
        const cached = entry;
        if (!cached) throw new Error('not loaded');
        const preDoc = parseXml(cached.current);
        ctx.topicPath = entry.path;
        for (const img of preDoc.querySelectorAll('image')) {
          const r = resolveAssetPath(img.getAttribute('href') || '', ctx);
          if (r && !/^(https?:|data:|\x2f)/i.test(r)) imagePaths.add(r);
        }
      } catch (e) { console.warn('warn:', e.message); }
    }
    await Promise.all(Array.from(imagePaths).map(async (p) => {
      try {
        const dataUri = await loadImageBytes(p);
        if (dataUri) ctx.imageDataCache.set(p, dataUri);
      } catch (e) { console.warn('warn:', e.message); }
    }));
  }
  for (const entry of entries) {
    try {
      const cached = files.get(entry.path);
      if (!cached) throw new Error('not loaded');
      ctx.topicPath = entry.path;
      const doc = parseXml(cached.current);
      normalizeOxyPIs(doc);
      const topic = doc.documentElement;
      const topicTitle = Array.from(topic?.childNodes || []).find(n => n.localName === 'title');
      let body = '';
      for (const child of topic?.childNodes || []) {
        if (child === topicTitle) continue;
        body += ditaToMarkdown(child, ctx);
      }
      sections.push({ path: entry.path, title: topicTitle?.textContent?.trim() || entry.title || entry.path, body });
    } catch (error) {
      throw new Error(entry.path + '：' + error.message);
    }
  }
  let md = '# ' + (title || map.title || map.path) + '\n\n';
  if (model) md += '> 适用型号：' + mdEscape(model) + '。\n\n';
  if (version) md += '> 文档版本：' + mdEscape(version) + '\n\n';
  md += '**目录**\n\n';
  sections.forEach((sec, i) => { md += (i + 1) + '. [' + sec.title + '](#sec-' + i + ')\n'; });
  md += '\n---\n\n';
  sections.forEach((sec, i) => { md += '<a id="sec-' + i + '"></a>\n\n## ' + sec.title + '\n\n' + sec.body + '\n'; });
  if (ctx.mdFootnotes.length) {
    md += '\n---\n\n**脚注**\n\n';
    ctx.mdFootnotes.forEach(f => { md += f + '\n'; });
  }
  if (failures.length) md += '\n> 以下 topic 加载失败：' + failures.join(', ') + '\n';
  validatePublicationLinks(md, ctx);
  return md;
}
function highlightMarkdown(md) {
  function esc(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  const lines = esc(md).split(/\n/);
  let out = [];
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.match(/^```/)) {
      inCode = !inCode;
      out.push('<span class="md-code-fence">' + line + '</span>');
      continue;
    }
    if (inCode) { out.push('<span class="md-code-line">' + line + '</span>'); continue; }
    let h = line;
    h = h.replace(/^(#{1,3})\s/, '<span class="md-heading">$1 </span>');
    h = h.replace(/^(&gt;\s?)/, '<span class="md-quote">$1</span>');
    h = h.replace(/^([-*]\s)/, '<span class="md-list">$1</span>');
    h = h.replace(/^(\d+\.\s)/, '<span class="md-list">$1</span>');
    h = h.replace(/^(---\s*)$/, '<span class="md-hr">$1</span>');
    h = h.replace(/^(\|)/, '<span class="md-table">$1</span>');
    h = h.replace(/(`[^`]+`)/g, '<span class="md-inline-code">$1</span>');
    h = h.replace(/(\*\*[^*]+\*\*)/g, '<span class="md-bold">$1</span>');
    h = h.replace(/(~~[^~]+~~)/g, '<span class="md-strike">$1</span>');
    h = h.replace(/(!\[[^\]]*\]\([^)]+\))/g, '<span class="md-image">$1</span>');
    h = h.replace(/(\[[^\]]*\]\([^)]+\))/g, '<span class="md-link">$1</span>');
    h = h.replace(/(\[\^\d+\])/g, '<span class="md-fn">$1</span>');
    out.push(h);
  }
  return out.join('\n');
}
function renderMarkdownToHtml(md) {
  function esc(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function imgSrc(src) {
    if (/^(https?:|data:)/i.test(src)) return src;
    if (src.startsWith('/')) return src;
    return '/api/asset?path=' + encodeURIComponent(src);
  }
  function inline(text) {
    let r = esc(text);
    r = r.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => '<img src="' + imgSrc(src.trim()) + '" alt="' + esc(alt) + '"/>');
    r = r.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (m, txt, href) => '<a href="' + esc(href.trim()) + '">' + esc(txt) + '</a>');
    r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
    r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    r = r.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    r = r.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    r = r.replace(/\[\^(\d+)\]/g, '<sup class="fn-ref">[$1]</sup>');
    return r;
  }
  const lines = md.split(/\n/);
  let html = '';
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      let code = '';
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { code += lines[i] + '\n'; i++; }
      i++;
      html += '<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(code.replace(/\n$/,'')) + '</code></pre>\n';
      continue;
    }
    if (/^(#{1,3})\s+/.test(line)) {
      const m = line.match(/^(#{1,3})\s+(.*)/);
      const level = m[1].length;
      html += '<h' + level + '>' + inline(m[2]) + '</h' + level + '>\n';
      i++; continue;
    }
    if (/^---\s*$/.test(line)) { html += '<hr/>\n'; i++; continue; }
    if (/^>\s?/.test(line)) {
      let bq = '';
      while (i < lines.length && /^>\s?/.test(lines[i])) { bq += lines[i].replace(/^>\s?/, '') + '\n'; i++; }
      html += '<blockquote>' + inline(bq.trim()) + '</blockquote>\n';
      continue;
    }
    if (/^\|/.test(line)) {
      let tableLines = [];
      while (i < lines.length && /^\|/.test(lines[i])) { tableLines.push(lines[i]); i++; }
      if (tableLines.length >= 2) {
        const header = tableLines[0].split('|').filter(c => c.trim() !== '').map(c => c.trim());
        html += '<table><thead><tr>';
        header.forEach(h => html += '<th>' + inline(h) + '</th>');
        html += '</tr></thead><tbody>';
        for (let r = 2; r < tableLines.length; r++) {
          const cells = tableLines[r].split('|').filter(c => c.trim() !== '').map(c => c.trim());
          html += '<tr>';
          cells.forEach(c => html += '<td>' + inline(c) + '</td>');
          html += '</tr>';
        }
        html += '</tbody></table>\n';
      }
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      let items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
      html += '<ul>';
      items.forEach(it => html += '<li>' + inline(it) + '</li>');
      html += '</ul>\n';
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      let items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
      html += '<ol>';
      items.forEach(it => html += '<li>' + inline(it) + '</li>');
      html += '</ol>\n';
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    let para = line;
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|```|>|\||[-*]\s|\d+\.\s|---)/.test(lines[i])) {
      para += ' ' + lines[i]; i++;
    }
    html += '<p>' + inline(para) + '</p>\n';
  }
  return html;
}

    return { collectPreviewPaths, exportMapToHtml, exportMapToMarkdown, ditaToMarkdown, renderMarkdownToHtml, highlightMarkdown };
  }
  const api = { createDeliveryCore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDeliveryCore = api;
})(typeof window === 'undefined' ? globalThis : window);

'use strict';
(function (root) {
  const publication = typeof module !== 'undefined' ? require('./publication-core') : root.DitaPublication;
  const assets = typeof module !== 'undefined' ? require('./asset-core') : root.DitaAssetCore;
  const presentation = typeof module !== 'undefined' ? require('./document-presentation') : root.DitaDocumentPresentation;
  const { renderHtmlDocument } = typeof module !== 'undefined' ? require('./delivery-document') : root.DitaDeliveryDocument;
  const { highlightMarkdown, renderMarkdownToHtml } = typeof module !== 'undefined' ? require('./markdown-preview') : root.DitaMarkdownPreview;
  const { collectPreviewPaths } = typeof module !== 'undefined' ? require('./manual-core') : root.DitaManualCore;
  function createDeliveryCore({ parseXml, normalizeOxyPIs, resolveAssetPath }) {
    const createContext = () => ({ topicPath: '', imageDataCache: new Map(), fnCounter: 0, mdFnCounter: 0, mdFootnotes: [] });
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
  'parml': 'dl', 'plentry': 'div', 'pt': 'dt', 'pd': 'dd',
  'simpletable': 'table', 'sthead': 'tr', 'strow': 'tr', 'stentry': 'td',
  'table': 'table', 'tgroup': 'div', 'thead': 'thead', 'tbody': 'tbody',
  'row': 'tr', 'entry': 'td',
  'xref': 'a', 'cite': 'cite', 'keyword': 'span', 'term': 'span',
  'ph': 'span', 'b': 'strong', 'i': 'em', 'u': 'u', 'sup': 'sup', 'sub': 'sub',
  'q': 'q', 'boolean': 'span', 'state': 'span',
  'tt': 'code', 'option': 'code', 'apiname': 'code', 'tm': 'span',
  'image': 'img', 'object': 'div', 'pre': 'pre', 'lines': 'pre', 'msgblock': 'pre', 'screen': 'pre', 'cmdname': 'code', 'userinput': 'code', 'systemoutput': 'code',
  'menucascade': 'span', 'uicontrol': 'span', 'wintitle': 'span',
  'fn': 'sup', 'abbreviated-form': 'span'
};

const DITA_INLINE_TAGS = new Set([
  'codeph', 'filepath', 'varname', 'parmname', 'msgph', 'keyword', 'term',
  'xref', 'cite', 'ph', 'b', 'i', 'u', 'sup', 'sub', 'q', 'boolean', 'state',
  'menucascade', 'uicontrol', 'wintitle', 'fn', 'abbreviated-form', 'cmdname', 'userinput', 'systemoutput', 'tt', 'option', 'apiname', 'tm'
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
  if (node.nodeType === 3 || node.nodeType === 4) return node.data.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    const presentation = assets.imagePresentation(node), alt = presentation.alt;
    const resolved = resolveAssetPath(href, ctx);
    const src = ctx.imageDataCache.has(resolved) ? ctx.imageDataCache.get(resolved) : /^(https?:|data:)/i.test(resolved) ? resolved : '/api/asset?path=' + encodeURIComponent(resolved);
    const anchor = publicationAnchor(node, ctx);
    const dimensions = ['width', 'height'].filter(name => presentation[name]).map(name => name + ':' + presentation[name] + ';').join('');
    return '<img' + (anchor ? ' id="' + escapeHtmlAttr(anchor) + '"' : '') + ' src="' + escapeHtmlAttr(src) + '" alt="' + escapeHtmlAttr(alt) + '" style="max-width:100%;' + dimensions + '"/>';
  }
  if (tag === 'xref') {
    const href = publicationLink(node, ctx);
    const anchor = publicationAnchor(node, ctx);
    return '<a' + (anchor ? ' id="' + escapeHtmlAttr(anchor) + '"' : '') + ' href="' + escapeHtmlAttr(href) + '">' + Array.from(node.childNodes).map(function(n) { return ditaToHtml(n, ctx); }).join('') + '</a>';
  }
  if (tag === 'note') {
    const type = node.getAttribute('type') || 'note', detail = presentation.note(type, node.getAttribute('othertype') || '');
    const anchor = publicationAnchor(node, ctx);
    return '<div class="dita-note" data-note-tone="' + detail.tone + '"' + (anchor ? ' id="' + escapeHtmlAttr(anchor) + '"' : '') + '><div class="note-body"><strong class="note-label">' + escapeHtmlAttr(detail.label) + '：</strong>' + Array.from(node.childNodes).map(child => ditaToHtml(child, ctx)).join('') + '</div></div>';
  }
  if (tag === 'colspec') return '';
  if (tag === 'tgroup') {
    const specs = Array.from(node.childNodes).filter(n => n.localName === 'colspec');
    const total = specs.reduce((sum, n) => sum + (/^\d+(?:\.\d+)?\*$/.test(n.getAttribute('colwidth') || '') ? parseFloat(n.getAttribute('colwidth')) : 0), 0);
    const columns = specs.length ? '<colgroup>' + specs.map(spec => {
      const width = spec.getAttribute('colwidth') || '';
      const size = /^\d+(?:\.\d+)?(?:mm|cm|in|pt|pc|px)$/.test(width) ? width : /^\d+(?:\.\d+)?\*$/.test(width) && total ? (parseFloat(width) / total * 100) + '%' : '';
      return '<col' + (size ? ' style="width:' + size + '"' : '') + '/>';
    }).join('') + '</colgroup>' : '';
    return columns + Array.from(node.childNodes).map(child => ditaToHtml(child, ctx)).join('');
  }
  const htmlTag = DITA_HTML_MAP[tag] || 'div';
  const attrs = [];
  const anchor = publicationAnchor(node, ctx);
  if (anchor) attrs.push('id="' + escapeHtmlAttr(anchor) + '"');
  if (['row', 'table', 'entry'].includes(tag) && node.getAttribute('outputclass')) attrs.push('data-dita-outputclass="' + escapeHtmlAttr(node.getAttribute('outputclass')) + '"');
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

async function loadPublicationImages(entries, prepared, files, ctx, loadImageBytes) {
  if (!loadImageBytes) return;
  const paths = new Set();
  const sources = [...entries.map(entry => ({ path: entry.path, current: files.get(entry.path)?.current })), ...Array.from(prepared.noteDefinitions.values(), note => ({ path: note.path, current: note.xml }))];
  for (const entry of sources) {
    const doc = parseXml(entry.current);
    for (const img of doc.querySelectorAll('image')) {
      const resolved = resolveAssetPath(img.getAttribute('href') || '', { topicPath: entry.path });
      if (resolved && !/^(https?:|data:|\x2f)/i.test(resolved)) paths.add(resolved);
    }
  }
  const issues = (await Promise.all([...paths].map(async path => {
    try {
      const bytes = await loadImageBytes(path);
      if (typeof bytes !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(bytes)) throw new Error('未取得有效的内嵌图片数据');
      ctx.imageDataCache.set(path, bytes); return null;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      return { path, severity: 'error', message: '图片无法读取：' + path };
    }
  }))).filter(Boolean);
  if (issues.length) throw Object.assign(new Error('图片无法读取，请检查问题清单'), { issues });
}

async function exportMapToHtml({ map, files, title, loadImageBytes, model = '', version = '', publicationData }) {
  const prepared = publicationData || publication.preparePublication({ map, files, model }, collectPreviewPaths);
  files = prepared.files;
  const ctx = createContext();
  ctx.noteDefinitions = publicationDefinitions(prepared);
  const entries = collectPreviewPaths(map.children || []).filter(entry => !prepared.files.get(entry.path)?.excluded);
  ctx.anchors = publicationAnchors(prepared, entries);
  const sections = [];
  await loadPublicationImages(entries, prepared, files, ctx, loadImageBytes);
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
      sections.push({ path: entry.path, title: topicTitle?.textContent?.trim() || entry.title || entry.path, body: inner });
    } catch (error) {
      throw new Error(entry.path + '：' + error.message, { cause: error });
    }
  }
  const html = renderHtmlDocument({ title: title || map.title || map.path, model, version, sections, footnotes: ctx.htmlFootnotes });
  validatePublicationLinks(html, ctx);
  return html;
}

function mdEscape(text) {
  return String(text || '').replace(/([\\`*{}[\]()#+\-.!])/g, '\\$1');
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
  const anchor = publicationAnchor(node, ctx);
  return (anchor ? '<a id="' + escapeHtmlAttr(anchor) + '"></a>' : '') + renderMdInline(node, ctx);
}
function renderMdInline(node, ctx) {
  if (node.nodeType === 3 || node.nodeType === 4) return node.data;
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
  if (tag === 'image') { const resolved = resolveAssetPath(node.getAttribute('href') || '', ctx); const a = assets.imagePresentation(node).alt; const src = ctx.imageDataCache.has(resolved) ? ctx.imageDataCache.get(resolved) : resolved; return '![' + a + '](' + src + ')'; }
  if (tag === 'fn') return markdownFootnote(node, ctx);
  if (tag === 'ins' && (node.getAttribute('class') || '').includes('oxy-insert')) return '**' + inner() + '**';
  if (tag === 'del' && (node.getAttribute('class') || '').includes('oxy-delete')) return '~~' + node.textContent + '~~';
  if (tag === 'span' && (node.getAttribute('class') || '').includes('oxy-comment')) { const c = node.getAttribute('data-comment') || ''; return '<!-- ' + c + ' -->'; }
  if (tag === 'oxy_options') return '';
  return inner();
}



function ditaToMarkdown(node, ctx = createContext()) {
  const anchor = publicationAnchor(node, ctx);
  return (anchor ? '<a id="' + escapeHtmlAttr(anchor) + '"></a>\n' : '') + renderDitaMarkdown(node, ctx);
}
function renderDitaMarkdown(node, ctx) {
  if (node.nodeType === 3 || node.nodeType === 4) { const t = node.data.replace(/\s+/g, ' '); return t; }
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
  if (['pre', 'lines', 'msgblock', 'screen'].includes(tag)) return '\n```\n' + node.textContent.replace(/\n$/, '') + '\n```\n\n';

  if (tag === 'note') {
    const type = node.getAttribute('type') || 'note';
    const label = type === 'other' && node.getAttribute('othertype') ? node.getAttribute('othertype') : type.charAt(0).toUpperCase() + type.slice(1);
    const body = Array.from(node.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim();
    return '> **' + label + ':** ' + body + '\n\n';
  }

  if (tag === 'image') {
    const href = node.getAttribute('href') || '';
    const a = assets.imagePresentation(node).alt;
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
  if (tag === 'dl' || tag === 'parml') return mdDl(node, ctx);

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
  const tgroup = Array.from(node.childNodes).find(n => n.localName === 'tgroup') || node;
  const thead = Array.from(tgroup.childNodes).find(n => n.localName === 'thead');
  const tbody = Array.from(tgroup.childNodes).find(n => n.localName === 'tbody') || tgroup;
  const headRows = node.localName === 'simpletable' ? Array.from(node.childNodes).filter(n => n.localName === 'sthead') : thead ? Array.from(thead.childNodes).filter(n => n.localName === 'row') : [];
  const bodyRows = Array.from(tbody.childNodes).filter(n => n.localName === 'row' || n.localName === 'strow');
  const allRows = [...headRows, ...bodyRows];
  if (!allRows.length) return '';
  if (allRows.some(row => Array.from(row.childNodes).some(cell => Number(cell.getAttribute?.('morerows')) > 0 || cell.getAttribute?.('namest') || cell.getAttribute?.('nameend')))) throw new Error('Markdown 表格不支持合并单元格，请选择 HTML 导出');
  const matrix = allRows.map(row => Array.from(row.childNodes).filter(n => n.localName === 'entry' || n.localName === 'stentry').map(e => Array.from(e.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim().replace(/\|/g, '\\|')));
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
  const entries = Array.from(node.childNodes).filter(n => ['dlentry', 'plentry'].includes(n.localName));
  if (!entries.length) return '';
  let r = '\n';
  for (const entry of entries) {
    const dt = Array.from(entry.childNodes).find(n => ['dt', 'pt'].includes(n.localName));
    const dd = Array.from(entry.childNodes).find(n => ['dd', 'pd'].includes(n.localName));
    if (dt) r += '**' + dt.textContent.trim() + '**\n';
    if (dd) r += ': ' + Array.from(dd.childNodes).map(function(n) { return mdInline(n, ctx); }).join('').trim() + '\n\n';
  }
  return r;
}

async function exportMapToMarkdown({ map, files, title, loadImageBytes, model = '', version = '', publicationData }) {
  const prepared = publicationData || publication.preparePublication({ map, files, model }, collectPreviewPaths);
  files = prepared.files;
  const ctx = createContext();
  ctx.mdFnCounter = 0;
  ctx.mdFootnotes = [];
  ctx.noteDefinitions = publicationDefinitions(prepared);
  const entries = collectPreviewPaths(map.children || []).filter(entry => !prepared.files.get(entry.path)?.excluded);
  ctx.anchors = publicationAnchors(prepared, entries);
  const sections = [];
  await loadPublicationImages(entries, prepared, files, ctx, loadImageBytes);
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
      throw new Error(entry.path + '：' + error.message, { cause: error });
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
  validatePublicationLinks(md, ctx);
  return md;
}
    return { collectPreviewPaths, exportMapToHtml, exportMapToMarkdown, ditaToMarkdown, renderMarkdownToHtml, highlightMarkdown };
  }
  const api = { createDeliveryCore };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDeliveryCore = api;
})(typeof window === 'undefined' ? globalThis : window);

'use strict';
(function (root) {
  // PDF, print and Word share the already resolved publication HTML. They never
  // re-read DITA, so model filtering and the captured buffers stay identical.
  const printCSS = `
    @page { size: Letter; margin: 19mm 18mm 20mm; }
    body { font-family: "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif; font-size: 11pt; line-height: 1.55; color: #171717; max-width: none; margin: 0; padding: 0; }
    h1, h2, h3, h4 { color: #111; font-weight: bold; border: 0; padding: 0; break-after: avoid; page-break-after: avoid; }
    h1 { font-size: 24pt; margin: 0 0 16pt; }
    h2 { font-size: 17pt; margin: 22pt 0 10pt; }
    h3 { font-size: 13pt; margin: 16pt 0 8pt; }
    p { margin: 0 0 8pt; orphans: 2; widows: 2; }
    .toc { background: none; padding: 0; margin: 16pt 0 22pt; }
    .toc h2 { font-size: 14pt; }
    a, .toc a, sup.fn-ref { color: #24536b; }
    table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 10pt 0; table-layout: fixed; }
    th, td { border: 0.5pt solid #b8c3cb; padding: 6pt 7pt; overflow-wrap: anywhere; vertical-align: top; }
    th, thead td { background: #edf1f4; font-weight: bold; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    img { max-width: 100%; max-height: 7in; object-fit: contain; }
    figure { margin: 12pt 0; break-inside: avoid; }
    pre, .code-block, .dita-note .code-block { font-family: Consolas, "Noto Sans Mono CJK SC", monospace; font-size: 9pt; line-height: 1.4; color: #222; background: #f3f5f6; padding: 9pt; border-radius: 0; white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; }
    code { color: inherit; }
    .dita-note { display: block; color: #222; background: none; border: 0; padding: 0; margin: 10pt 0; }
    .note-icon { display: none; }
    .export-footnotes { font-size: 10pt; }
    .export-footnotes li { margin-bottom: 6pt; }
    hr { border: 0; margin: 12pt 0; }
  `;
  function printable(html) {
    return html.replace('</head>', '<style>' + printCSS + '</style></head>');
  }
  let libraries;
  function script(src) {
    return new Promise((resolve, reject) => {
      const element = document.createElement('script'); element.src = src;
      element.onload = resolve; element.onerror = () => { element.remove(); reject(new Error('Word 组件加载失败，请刷新后重试')); };
      document.head.append(element);
    });
  }
  async function loadWord() {
    if (!libraries) libraries = (async () => {
      await script('/vendor/docx/docx.js'); await script('/vendor/docx/math.js'); await script('/vendor/docx/html.js');
    })().catch(error => { libraries = null; throw error; });
    await libraries;
  }
  function cancelled(signal) { if (signal?.aborted) throw new Error('已取消'); }
  async function word(html, signal) {
    await loadWord(); cancelled(signal);
    const doc = new DOMParser().parseFromString(printable(html), 'text/html');
    // Keep one numbered definition and all repeat links, as in HTML/PDF. The
    // importer otherwise turns each reference into a separately numbered note.
    doc.querySelectorAll('.export-footnotes a[aria-label="返回正文"]').forEach(link => link.remove());
    doc.querySelectorAll('.note-icon').forEach(icon => icon.remove());
    doc.querySelectorAll('body > hr').forEach(rule => rule.remove());
    for (const image of doc.querySelectorAll('img')) {
      // Word doesn't reliably display WebP or SVG without a PNG fallback. Only
      // rasterize those image assets; the text and tables remain editable.
      const picture = new Image(); picture.src = image.src;
      await picture.decode(); cancelled(signal);
      if (/^data:image\/(svg\+xml|webp)/i.test(image.src)) {
        const scale = Math.min(1, 1600 / Math.max(picture.naturalWidth, picture.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
        canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
        image.src = canvas.toDataURL('image/png');
      }
      image.setAttribute('width', String(Math.min(picture.naturalWidth, 624)));
    }
    const warnings = [], D = root.docx;
    const children = root.docxHtml.htmlToContent(doc.documentElement.outerHTML, {
      maxImageWidth: 624, styleMap: { 'h1': 'Title' }, onWarning: warning => warnings.push(warning)
    });
    if (warnings.length) {
      const labels = { 'unsupported-element': '包含不支持的媒体内容', 'missing-image': '图片缺失', 'unsupported-image': '图片格式不支持', 'unsafe-link': '链接不安全', 'invalid-math': '公式无法转换', 'too-deep': '内容嵌套过深', 'table-in-note': '注脚中的表格无法保留原排版' };
      throw new Error('Word 无法完整保留当前内容：' + [...new Set(warnings.map(w => labels[w.code] || '存在不支持的结构'))].join('、') + '。请使用 HTML 交付并检查原文。');
    }
    const documentFile = new D.Document({
      title: doc.title, creator: 'DITA 文档工作台',
      styles: { default: {
        document: { run: { font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Microsoft YaHei' }, size: 22 }, paragraph: { spacing: { after: 120, line: 330 } } },
        ...Object.fromEntries(['title', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'].map(name => [name, { paragraph: { keepNext: true, keepLines: true } }]))
      } },
      sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1134, left: 1020, right: 1020 } } },
        footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: [D.PageNumber.CURRENT, ' / ', D.PageNumber.TOTAL_PAGES], size: 18, color: '666666' })] })] }) }, children }]
    });
    const output = await D.Packer.toBlob(documentFile); cancelled(signal); return output;
  }
  root.DitaOfficeExport = { printable, word };
})(window);

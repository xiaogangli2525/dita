'use strict';
(function (root) {
  const core = root.DitaTemplateCore;
  const mmToTwips = value => Math.round(value * 1440 / 25.4);
  const pxPerMm = 96 / 25.4;
  const labels = {
    'manual.model': '适用型号',
    'manual.version': '文档版本',
    'manual.releaseDate': '发布日期',
    'manual.documentId': '文档编号',
    'manual.classification': '文档级别',
    'company.name': '企业名称'
  };
  function cancelled(signal) { if (signal?.aborted) throw new Error('已取消'); }
  function bytesFromDataUrl(value) {
    const binary = atob(value.split(',')[1]), bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  async function loadImage(value) {
    const image = new Image();
    image.src = value;
    await image.decode();
    return {
      image,
      bytes: bytesFromDataUrl(value),
      width: image.naturalWidth,
      height: image.naturalHeight,
      type: value.startsWith('data:image/jpeg') ? 'jpg' : 'png'
    };
  }
  function fontOptions(font, size, color, extra = {}) {
    return { font, size: Math.round(size * 2), color: color.replace('#', ''), ...extra };
  }
  function coverText(D, text, options = {}) {
    return new D.Paragraph({
      children: [new D.TextRun({ text, font: options.font, size: Math.round((options.size || 11) * 2),
        color: (options.color || '202B33').replace('#', ''), bold: Boolean(options.bold), italics: Boolean(options.italics) })],
      alignment: options.alignment || D.AlignmentType.LEFT,
      spacing: { before: options.before || 0, after: options.after ?? 140, line: 300 },
      ...(options.keepNext ? { keepNext: true } : {}),
      ...(options.border ? { border: options.border } : {}),
      ...(options.shading ? { shading: options.shading } : {}),
      ...(options.indent ? { indent: options.indent } : {})
    });
  }
  async function coverChildren(D, pack, fields) {
    const font = pack.typography.bodyFont, primary = pack.colors.primary, accent = pack.colors.accent;
    const titleColor = pack.cover.textColor || primary, children = [];
    if (pack.company.logo) {
      const logo = await loadImage(pack.assets[pack.company.logo]);
      const scale = Math.min(1, 180 / logo.width, 72 / logo.height);
      children.push(new D.Paragraph({
        alignment: D.AlignmentType.LEFT,
        spacing: { before: 280, after: 220 },
        children: [new D.ImageRun({ data: logo.bytes, type: logo.type,
          transformation: { width: Math.max(1, logo.width * scale), height: Math.max(1, logo.height * scale) } })]
      }));
    }
    if (pack.cover.layout === 'brand-panel') {
      children.push(coverText(D, fields['company.name'] || 'TECHNICAL DOCUMENTATION', {
        font, size: 12, color: 'FFFFFF', bold: true, before: 520, after: 520,
        shading: { fill: primary.replace('#', ''), type: 'clear' },
        indent: { left: 280, right: 180 }
      }));
    } else if (fields['company.name']) {
      children.push(coverText(D, fields['company.name'], { font, size: 13, color: primary, bold: true, before: 520, after: 420 }));
    }
    children.push(coverText(D, 'TECHNICAL DOCUMENTATION', { font, size: 9, color: accent, bold: true, before: 760, after: 180, keepNext: true }));
    children.push(coverText(D, fields['manual.title'], { font, size: 30, color: titleColor, bold: true, before: 0, after: 300, keepNext: true }));
    if (fields['manual.model']) children.push(coverText(D, '适用型号  ·  ' + fields['manual.model'], { font, size: 13, color: primary, bold: true, after: 220 }));
    children.push(new D.Paragraph({
      border: { bottom: { style: D.BorderStyle.SINGLE, size: 14, color: accent.replace('#', ''), space: 8 } },
      spacing: { before: 80, after: 360 },
      children: [new D.TextRun({ text: ' ', font, size: 8 })]
    }));
    for (const field of pack.cover.fields) {
      if (field === 'manual.title' || field === 'manual.model' || field === 'company.name') continue;
      const value = fields[field];
      if (!value) continue;
      const label = labels[field] || field;
      children.push(new D.Paragraph({
        spacing: { after: 130, line: 300 },
        children: [
          new D.TextRun({ text: label + '  ', font, size: 19, bold: true, color: primary.replace('#', '') }),
          new D.TextRun({ text: value, font, size: 19, color: pack.colors.text.replace('#', '') })
        ]
      }));
    }
    return children;
  }
  function slotRuns(D, field, fields, font, color) {
    const style = fontOptions(font, 8.5, color);
    if (!field) return [];
    if (field === 'page.current') return [new D.TextRun({ ...style, children: [D.PageNumber.CURRENT] })];
    if (field === 'page.total') return [new D.TextRun({ ...style, children: [D.PageNumber.TOTAL_PAGES] })];
    if (field === 'page.currentTotal') return [new D.TextRun({ ...style, children: [D.PageNumber.CURRENT, ' / ', D.PageNumber.TOTAL_PAGES] })];
    return fields[field] ? [new D.TextRun({ ...style, text: fields[field] })] : [];
  }
  function headerFooterParagraph(D, part, pack, fields, contentWidth) {
    const config = pack[part], header = part === 'header';
    const color = header ? '4B5E68' : '61717B';
    const children = [
      ...slotRuns(D, config.left, fields, pack.typography.bodyFont, color),
      new D.TextRun({ text: '\t' }),
      ...slotRuns(D, config.center, fields, pack.typography.bodyFont, color),
      new D.TextRun({ text: '\t' }),
      ...slotRuns(D, config.right, fields, pack.typography.bodyFont, color)
    ];
    const paragraph = {
      alignment: D.AlignmentType.LEFT,
      tabStops: [
        { type: D.TabStopType.CENTER, position: Math.round(contentWidth / 2) },
        { type: D.TabStopType.RIGHT, position: contentWidth }
      ],
      children,
      spacing: { before: 0, after: 0, line: 220 }
    };
    if (header && config.rule) paragraph.border = { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: pack.colors.primary.replace('#', ''), space: 4 } };
    if (!header && config.rule) paragraph.border = { top: { style: D.BorderStyle.SINGLE, size: 4, color: 'CDD5D9', space: 4 } };
    return new D.Paragraph(paragraph);
  }
  async function watermarkImage(pack, fields) {
    const settings = pack.watermark, source = core.watermarkSource(pack);
    if (source.kind === 'none') return null;
    const canvas = document.createElement('canvas');
    let width, height, context;
    if (source.kind === 'image') {
      const original = await loadImage(pack.assets[source.asset]);
      const scale = Math.min(1, 1600 / Math.max(original.width, original.height));
      width = Math.max(1, Math.round(original.width * scale));
      height = Math.max(1, Math.round(original.height * scale));
      canvas.width = width; canvas.height = height;
      context = canvas.getContext('2d');
      context.globalAlpha = settings.opacity;
      if (settings.tone === 'grayscale') context.filter = 'grayscale(1)';
      context.drawImage(original.image, 0, 0, width, height);
    } else {
      const value = fields[source.field] || '';
      if (!value) return null;
      canvas.width = 1600; canvas.height = 360; width = canvas.width; height = canvas.height;
      context = canvas.getContext('2d');
      context.globalAlpha = settings.opacity;
      context.fillStyle = pack.colors.primary;
      let size = 112;
      context.font = 'bold ' + size + 'px "' + pack.typography.bodyFont + '", sans-serif';
      while (size > 30 && context.measureText(value).width > 1460) {
        size -= 4; context.font = 'bold ' + size + 'px "' + pack.typography.bodyFont + '", sans-serif';
      }
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(value, width / 2, height / 2, 1480);
    }
    const data = canvas.toDataURL('image/png');
    const bytes = bytesFromDataUrl(data);
    return { bytes, width, height };
  }
  async function floatingWatermark(D, pack, fields, pageWidthPx, pageHeightPx, pageHeightTwips) {
    const source = core.watermarkSource(pack), settings = pack.watermark;
    if (source.kind === 'none') return null;
    const image = await watermarkImage(pack, fields);
    if (!image) return null;
    let width, height, yPercent = settings.offsetYPercent;
    if (source.kind === 'image' && settings.fit === 'page') {
      const scale = Math.min(pageWidthPx / image.width, pageHeightPx / image.height);
      width = image.width * scale; height = image.height * scale; yPercent = 50;
    } else {
      width = pageWidthPx * settings.widthPercent / 100;
      height = width * image.height / image.width;
      const maxHeight = pageHeightPx * 0.30;
      if (height > maxHeight) { const scale = maxHeight / height; width *= scale; height *= scale; }
    }
    return new D.ImageRun({
      data: image.bytes, type: 'png',
      transformation: { width, height, rotation: settings.rotationDeg },
      floating: {
        horizontalPosition: { relative: 'page', align: 'center' },
        verticalPosition: { relative: 'page', offset: Math.round(pageHeightTwips * 635 * yPercent / 100) },
        wrap: { type: D.TextWrappingType.NONE },
        behindDocument: true, allowOverlap: true, lockAnchor: true
      },
      altText: { name: 'Document watermark', description: 'Decorative enterprise document watermark' }
    });
  }
  async function coverBackgroundHeader(D, pack, pageWidthPx, pageHeightPx) {
    if (!pack.cover.background) return null;
    const image = await loadImage(pack.assets[pack.cover.background]);
    const run = new D.ImageRun({
      data: image.bytes, type: image.type,
      transformation: { width: pageWidthPx, height: pageHeightPx },
      floating: {
        horizontalPosition: { relative: 'page', offset: 0 },
        verticalPosition: { relative: 'page', offset: 0 },
        wrap: { type: D.TextWrappingType.NONE },
        behindDocument: true, allowOverlap: true, lockAnchor: true
      },
      altText: { name: 'Cover background', description: 'Decorative cover background' }
    });
    return new D.Header({ children: [new D.Paragraph({ children: [run], spacing: { before: 0, after: 0 } })] });
  }
  async function regionWrappers(D, pack, fields, region, pageWidthPx, pageHeightPx, pageHeightTwips, contentWidth) {
    const headers = {}, footers = {};
    const watermark = region.watermark ? await floatingWatermark(D, pack, fields, pageWidthPx, pageHeightPx, pageHeightTwips) : null;
    if (region.header || watermark) {
      const children = [];
      if (watermark) children.push(new D.Paragraph({ children: [watermark], spacing: { before: 0, after: 0 } }));
      if (region.header) children.push(headerFooterParagraph(D, 'header', pack, fields, contentWidth));
      headers.default = new D.Header({ children });
    }
    if (region.footer) footers.default = new D.Footer({ children: [headerFooterParagraph(D, 'footer', pack, fields, contentWidth)] });
    return { ...(Object.keys(headers).length ? { headers } : {}), ...(Object.keys(footers).length ? { footers } : {}) };
  }
  function pageProperties(D, pack, pageWidthTwips, pageHeightTwips) {
    const margins = pack.page.marginsMm;
    const headerDistance = Math.max(4, margins.top - pack.header.gapMm - 5);
    const footerDistance = Math.max(4, margins.bottom - pack.footer.gapMm - 5);
    return {
      type: D.SectionType.NEXT_PAGE,
      page: {
        size: { width: pageWidthTwips, height: pageHeightTwips },
        margin: {
          top: mmToTwips(margins.top), right: mmToTwips(margins.right),
          bottom: mmToTwips(margins.bottom), left: mmToTwips(margins.left),
          header: mmToTwips(headerDistance), footer: mmToTwips(footerDistance)
        }
      }
    };
  }
  function documentStyles(pack) {
    const font = pack.typography.bodyFont, text = pack.colors.text.replace('#', ''), primary = pack.colors.primary.replace('#', '');
    const heading = (size, before, after) => ({
      run: { font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: font }, size, bold: true, color: primary },
      paragraph: { keepNext: true, keepLines: true, spacing: { before, after } }
    });
    return {
      default: {
        document: {
          run: { font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: font }, size: Math.round(pack.typography.bodySizePt * 2), color: text },
          paragraph: { spacing: { after: 120, line: 330 } }
        },
        title: {
          run: { font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: font }, size: 48, bold: true, color: primary },
          paragraph: { keepNext: true, keepLines: true, spacing: { before: 240, after: 240 } }
        },
        heading1: heading(34, 360, 180),
        heading2: heading(28, 280, 140),
        heading3: heading(24, 220, 120),
        heading4: heading(22, 180, 100),
        heading5: heading(21, 140, 80),
        heading6: heading(20, 120, 80)
      }
    };
  }
  function validateWarnings(warnings) {
    if (!warnings.length) return;
    const labels = {
      'unsupported-element': '包含不支持的媒体内容',
      'missing-image': '图片缺失',
      'unsupported-image': '图片格式不支持',
      'unsafe-link': '链接不安全',
      'invalid-math': '公式无法转换',
      'too-deep': '内容嵌套过深',
      'table-in-note': '注脚中的表格无法保留原排版'
    };
    throw new Error('Word 无法完整保留当前内容：' + [...new Set(warnings.map(warning => labels[warning.code] || '存在不支持的结构'))].join('、') + '。请使用 HTML 交付并检查原文。');
  }
  async function render({ doc, convertContent, signal }, publication) {
    cancelled(signal);
    const snapshot = core.capture(publication.package, publication.fields), pack = snapshot.package, fields = snapshot.fields;
    if (!pack.formats.includes('docx')) throw new Error('当前企业模板未启用 Word 格式，请选择支持 Word 的模板。');
    if (pack.renderer !== 'manual-v2') throw new Error('旧版模板需要升级新版排版后才能用于 Word。');
    const pageWidthMm = core.sizes[pack.page.size][0], pageHeightMm = core.sizes[pack.page.size][1];
    const pageWidthPx = pageWidthMm * pxPerMm, pageHeightPx = pageHeightMm * pxPerMm;
    const pageWidthTwips = mmToTwips(pageWidthMm), pageHeightTwips = mmToTwips(pageHeightMm);
    const margins = pack.page.marginsMm, contentWidth = pageWidthTwips - mmToTwips(margins.left + margins.right);
    const bodyDoc = doc.cloneNode(true);
    const toc = bodyDoc.body.querySelector('.toc');
    let frontChildren = [];
    if (toc) {
      const frontDoc = doc.cloneNode(true);
      frontDoc.body.replaceChildren(toc.cloneNode(true));
      const front = convertContent(frontDoc.documentElement.outerHTML);
      frontChildren = front.children; validateWarnings(front.warnings);
      toc.remove();
    }
    if (pack.cover.enabled) {
      bodyDoc.body.querySelector('h1')?.remove();
      bodyDoc.body.querySelector('.publication-scope')?.remove();
      bodyDoc.body.querySelector('.publication-version')?.remove();
    }
    const body = convertContent(bodyDoc.documentElement.outerHTML);
    validateWarnings(body.warnings);
    cancelled(signal);
    const D = root.docx, sections = [];
    if (pack.cover.enabled) {
      const cover = await coverChildren(D, pack, fields);
      const background = await coverBackgroundHeader(D, pack, pageWidthPx, pageHeightPx);
      sections.push({
        properties: pageProperties(D, pack, pageWidthTwips, pageHeightTwips),
        ...(background ? { headers: { default: background } } : {}),
        children: cover
      });
    }
    if (frontChildren.length) {
      const wrappers = await regionWrappers(D, pack, fields, pack.regions.frontMatter, pageWidthPx, pageHeightPx, pageHeightTwips, contentWidth);
      sections.push({ properties: pageProperties(D, pack, pageWidthTwips, pageHeightTwips), ...wrappers, children: frontChildren });
    }
    const wrappers = await regionWrappers(D, pack, fields, pack.regions.body, pageWidthPx, pageHeightPx, pageHeightTwips, contentWidth);
    sections.push({
      properties: pageProperties(D, pack, pageWidthTwips, pageHeightTwips),
      ...wrappers,
      children: body.children.length ? body.children : [new D.Paragraph('')]
    });
    cancelled(signal);
    const documentFile = new D.Document({
      title: fields['manual.title'] || doc.title,
      creator: fields['company.name'] || 'DITA 文档工作台',
      styles: documentStyles(pack),
      sections
    });
    const output = await D.Packer.toBlob(documentFile);
    cancelled(signal);
    return output;
  }
  root.DitaTemplateWord = { render };
})(window);

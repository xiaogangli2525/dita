'use strict';
(function (root) {
  const core = typeof module !== 'undefined' ? require('./template-core') : root.DitaTemplateCore;
  const previous = typeof module !== 'undefined' ? require('./template-pdf-v1') : root.DitaTemplatePdfV1;
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const cssText = value => '"' + String(value).replace(/["\\\n\r<>]/g, character => '\\' + character.codePointAt(0).toString(16) + ' ') + '"';
  const labels = { 'manual.model': '适用型号', 'manual.version': '文档版本', 'manual.releaseDate': '发布日期', 'manual.documentId': '文档编号', 'manual.classification': '文档级别' };
  function render(html, value) {
    const snapshot = core.capture(value.package, value.fields), pack = snapshot.package, fields = snapshot.fields;
    if (pack.renderer === 'manual-v1') return previous.render(html, snapshot);
    const [width, height] = core.sizes[pack.page.size], margins = pack.page.marginsMm;
    const dense = Object.values(fields).reduce((sum, text) => sum + text.length, 0) > 350;
    const image = name => name ? pack.assets[name] : '';
    const slot = field => {
      if (field === 'page.current') return 'counter(page)';
      if (field === 'page.total') return 'counter(pages)';
      if (field === 'page.currentTotal') return 'counter(page) " / " counter(pages)';
      const text = fields[field] || '', capacity = (width - margins.left - margins.right) / 3 * 2.8346 / 8.5 - 1;
      let length = 0, shown = '';
      for (const char of text) { length += char.codePointAt(0) < 128 ? 0.53 : 1; if (length > capacity - 1) return cssText(shown + '…'); shown += char; }
      return cssText(shown);
    };
    function watermark() {
      const source = core.watermarkSource(pack), settings = pack.watermark, w = width * 96 / 25.4, h = height * 96 / 25.4;
      if (source.kind === 'none' || source.kind === 'text' && !fields[source.field]) return 'none';
      const cx = w / 2, cy = h * settings.offsetYPercent / 100, boxWidth = w * settings.widthPercent / 100, boxHeight = h * 0.30;
      let content;
      if (source.kind === 'image') {
        content = settings.fit === 'page' ? `<image href="${image(source.asset)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>` :
          `<image href="${image(source.asset)}" x="${cx - boxWidth / 2}" y="${cy - boxHeight / 2}" width="${boxWidth}" height="${boxHeight}" preserveAspectRatio="xMidYMid meet" transform="rotate(${settings.rotationDeg},${cx},${cy})"/>`;
      } else {
        const text = fields[source.field];
        content = `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="${pack.colors.primary}" font-family="${pack.typography.bodyFont},sans-serif" font-size="${Math.min(60, boxWidth / Math.max(1, [...text].length))}" transform="rotate(${settings.rotationDeg},${cx},${cy})">${escape(text)}</text>`;
      }
      const filter = settings.tone === 'grayscale' ? '<defs><filter id="watermark-tone" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter></defs>' : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${filter}<g opacity="${settings.opacity}"${filter ? ' filter="url(#watermark-tone)"' : ''}>${content}</g></svg>`;
      return 'url("data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27') + '")';
    }
    const water = watermark();
    // @page backgrounds start at the page content edge in Chromium. Offset by
    // the actual margins so artwork coordinates stay relative to the full sheet.
    function page(name, region) {
      const headerRule = region.header && pack.header.rule ? `border-bottom:0.5pt solid ${pack.colors.primary};` : '';
      const footerRule = region.footer && pack.footer.rule ? 'border-top:0.4pt solid #CDD5D9;' : '';
      const cells = ['left', 'center', 'right'].flatMap(position => [
        `@top-${position}{width:33.333%;content:${region.header ? slot(pack.header[position]) : 'none'};${headerRule}margin-bottom:${pack.header.gapMm}mm;padding-bottom:2.5mm;font:8.5pt ${cssText(pack.typography.bodyFont)},sans-serif;color:#4B5E68;vertical-align:bottom;white-space:nowrap;}`,
        `@bottom-${position}{width:33.333%;content:${region.footer ? slot(pack.footer[position]) : 'none'};${footerRule}margin-top:${pack.footer.gapMm}mm;padding-top:3mm;font:8.5pt ${cssText(pack.typography.bodyFont)},sans-serif;color:#61717B;vertical-align:top;white-space:nowrap;}`
      ]).join('');
      return `@page ${name}{size:${pack.page.size};margin:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;background-image:${region.watermark ? water : 'none'};background-repeat:no-repeat;background-position:-${margins.left}mm -${margins.top}mm;background-size:${width}mm ${height}mm;${cells}}`;
    }
    const cover = pack.cover.enabled ? `<section class="template-cover ${pack.cover.layout}${pack.cover.background ? ' has-background' : ''}"><div class="template-cover-top"><span class="template-classification">${escape(pack.cover.fields.includes('manual.classification') && fields['manual.classification'] || '技术文档')}</span>${pack.company.logo ? `<img class="template-logo" src="${image(pack.company.logo)}" alt=""/>` : ''}</div><div class="template-cover-copy"><h1>${escape(fields['manual.title'])}</h1><div class="template-cover-divider"></div><div class="template-cover-fields">${pack.cover.fields.filter(field => field !== 'manual.title' && field !== 'manual.classification' && fields[field]).map(field => `<div><span>${labels[field] || '企业名称'}</span><b>${escape(fields[field])}</b></div>`).join('')}</div></div><div class="template-cover-footer"><p>${escape(fields['company.name'])}</p></div></section>` : '';
    const css = `${page('', pack.regions.body)}${page('dita-front', pack.regions.frontMatter)}
      @page dita-cover{size:${pack.page.size};margin:0;background-image:none;@top-left{content:none;}@top-center{content:none;}@top-right{content:none;}@bottom-left{content:none;}@bottom-center{content:none;}@bottom-right{content:none;}}
      html,body{margin:0;padding:0;max-width:none;}body{font-family:${cssText(pack.typography.bodyFont)},"Microsoft YaHei",sans-serif;font-size:${pack.typography.bodySizePt}pt;color:${pack.colors.text};}
      h1,h2,h3,h4,dt{color:${pack.colors.primary};}th,thead td{background:${pack.colors.primary};color:#fff;}a,.toc a,sup.fn-ref{color:${pack.colors.primary};}
      .template-front{page:dita-front;break-after:page;}.template-front .toc{background:none;padding:0;margin:5mm 0;}
      .template-cover{page:dita-cover;break-after:page;box-sizing:border-box;width:${width}mm;height:${height - 0.2}mm;margin:0;padding:22mm;position:relative;overflow:hidden;display:grid;grid-template-rows:20mm 1fr 27mm;gap:12mm;background-color:#fff;color:${pack.cover.textColor};}
      .template-cover:before{content:"";position:absolute;left:0;right:0;bottom:0;height:52mm;background:${pack.colors.primary};border-top:3mm solid ${pack.colors.accent};}
      .template-cover-top{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:12mm;}
      .template-logo{max-width:58mm;max-height:18mm;object-fit:contain;object-position:right top;}
      .template-classification{font-size:8.5pt;letter-spacing:1.5pt;opacity:0.65;line-height:1.6;overflow-wrap:anywhere;max-width:75mm;}
      .template-cover-copy{position:relative;align-self:start;margin-top:${dense ? 12 : 34}mm;min-width:0;}
      .template-cover h1{font-size:${dense || fields['manual.title'].length > 80 ? 17 : fields['manual.title'].length > 45 ? 24 : 32}pt;line-height:1.35;font-weight:700;color:inherit;overflow-wrap:anywhere;border:0;margin:0;padding:0;letter-spacing:0.2pt;}
      .template-cover-divider{width:18mm;height:1mm;background:${pack.colors.accent};margin:${dense ? 7 : 11}mm 0;}
      .template-cover-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:${dense ? 5 : 8}mm 12mm;}
      .template-cover-fields span{display:block;font-size:8pt;opacity:0.65;line-height:1.6;margin-bottom:2mm;}.template-cover-fields b{display:block;font-size:${dense ? 9 : 11.5}pt;line-height:1.5;font-weight:500;overflow-wrap:anywhere;}
      .template-cover-footer{position:relative;align-self:end;min-width:0;padding-bottom:1mm;color:#fff;}.template-cover-footer p{font-size:11pt;line-height:1.5;margin:0;overflow-wrap:anywhere;}
      .template-cover.minimal:before{height:0;border-top:0;}.template-cover.minimal{border-top:2mm solid ${pack.colors.accent};}.template-cover.minimal .template-cover-footer{border-top:0.4pt solid #D8E0E4;padding-top:6mm;color:inherit;}
      ${pack.cover.background ? `.template-cover{background-image:url("${image(pack.cover.background)}");background-size:cover;background-position:center;}.template-cover:before{display:none;}.template-cover.has-background .template-cover-footer{color:inherit;}` : ''}
      ${pack.cover.enabled ? '.template-front>h1,.template-front>.publication-scope,.template-front>.publication-version{display:none;}' : ''}
      @media screen{body{background:#EDF0F2;}.template-cover{margin:0 auto 16px;}.template-front,body>h2,body>section,body>table,body>div:not(.template-front){background:#fff;}.template-front{padding:18mm;box-sizing:border-box;}}
    `;
    if (!/<body>[\s\S]*?<nav class="toc">/.test(html)) throw Object.assign(Error('模板需要工作台生成的完整交付内容，请重新检查后导出。'), { status: 400 });
    let output = html.replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + escape(fields['manual.title']) + '</title>');
    output = output.replace(/(<body>\s*)<h1>[\s\S]*?<\/h1>/, (_, start) => start + '<h1>' + escape(fields['manual.title']) + '</h1>');
    output = output.replace(/<body>([\s\S]*?<nav class="toc">[\s\S]*?<\/nav>)/, (_, front) => '<body>' + cover + '<div class="template-front">' + front + '</div>');
    // Decode every referenced raster before PDF capture, including assets used
    // only in CSS/SVG backgrounds, so a broken image cannot disappear silently.
    const probes = Object.values(pack.assets).map(src => `<img src="${src}" alt="" style="position:absolute;width:0;height:0;visibility:hidden"/>`).join('');
    return output.replace('</head>', () => '<style data-dita-template="pdf">' + css + '</style></head>').replace('</body>', () => probes + '</body>');
  }
  const api = { render };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaTemplatePdf = api;
})(typeof window === 'undefined' ? globalThis : window);

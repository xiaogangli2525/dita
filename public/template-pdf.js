'use strict';
(function (root) {
  const core = typeof module !== 'undefined' ? require('./template-core') : root.DitaTemplateCore;
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const cssText = value => '"' + String(value).replace(/["\\\n\r<>]/g, character => '\\' + character.codePointAt(0).toString(16) + ' ') + '"';
  const labels = { 'manual.model': '适用型号', 'manual.version': '文档版本', 'manual.releaseDate': '发布日期', 'manual.documentId': '文档编号', 'manual.classification': '文档级别' };
  function render(html, value) {
    const snapshot = core.capture(value.package, value.fields), pack = snapshot.package, fields = snapshot.fields;
    const [width, height] = core.sizes[pack.page.size], margins = pack.page.marginsMm;
    const dense = Object.values(fields).reduce((sum, text) => sum + text.length, 0) > 350;
    const image = name => name ? pack.assets[name] : '';
    const slot = field => field === 'page.current' ? 'counter(page)' : field === 'page.total' ? 'counter(pages)' : field === 'page.currentTotal' ? 'counter(page) " / " counter(pages)' : cssText(fields[field] || '');
    // Full-page intrinsic SVG dimensions avoid Chromium's @page percentage
    // background positioning issues. Only escaped text and validated raster
    // assets enter this generated SVG; template packages cannot supply SVG/JS.
    function watermark() {
      const w = width * 96 / 25.4, h = height * 96 / 25.4, text = fields[pack.watermark.text] || '';
      if (!pack.watermark.enabled || !pack.watermark.asset && !text) return 'none';
      const content = pack.watermark.asset ? `<image href="${image(pack.watermark.asset)}" x="${w * 0.18}" y="${h * 0.32}" width="${w * 0.64}" height="${h * 0.36}" preserveAspectRatio="xMidYMid meet"/>` : `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" fill="${pack.colors.primary}" font-family="${pack.typography.bodyFont},sans-serif" font-size="${Math.min(64, w * 0.8 / Math.max(1, [...text].length))}" transform="rotate(-28,${w / 2},${h / 2})">${escape(text)}</text>`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g opacity="${pack.watermark.opacity}">${content}</g></svg>`;
      return 'url("data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27') + '")';
    }
    const water = watermark();
    function page(name, region) {
      const headerRule = region.header && pack.header.rule ? `border-bottom:0.7pt solid ${pack.colors.primary};` : '';
      const cells = ['left', 'center', 'right'].flatMap(position => [
        `@top-${position}{width:33.333%;content:${region.header ? slot(pack.header[position]) : 'none'};${headerRule}font:8pt ${cssText(pack.typography.bodyFont)},sans-serif;color:${pack.colors.primary};vertical-align:middle;}`,
        `@bottom-${position}{width:33.333%;content:${region.footer ? slot(pack.footer[position]) : 'none'};font:8pt ${cssText(pack.typography.bodyFont)},sans-serif;color:#5b6670;}`
      ]).join('');
      return `@page ${name}{size:${pack.page.size};margin:${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;background-image:${region.watermark ? water : 'none'};background-repeat:no-repeat;background-position:0 0;background-size:${width}mm ${height}mm;${cells}}`;
    }
    const cover = pack.cover.enabled ? `<section class="template-cover ${pack.cover.layout}">${pack.company.logo ? `<img class="template-logo" src="${image(pack.company.logo)}" alt=""/>` : ''}<div class="template-cover-copy">${pack.cover.fields.includes('manual.classification') && fields['manual.classification'] ? `<p class="template-classification">${escape(fields['manual.classification'])}</p>` : ''}<h1>${escape(fields['manual.title'])}</h1><div class="template-cover-fields">${pack.cover.fields.filter(field => field !== 'manual.title' && field !== 'manual.classification' && fields[field]).map(field => `<p><span>${labels[field] || ''}</span><b>${escape(fields[field])}</b></p>`).join('')}</div></div><p class="template-company">${escape(fields['company.name'])}</p></section>` : '';
    const css = `${page('', pack.regions.body)}${page('dita-front', pack.regions.frontMatter)}
      @page dita-cover{size:${pack.page.size};margin:0;background-image:none;@top-left{content:none;}@top-center{content:none;}@top-right{content:none;}@bottom-left{content:none;}@bottom-center{content:none;}@bottom-right{content:none;}}
      html,body{margin:0;padding:0;max-width:none;}body{font-family:${cssText(pack.typography.bodyFont)},"Microsoft YaHei",sans-serif;font-size:${pack.typography.bodySizePt}pt;color:${pack.colors.text};}
      h1,h2,h3,h4,dt{color:${pack.colors.primary};}th,thead td{background:${pack.colors.primary};color:#fff;}a,.toc a,sup.fn-ref{color:${pack.colors.primary};}
      .template-front{page:dita-front;break-after:page;} .template-front .toc{background:none;padding:0;margin:12mm 0;}
      .template-cover{page:dita-cover;break-after:page;box-sizing:border-box;width:${width}mm;height:${height - 0.2}mm;margin:0;padding:24mm;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;background:${pack.colors.primary};color:#fff;}
      .template-cover:before{content:"";position:absolute;right:-45mm;top:-60mm;width:150mm;height:210mm;transform:rotate(-35deg);background:${pack.colors.accent};opacity:0.75;}
      .template-cover-copy{position:relative;margin-top:${dense ? 28 : 64}mm;}.template-cover h1{font-size:${dense || fields['manual.title'].length > 80 ? 17 : fields['manual.title'].length > 55 ? 23 : 32}pt;line-height:1.4;color:inherit;overflow-wrap:anywhere;border:0;margin:0 0 12mm;padding:0;}
      .template-cover-fields p{display:flex;gap:5mm;line-height:1.6;font-size:${dense ? 9 : 11}pt;margin:0 0 3mm;}.template-cover-fields span{opacity:0.75;min-width:20mm;flex-shrink:0;}.template-cover-fields b{min-width:0;font-weight:normal;overflow-wrap:anywhere;}
      .template-classification{font-size:9pt;letter-spacing:2pt;margin-bottom:8mm;opacity:0.8;overflow-wrap:anywhere;}.template-company{position:relative;margin:0;font-size:12pt;overflow-wrap:anywhere;}
      .template-logo{position:absolute;top:20mm;right:24mm;max-width:42mm;max-height:20mm;object-fit:contain;}.template-cover.minimal{background-color:#fff;color:${pack.colors.primary};border-top:5mm solid ${pack.colors.accent};}.template-cover.minimal:before{display:none;}
      ${pack.cover.background ? `.template-cover{background-image:url("${image(pack.cover.background)}");background-size:cover;background-position:center;}.template-cover:before{display:none;}` : ''}
      ${pack.cover.enabled ? '.template-front>h1,.template-front>.publication-scope,.template-front>.publication-version{display:none;}' : ''}
      @media screen{body{background:#edf0f2;}.template-cover{margin:0 auto 16px;}.template-front,body>h2,body>section,body>table,body>div:not(.template-front){background:#fff;}.template-front{padding:18mm;box-sizing:border-box;}}
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

'use strict';
(function (root) {
  const fields = ['manual.title', 'manual.model', 'manual.version', 'manual.releaseDate', 'manual.documentId', 'manual.classification', 'company.name'];
  const pageFields = [...fields, '', 'page.current', 'page.total', 'page.currentTotal'];
  const sizes = { A4: [210, 297], Letter: [215.9, 279.4] };
  function fail(message) { throw Object.assign(Error('交付模板：' + message), { status: 400 }); }
  function object(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(name + '字段无效或不受支持');
    return value;
  }
  function text(value, max, name) { if (typeof value !== 'string' || value.length > max || [...value].some(char => char.codePointAt(0) < 32)) fail(name + '无效或过长'); return value; }
  function choice(value, allowed, name) { if (!allowed.includes(value)) fail(name + '不受支持'); return value; }
  function number(value, min, max, name) { if (!Number.isFinite(value) || value < min || value > max) fail(name + '超出范围'); return value; }
  function flag(value, name) { return choice(value, [true, false], name); }
  function color(value) { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('颜色须为六位十六进制值'); return value.toUpperCase(); }
  function imageSize(data) {
    let binary;
    try { binary = atob(data.split(',')[1]); } catch { fail('图片编码无效'); }
    if (binary.length > 500000) fail('图片不得超过 500 KB');
    const byte = index => binary.charCodeAt(index), word = index => byte(index) * 256 + byte(index + 1);
    let width = 0, height = 0;
    if (data.startsWith('data:image/png;')) {
      if (binary.length < 24 || binary.slice(12, 16) !== 'IHDR') fail('PNG 图片头部无效');
      const uint = index => word(index) * 65536 + word(index + 2); width = uint(16); height = uint(20);
    } else {
      for (let offset = 2; offset + 4 <= binary.length;) {
        if (byte(offset++) !== 255) break;
        while (byte(offset) === 255) offset++;
        const marker = byte(offset++);
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || marker >= 208 && marker <= 215) continue;
        const size = word(offset); if (size < 2 || offset + size > binary.length) break;
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && size >= 7) { height = word(offset + 3); width = word(offset + 5); break; }
        offset += size;
      }
    }
    if (!width || !height || width > 8000 || height > 8000) fail('图片尺寸无效或超过 8000 像素');
  }
  function normalizePackage(raw) {
    const v = object(raw, ['schemaVersion', 'id', 'name', 'version', 'renderer', 'formats', 'company', 'page', 'typography', 'colors', 'cover', 'header', 'footer', 'watermark', 'regions', 'numbering', 'assets'], '模板');
    if (v.schemaVersion !== 1 || v.renderer !== 'manual-v1') fail('模板协议或布局解释器不受支持');
    if (typeof v.id !== 'string' || typeof v.version !== 'string' || v.version.length > 80 || !/^[a-z][a-z0-9-]{0,63}$/.test(v.id) || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]{1,30})?$/.test(v.version)) fail('模板 ID 或版本无效');
    const name = text(v.name, 80, '模板名').trim(); if (!name) fail('模板名不能为空');
    if (!Array.isArray(v.formats) || v.formats.length !== 1 || v.formats[0] !== 'pdf') fail('首版企业模板仅支持 PDF');
    const assets = object(v.assets, Object.keys(v.assets || {}).filter(key => /^assets\/[a-zA-Z0-9_-]{1,80}\.(png|jpe?g)$/.test(key)), '资源');
    if (Object.keys(assets).length > 3) fail('最多使用三张模板图片');
    const normalizedAssets = {};
    for (const key of Object.keys(assets).sort()) {
      const data = assets[key];
      if (typeof data !== 'string' || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > 700000 || data.split(',')[1].length % 4) fail('图片须为不超过 500 KB 的 PNG/JPEG');
      if (!(data.startsWith('data:image/png;base64,iVBORw0KGgo') && /\.png$/.test(key) || data.startsWith('data:image/jpeg;base64,/9j/') && /\.jpe?g$/.test(key))) fail('图片类型与资源不匹配');
      imageSize(data);
      normalizedAssets[key] = data;
    }
    const asset = value => { if (value === null) return null; if (typeof value !== 'string' || !Object.hasOwn(normalizedAssets, value)) fail('缺少图片资源'); return value; };
    const company = object(v.company, ['name', 'logo'], '企业');
    const page = object(v.page, ['size', 'marginsMm'], '纸张'), margins = object(page.marginsMm, ['top', 'right', 'bottom', 'left'], '页边距');
    const typography = object(v.typography, ['bodyFont', 'bodySizePt'], '字体');
    const colors = object(v.colors, ['primary', 'accent', 'text'], '配色');
    const cover = object(v.cover, ['enabled', 'layout', 'background', 'fields'], '封面');
    if (!Array.isArray(cover.fields) || cover.fields.length > fields.length || new Set(cover.fields).size !== cover.fields.length || cover.fields.some(field => !fields.includes(field))) fail('封面字段无效');
    if (cover.enabled && !cover.fields.includes('manual.title')) fail('封面必须包含手册标题');
    const slots = (value, label) => { const part = object(value, ['left', 'center', 'right', ...(label === '页眉' ? ['rule'] : [])], label); return { left: choice(part.left, pageFields, label), center: choice(part.center, pageFields, label), right: choice(part.right, pageFields, label), ...(label === '页眉' ? { rule: flag(part.rule, label) } : {}) }; };
    const watermark = object(v.watermark, ['enabled', 'asset', 'text', 'opacity'], '水印');
    const regions = object(v.regions, ['cover', 'frontMatter', 'body'], '分区');
    const normalizedRegions = {};
    for (const name of ['cover', 'frontMatter', 'body']) {
      const region = object(regions[name], ['header', 'footer', 'watermark'], '分区');
      normalizedRegions[name] = { header: flag(region.header, '页眉'), footer: flag(region.footer, '页脚'), watermark: flag(region.watermark, '水印') };
    }
    if (Object.values(normalizedRegions.cover).some(Boolean)) fail('封面暂不支持页眉、页脚或水印');
    const numbering = object(v.numbering, ['basis', 'startAt'], '页码');
    if (numbering.basis !== 'physical' || numbering.startAt !== 1) fail('首版页码按物理页从 1 计数，可按分区隐藏');
    return { schemaVersion: 1, id: v.id, name, version: v.version, renderer: 'manual-v1', formats: ['pdf'],
      company: { name: text(company.name, 100, '企业名'), logo: asset(company.logo) },
      page: { size: choice(page.size, Object.keys(sizes), '纸张'), marginsMm: Object.fromEntries(['top', 'right', 'bottom', 'left'].map(side => [side, number(margins[side], 12, 40, '页边距')])) },
      typography: { bodyFont: choice(typography.bodyFont, ['Noto Sans CJK SC', 'Microsoft YaHei', 'Arial'], '字体'), bodySizePt: number(typography.bodySizePt, 9, 13, '正文字号') },
      colors: { primary: color(colors.primary), accent: color(colors.accent), text: color(colors.text) },
      cover: { enabled: flag(cover.enabled, '封面'), layout: choice(cover.layout, ['brand-panel', 'minimal'], '封面布局'), background: asset(cover.background), fields: [...cover.fields] },
      header: slots(v.header, '页眉'), footer: slots(v.footer, '页脚'),
      watermark: { enabled: flag(watermark.enabled, '水印'), asset: asset(watermark.asset), text: choice(watermark.text, ['', ...fields], '水印字段'), opacity: number(watermark.opacity, 0.01, 0.15, '水印透明度') },
      regions: normalizedRegions, numbering: { basis: 'physical', startAt: 1 }, assets: normalizedAssets };
  }
  function builtins() {
    const base = { schemaVersion: 1, id: 'enterprise-blue', name: '企业标准 · 蓝绿', version: '1.0.0', renderer: 'manual-v1', formats: ['pdf'],
      company: { name: '', logo: null }, page: { size: 'A4', marginsMm: { top: 22, right: 18, bottom: 20, left: 22 } },
      typography: { bodyFont: 'Noto Sans CJK SC', bodySizePt: 10.5 }, colors: { primary: '#145A78', accent: '#7DB47B', text: '#202B33' },
      cover: { enabled: true, layout: 'brand-panel', background: null, fields: ['manual.title', 'manual.model', 'manual.version', 'manual.releaseDate', 'manual.documentId', 'manual.classification'] },
      header: { left: '', center: '', right: 'company.name', rule: true }, footer: { left: 'page.current', center: '', right: 'manual.documentId' },
      watermark: { enabled: true, asset: null, text: 'company.name', opacity: 0.06 },
      regions: { cover: { header: false, footer: false, watermark: false }, frontMatter: { header: true, footer: false, watermark: true }, body: { header: true, footer: true, watermark: true } },
      numbering: { basis: 'physical', startAt: 1 }, assets: {} };
    return [normalizePackage(base), normalizePackage({ ...base, id: 'enterprise-paper', name: '企业标准 · 简洁', cover: { ...base.cover, layout: 'minimal' }, colors: { primary: '#384F51', accent: '#A88252', text: '#272D2D' } })];
  }
  function capture(template, values) {
    const pack = normalizePackage(template), normalized = {};
    object(values, fields, '交付信息');
    for (const field of fields) normalized[field] = text(values[field] ?? (field === 'company.name' ? pack.company.name : ''), field === 'manual.title' ? 160 : 100, field).trim();
    if (!normalized['manual.title']) fail('请填写手册标题');
    const date = normalized['manual.releaseDate'];
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) fail('发布日期须为有效的 YYYY-MM-DD');
    return { package: pack, fields: normalized };
  }
  const api = { normalizePackage, builtins, capture, sizes, key: pack => pack.id + '@' + pack.version };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaTemplateCore = api;
})(typeof window === 'undefined' ? globalThis : window);

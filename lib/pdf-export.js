'use strict';
const { chromium } = require('playwright-core');
const { ensureCjkFonts } = require('./pdf-fonts');
const templateCore = require('../public/template-core');
const templatePdf = require('../public/template-pdf');
let busy = false;
async function createPdf(html, signal, publication = null) {
  if (typeof html !== 'string' || !html.trim()) throw Object.assign(new Error('PDF 内容不能为空'), { status: 400 });
  if (publication) { publication = templateCore.capture(publication.package, publication.fields); html = templatePdf.render(html, publication); }
  if (busy) throw Object.assign(new Error('PDF 正在生成，请稍后再试'), { status: 429 });
  busy = true;
  let browser, timer;
  const stop = () => { if (browser) void browser.close(); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    if (signal?.aborted) throw new Error('已取消');
    try {
      browser = await chromium.launch({ headless: true, timeout: 15000,
        ...(process.env.DITA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DITA_CHROMIUM_EXECUTABLE } : {}) });
    } catch { throw Object.assign(new Error('PDF 组件未就绪。请运行 npx playwright-core install chromium，或设置 DITA_CHROMIUM_EXECUTABLE 指向 Chromium。'), { status: 503 }); }
    if (signal?.aborted) throw new Error('已取消');
    return await Promise.race([
      (async () => {
        const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
        await context.route('**/*', route => route.abort());
        const page = await context.newPage();
        if (publication && !await page.evaluate(() => typeof globalThis.CSSMarginRule === 'function')) throw Object.assign(Error('当前 Chromium 不支持企业模板的分页页眉，请更新 PDF 组件后重试。'), { status: 503 });
        // The first CSP applies to all supplied markup, including hostile CSS,
        // frames and base URLs. PDF jobs cannot fetch network or local files.
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'">`;
        await page.setContent(csp + html, { waitUntil: 'load', timeout: 15000 });
        await page.emulateMedia({ media: 'print' });
        try { await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images, image => image.decode()));
        }); } catch (cause) { throw Object.assign(new Error('PDF 图片无法解码，请检查正文和模板图片后重试。', { cause }), { status: 400 }); }
        // innerText can be empty when no font has a glyph for the text. Use
        // DOM text, independent of layout, so this exact failure cannot bypass QA.
        const documentText = await page.evaluate(() => {
          const body = document.body.cloneNode(true);
          body.querySelectorAll('script,style,template').forEach(node => node.remove());
          return body.textContent;
        });
        await ensureCjkFonts(documentText + (publication ? Object.values(publication.fields).join('') : ''));
        if (publication) {
          if (await page.evaluate(() => { const cover = document.querySelector('.template-cover'); return cover && cover.scrollHeight > cover.clientHeight + 2; })) throw Object.assign(Error('封面信息超出一页，请缩短标题或交付信息后重新检查。'), { status: 400 });
          // A diagonal SVG text watermark otherwise enters PDF text extraction
          // between body lines. Rasterize only our generated page backgrounds;
          // the actual manual, headings and tables remain searchable text.
          await page.evaluate(async () => {
            const cache = new Map();
            for (const sheet of document.querySelectorAll('style[data-dita-template="pdf"]')) for (const rule of sheet.sheet.cssRules) {
              const background = rule.style?.backgroundImage;
              if (!background?.startsWith('url("data:image/svg+xml,')) continue;
              if (!cache.has(background)) {
                const image = document.createElement('img'); image.src = background.slice(5, -2); await image.decode();
                const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth * 2; canvas.height = image.naturalHeight * 2;
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); cache.set(background, 'url("' + canvas.toDataURL('image/png') + '")');
              }
              rule.style.backgroundImage = cache.get(background);
            }
          });
          return page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
        }
        return page.pdf({ format: 'Letter', preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true,
          headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font:9px Arial;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
          margin: { top: '19mm', bottom: '20mm', left: '18mm', right: '18mm' } });
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('PDF 生成超时，请缩小手册范围后重试'), { status: 503 })), 30000); })
    ]);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', stop);
    try { if (browser) await browser.close(); } finally { busy = false; }
  }
}
async function handlePdfExport(req, res, pathname, { readJson }) {
  if (pathname !== '/api/export/pdf' || req.method !== 'POST') return false;
  const body = await readJson(req), controller = new AbortController();
  const abort = () => controller.abort(); res.once('close', abort);
  try {
    const bytes = await createPdf(body.html, controller.signal, body.publication || null);
    res.removeListener('close', abort);
    if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes); }
  } finally { res.removeListener('close', abort); }
  return true;
}
module.exports = { createPdf, handlePdfExport };

'use strict';
const { chromium } = require('playwright-core');
let busy = false;
async function createPdf(html, signal) {
  if (typeof html !== 'string' || !html.trim()) throw Object.assign(new Error('PDF 内容不能为空'), { status: 400 });
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
        // The first CSP applies to all supplied markup, including hostile CSS,
        // frames and base URLs. PDF jobs cannot fetch network or local files.
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'">`;
        await page.setContent(csp + html, { waitUntil: 'load', timeout: 15000 });
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images, image => image.decode()));
        });
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
    const bytes = await createPdf(body.html, controller.signal);
    res.removeListener('close', abort);
    if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes); }
  } finally { res.removeListener('close', abort); }
  return true;
}
module.exports = { createPdf, handlePdfExport };

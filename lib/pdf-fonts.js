'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
function missingGlyphs(text, charsets) {
  const ranges = charsets.trim().split(/\s+/).filter(Boolean).map(token => token.split('-').map(hex => parseInt(hex, 16)));
  return [...new Set(text.match(/\p{Script=Han}/gu) || [])].filter(char => {
    const point = char.codePointAt(0);
    return !ranges.some(([start, end = start]) => point >= start && point <= end);
  });
}
async function ensureCjkFonts(text) {
  if (process.platform !== 'linux' || !/\p{Script=Han}/u.test(text)) return;
  let stdout;
  try { ({ stdout } = await run('fc-list', ['--format=%{charset}\n'], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 })); }
  catch { throw Object.assign(new Error('PDF 中文字体检测不可用。请安装 fontconfig 和中文字体（例如 fonts-noto-cjk），然后重试。'), { status: 503 }); }
  const missing = missingGlyphs(text, stdout);
  if (missing.length) throw Object.assign(new Error('PDF 中文字体未就绪，缺少字形：' + missing.slice(0, 8).join('') + '。请安装覆盖这些字符的中文字体（例如 fonts-noto-cjk），然后重试；可运行 npm run check:pdf 检查环境。'), { status: 503 });
}
module.exports = { ensureCjkFonts, missingGlyphs };

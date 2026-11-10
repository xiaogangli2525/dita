'use strict';
(function (root) {

  function escapeHtmlAttr(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderHtmlDocument({ title, model = '', version = '', sections, footnotes = [] }) {
    const css = [
      'body { font-family: Segoe UI, Microsoft YaHei, sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #202124; line-height: 1.7; }',
      'h1 { font-size: 28px; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; }',
      'h2 { font-size: 22px; color: #1a73e8; margin-top: 32px; border-bottom: 1px solid #e4e7ea; padding-bottom: 6px; }',
      'h3 { font-size: 18px; color: #385667; margin-top: 24px; }',
      'hr { border: none; border-top: 1px solid #e4e7ea; margin: 32px 0; }',
      'pre { background: #f5f7f9; color: #263b48; border: 1px solid #e4e9ed; padding: 12px 14px; border-radius: 4px; font: 13px/1.7 Consolas, "Noto Sans Mono CJK SC", monospace; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4; }',
      'code { font-family: Consolas, Courier New, monospace; font-size: 0.9em; }',
      'code.filepath { color: #c5221f; background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }',
      'sup.fn-ref { font-size: 0.8em; color: #1a73e8; cursor: pointer; }',
      'ins.oxy-insert { background: #e6f4ea; border-bottom: 2px solid #34a853; text-decoration: none; }',
      'del.oxy-delete { background: #fce8e6; text-decoration: line-through; color: #d93025; }',
      'span.oxy-comment { border-bottom: 2px dotted #4285f4; cursor: help; background: rgba(66,133,244,0.08); }',
      'table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 14px 0; font-size: 14px; }',
      'th, td { border: 1px solid #cbd5dd; padding: 7px 9px; vertical-align: top; }',
      'th, thead td { background: #f0f6f9; font-weight: 600; } td, th { overflow-wrap: anywhere; } tr[data-dita-outputclass~="has_bgc"] > td { background: #f5f8fa; font-weight: 600; }',
      'dl { margin: 10px 0; padding-left: 16px; }',
      'dt { font-weight: 600; color: #385667; }',
      'dd { margin: 2px 0 6px 16px; }',
      '.toc { background: #f8f9fa; padding: 16px 20px; border-radius: 8px; margin-bottom: 28px; }',
      '.toc h2 { font-size: 18px; margin-top: 0; border: none; }',
      '.toc ol { padding-left: 20px; margin: 8px 0; }',
      '.toc a { color: #1a73e8; text-decoration: none; }',
      '.toc a:hover { text-decoration: underline; }',
      '.error { color: #d93025; font-size: 13px; }',
      '.dita-note { display: block; padding: 12px 16px; margin: 18px 0; border-radius: 0 5px 5px 0; border-left: 3px solid #4d7b97; background: #f2f7fa; } .note-label { display: block; margin-bottom: 4px; }',
      '.dita-note > .note-body > :first-child { margin-top:0; } .dita-note > .note-body > :last-child { margin-bottom:0; }',
      '.dita-note .note-body ul, .dita-note .note-body ol { margin: 4px 0; padding-left: 20px; }',
      '.dita-note.dita-note-tip { border-color: #34a853; background: #e6f4ea; }',
      '.dita-note.dita-note-caution, .dita-note.dita-note-warning { border-color: #d93025; background: #fce8e6; }',
      '.dita-note.dita-note-important { border-color: #f9ab00; background: #fef7e0; }',
      '.code-block { background: #f5f7f9; color: #263b48; padding: 12px 14px; border-radius: 4px; overflow-wrap: anywhere; font-family: Consolas, "Noto Sans Mono CJK SC", monospace; font-size: 13px; line-height: 1.7; tab-size: 4; }',
      '.code-block code { color: inherit; font-size: inherit; background: none; padding: 0; }',
      '.dita-note .code-block { background: #f5f7f9; margin: 8px 0; } .dita-note[data-note-tone="tip"] { border-color:#308477;background:#f1f8f5; } .dita-note[data-note-tone="attention"] { border-color:#a47a26;background:#fcf8ee; } .dita-note[data-note-tone="danger"] { border-color:#af4d53;background:#fcf3f3; }',
      'figure { margin: 16px 0; text-align: center; }',
      'figure figcaption, .figtitle { font-size: 13px; color: #5f6368; margin-top: 8px; font-style: italic; }',
      'section { margin: 20px 0; }',
      '.export-footnotes { margin-top:40px; padding-top:12px; border-top:1px solid #dce5eb; font-size:14px; }',
      '.export-footnotes > ol { margin:16px 0; padding-left:30px; } .export-footnotes > ol > li { padding:12px 14px; margin:0 0 12px; border:1px solid #e2e9ee; border-radius:6px; background:#fafcfd; overflow-wrap:anywhere; line-height:1.8; }',
      '.export-footnotes li::marker { color:#597080; font-weight:600; } .footnote-content > :first-child { margin-top:0; } .footnote-content > :last-child { margin-bottom:0; } .footnote-content p, .footnote-content div { margin:4px 0; }',
      'a.footnote-backlink { display:inline-block; margin-top:8px; font-size:12px; color:#426b80; text-decoration:none; } a.footnote-backlink:hover { text-decoration:underline; }',
      '@media print { .export-footnotes > ol > li { background:none; border:0; border-bottom:1px solid #ddd; border-radius:0; } a.footnote-backlink { display:none; } }'

    ].join('\n');
    let toc = '<nav class="toc"><h2>\u76ee\u5f55</h2><ol>';
    sections.forEach((sec, i) => { toc += '<li><a href="#sec-' + i + '">' + escapeHtmlAttr(sec.title) + '</a></li>'; });
    toc += '</ol></nav>';
    let body = '';
    sections.forEach((sec, i) => {
      body += '<h2 id="sec-' + i + '" style="scroll-margin-top: 20px;">' + escapeHtmlAttr(sec.title) + '</h2>\n' + sec.body + '\n';
      if (i < sections.length - 1) body += '<hr>\n';
    });
    if (footnotes?.length) body += '<section class="export-footnotes"><h2>注脚</h2><ol>' + footnotes.map((text, i) => '<li id="fn-' + (i + 1) + '"><div class="footnote-content">' + text + '</div><a class="footnote-backlink" href="#fnref-' + (i + 1) + '-1" aria-label="返回正文">↩ 返回正文</a></li>').join('') + '</ol></section>';
    const html = [
      '<!DOCTYPE html>',
      '<html lang="zh-CN"><head><meta charset="utf-8"/>',
      '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
      '<title>' + escapeHtmlAttr(title) + '</title>',
      '<style>' + css + '</style></head><body>',
      '<h1>' + escapeHtmlAttr(title) + '</h1>',
      model ? '<p class="publication-scope">适用型号：' + escapeHtmlAttr(model) + '。</p>' : '',
      version ? '<p class="publication-version">文档版本：' + escapeHtmlAttr(version) + '</p>' : '',
      toc,
      body,
      '</body></html>'
    ].join('\n');
    return html;
  }

  const api = { renderHtmlDocument };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDeliveryDocument = api;
})(typeof window === 'undefined' ? globalThis : window);

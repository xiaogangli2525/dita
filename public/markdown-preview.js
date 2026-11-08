'use strict';
(function (root) {
  const assets = typeof module !== 'undefined' ? require('./asset-core') : root.DitaAssetCore;

  function escapeHtmlAttr(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function highlightMarkdown(md) {
    function esc(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    const lines = esc(md).split(/\n/);
    let out = [];
    let inCode = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (line.match(/^```/)) {
        inCode = !inCode;
        out.push('<span class="md-code-fence">' + line + '</span>');
        continue;
      }
      if (inCode) { out.push('<span class="md-code-line">' + line + '</span>'); continue; }
      let h = line;
      h = h.replace(/^(#{1,3})\s/, '<span class="md-heading">$1 </span>');
      h = h.replace(/^(&gt;\s?)/, '<span class="md-quote">$1</span>');
      h = h.replace(/^([-*]\s)/, '<span class="md-list">$1</span>');
      h = h.replace(/^(\d+\.\s)/, '<span class="md-list">$1</span>');
      h = h.replace(/^(---\s*)$/, '<span class="md-hr">$1</span>');
      h = h.replace(/^(\|)/, '<span class="md-table">$1</span>');
      h = h.replace(/(`[^`]+`)/g, '<span class="md-inline-code">$1</span>');
      h = h.replace(/(\*\*[^*]+\*\*)/g, '<span class="md-bold">$1</span>');
      h = h.replace(/(~~[^~]+~~)/g, '<span class="md-strike">$1</span>');
      h = h.replace(/(!\[[^\]]*\]\([^)]+\))/g, '<span class="md-image">$1</span>');
      h = h.replace(/(\[[^\]]*\]\([^)]+\))/g, '<span class="md-link">$1</span>');
      h = h.replace(/(\[\^\d+\])/g, '<span class="md-fn">$1</span>');
      out.push(h);
    }
    return out.join('\n');
  }
  function renderMarkdownToHtml(md) {
    const esc = value => escapeHtmlAttr(String(value));
    function imgSrc(src) {
      if (/^data:image\/(?:png|jpe?g|gif|bmp|webp|svg\+xml);base64,[a-z\d+/=]+$/i.test(src)) return src;
      if (!assets.safeLinkHref(src) || /^[a-z][a-z\d+.-]*:/i.test(src) && !/^https?:/i.test(src)) return '';
      if (/^https?:/i.test(src) || src.startsWith('/')) return src;
      return '/api/asset?path=' + encodeURIComponent(src);
    }
    function textStyle(text) {
      return esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[\^(\d+)\]/g, '<sup class="fn-ref">[$1]</sup>');
    }
    function inline(text) {
      // Parse source tokens once. Formatting must never run over generated tags
      // or their attribute values, which could turn nested Markdown into HTML.
      const pattern = /`([^`]+)`|(!?)\[([^\]]*)\]\(([^)]+)\)/g;
      let result = '', cursor = 0, match;
      while ((match = pattern.exec(text))) {
        result += textStyle(text.slice(cursor, match.index));
        if (match[1] !== undefined) result += '<code>' + esc(match[1]) + '</code>';
        else {
          const target = match[2] ? imgSrc(match[4].trim()) : assets.safeLinkHref(match[4].trim());
          result += !target ? esc(match[3]) : match[2]
            ? '<img src="' + esc(target) + '" alt="' + esc(match[3]) + '"/>'
            : '<a href="' + esc(target) + '">' + esc(match[3]) + '</a>';
        }
        cursor = pattern.lastIndex;
      }
      return result + textStyle(text.slice(cursor));
    }
    const lines = md.split(/\n/);
    let html = '';
    let i = 0;
    while (i < lines.length) {
      let line = lines[i];
      if (/^```/.test(line)) {
        const lang = line.replace(/^```/, '').trim();
        let code = '';
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code += lines[i] + '\n'; i++; }
        i++;
        html += '<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(code.replace(/\n$/,'')) + '</code></pre>\n';
        continue;
      }
      if (/^(#{1,3})\s+/.test(line)) {
        const m = line.match(/^(#{1,3})\s+(.*)/);
        const level = m[1].length;
        html += '<h' + level + '>' + inline(m[2]) + '</h' + level + '>\n';
        i++; continue;
      }
      if (/^---\s*$/.test(line)) { html += '<hr/>\n'; i++; continue; }
      if (/^>\s?/.test(line)) {
        let bq = '';
        while (i < lines.length && /^>\s?/.test(lines[i])) { bq += lines[i].replace(/^>\s?/, '') + '\n'; i++; }
        html += '<blockquote>' + inline(bq.trim()) + '</blockquote>\n';
        continue;
      }
      if (/^\|/.test(line)) {
        let tableLines = [];
        while (i < lines.length && /^\|/.test(lines[i])) { tableLines.push(lines[i]); i++; }
        if (tableLines.length >= 2) {
          const header = tableLines[0].split('|').filter(c => c.trim() !== '').map(c => c.trim());
          html += '<table><thead><tr>';
          header.forEach(h => html += '<th>' + inline(h) + '</th>');
          html += '</tr></thead><tbody>';
          for (let r = 2; r < tableLines.length; r++) {
            const cells = tableLines[r].split('|').filter(c => c.trim() !== '').map(c => c.trim());
            html += '<tr>';
            cells.forEach(c => html += '<td>' + inline(c) + '</td>');
            html += '</tr>';
          }
          html += '</tbody></table>\n';
        }
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        let items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
        html += '<ul>';
        items.forEach(it => html += '<li>' + inline(it) + '</li>');
        html += '</ul>\n';
        continue;
      }
      if (/^\d+\.\s+/.test(line)) {
        let items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
        html += '<ol>';
        items.forEach(it => html += '<li>' + inline(it) + '</li>');
        html += '</ol>\n';
        continue;
      }
      if (line.trim() === '') { i++; continue; }
      let para = line;
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|```|>|\||[-*]\s|\d+\.\s|---)/.test(lines[i])) {
        para += ' ' + lines[i]; i++;
      }
      html += '<p>' + inline(para) + '</p>\n';
    }
    return html;
  }


  const api = { highlightMarkdown, renderMarkdownToHtml };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaMarkdownPreview = api;
})(typeof window === 'undefined' ? globalThis : window);

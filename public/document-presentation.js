'use strict';
(function (root) {
  // Presentation vocabulary shared by Author, content settings and delivery.
  // Labels are generated UI metadata, never authored XML children.
  const noteTypes = Object.freeze({ note: '说明', tip: '提示', important: '重要', attention: '关注', caution: '注意', warning: '警告', danger: '危险', notice: '须知', restriction: '限制', remember: '提醒', fastpath: '快捷方法', trouble: '故障排查', other: '其他' });
  function note(type = 'note', other = '') {
    const tone = ['danger', 'warning'].includes(type) ? 'danger' : ['caution', 'attention', 'restriction', 'important'].includes(type) ? 'attention' : ['tip', 'fastpath'].includes(type) ? 'tip' : 'info';
    return { label: type === 'other' && other.trim() ? other.trim() : noteTypes[type] || '说明', tone };
  }
  const preformatted = new Set(['codeblock', 'msgblock', 'screen', 'pre', 'lines']);
  const api = { noteTypes, note, preformatted };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaDocumentPresentation = api;
})(typeof window === 'undefined' ? globalThis : window);

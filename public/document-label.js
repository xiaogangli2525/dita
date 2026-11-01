'use strict';
(function (root) {
  const labels = new WeakMap();
  /** @param {import('./contracts').DocumentState} file */
  function documentLabel(file) {
    if (!file) return '';
    const cached = labels.get(file);
    if (cached?.source === file.current) return cached.label;
    const xml = new DOMParser().parseFromString(file.current, 'application/xml');
    const title = xml.querySelector('parsererror') ? null : xml.querySelector('booktitle > mainbooktitle, :root > title');
    const label = title?.textContent.trim() || file.path.split('/').pop();
    labels.set(file, { source: file.current, label });
    return label;
  }
  root.DitaDocumentLabel = { documentLabel };
})(window);

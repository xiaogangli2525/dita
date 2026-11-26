// @ts-check
'use strict';
(function (root) {
  const structure = typeof module !== 'undefined' ? require('./knowledge-structure') : root.DitaKnowledgeStructure;
  /** @param {ParentNode} content */
  const linkedNotes = (content, omitDeleted = false) => [...new Set([...content.querySelectorAll('sup.fn-ref a[href]')]
    .filter(link => !omitDeleted || !link.closest('del.oxy-delete'))
    .map(link => link.getAttribute('href')?.slice(1) ?? ''))];
  // Only published HTML reaches this adapter; it never parses unfiltered DITA.
  /** @param {string} html @param {string} id */
  function extractManual(html, id, Parser = root.DOMParser) {
    if (!/^m-[a-f0-9]{12,64}$/.test(id)) throw new Error('知识库手册标识无效');
    const doc = new Parser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,link,meta,base,form,input,button').forEach(node => node.remove());
    for (const element of doc.querySelectorAll('*')) {
      for (const attr of [...element.attributes]) if (/^on/i.test(attr.name)) element.removeAttribute(attr.name);
      if (element.id) element.id = id + '--' + element.id;
      const href = element.getAttribute('href');
      if (href !== null) {
        if (href.startsWith('#')) element.setAttribute('href', '#' + id + '--' + href.slice(1));
        else if (!/^(https?:|mailto:)/i.test(href)) throw new Error('知识库包含不可离线定位的链接：' + href);
      }
      if (element.localName === 'img' && !/^data:image\//i.test(element.getAttribute('src') || '')) throw new Error('知识库图片未打包为离线资源');
    }
    doc.body.querySelectorAll(':scope > h1,:scope > .publication-scope,:scope > .publication-version,:scope > nav.toc').forEach(node => node.remove());
    const headings = [...doc.body.querySelectorAll('h2[id]')].filter(node => node.id.startsWith(id + '--sec-'));
    if (!headings.length) throw new Error('手册没有可发布的章节');
    const footnotes = doc.body.querySelector('.export-footnotes');
    // Keep revision markup in the reader. Index the text with deletions omitted.
    const indexTree = (/** @type {Node} */ node) => structure.tree(node, { omitDeleted: true });
    const noteMap = structure.definitions(indexTree(doc.body));
    const entries = headings.map((heading, index) => {
      const range = doc.createRange(); range.setStartBefore(heading);
      if (headings[index + 1]) range.setEndBefore(headings[index + 1]);
      else if (footnotes) range.setEndBefore(footnotes);
      else range.setEnd(doc.body, doc.body.childNodes.length);
      const content = range.cloneContents();
      const indexed = indexTree(content);
      const notes = linkedNotes(content, true).map(key => {
        const node = doc.getElementById(key)?.querySelector('.footnote-content');
        return node ? structure.rawText(indexTree(node)) : '';
      });
      const text = structure.prose([structure.rawText(indexed), ...notes].join(' '));
      const title = structure.rawText(indexTree(heading)).trim(), blocks = structure.extract(indexed, noteMap, heading.id);
      range.deleteContents(); range.insertNode(content);
      return { anchor: heading.id, title, text, structure: structure.seal(title, text, blocks.units, blocks.warnings) };
    });
    const toc = entries.map(({ anchor, title }) => ({ anchor, title }));
    return { body: doc.body.innerHTML, toc, entries };
  }
  /** @param {string} body @param {string} anchor */
  function chapterPage(body, anchor, Parser = root.DOMParser) {
    const doc = new Parser().parseFromString(body, 'text/html'), heading = doc.getElementById(anchor);
    if (!heading) throw Error('章节原文不存在，请重新核对来源');
    const headings = [...doc.querySelectorAll('h2[id]')].filter(node => /^m-[a-f0-9]+--sec-\d+$/.test(node.id));
    const next = headings[headings.indexOf(heading) + 1], footnotes = doc.querySelector('.export-footnotes');
    const range = doc.createRange(); range.setStartBefore(heading);
    if (next) range.setEndBefore(next); else if (footnotes) range.setEndBefore(footnotes); else range.setEnd(doc.body, doc.body.childNodes.length);
    const content = range.cloneContents(), holder = doc.createElement('main'); holder.append(content);
    const ids = linkedNotes(holder);
    const notes = ids.map(id => doc.getElementById(id)?.outerHTML || '').join('');
    return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:24px;color:#253744;font:14px/1.8 system-ui,sans-serif}h2{font-size:22px}h3{font-size:18px}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #d5e0e6;padding:9px;vertical-align:top}th{background:#f1f5f8}pre{white-space:pre-wrap;background:#f3f6f8;padding:12px;overflow-wrap:anywhere;font:12px/1.7 Consolas,monospace}img{max-width:100%}.dita-note{padding:10px 14px;background:#f0f6fa;border-left:3px solid #527f9b}a{color:#356c94}[data-chunk-active]{outline:3px solid #c18c39;outline-offset:3px;background-color:#fff5df!important}li{margin:8px 0}.footnote-backlink{font-size:12px}</style>' + holder.outerHTML + (notes ? '<section><h3>本章关联注脚</h3><ol>' + notes + '</ol></section>' : '') + '</html>';
  }
  const api = { extractManual, chapterPage };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeDocument = api;
})(typeof window === 'undefined' ? globalThis : window);

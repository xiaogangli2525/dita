'use strict';
(function (root) {
  // Only published HTML reaches this adapter; it never parses unfiltered DITA.
  function extractManual(html, id, Parser = root.DOMParser) {
    if (!/^m-[a-f0-9]{12,64}$/.test(id)) throw new Error('知识库手册标识无效');
    const doc = new Parser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,iframe,object,embed,link,meta,base,form,input,button').forEach(node => node.remove());
    for (const element of doc.querySelectorAll('*')) {
      for (const attr of [...element.attributes]) if (/^on/i.test(attr.name)) element.removeAttribute(attr.name);
      if (element.id) element.id = id + '--' + element.id;
      if (element.hasAttribute('href')) {
        const href = element.getAttribute('href');
        if (href.startsWith('#')) element.setAttribute('href', '#' + id + '--' + href.slice(1));
        else if (!/^(https?:|mailto:)/i.test(href)) throw new Error('知识库包含不可离线定位的链接：' + href);
      }
      if (element.localName === 'img' && !/^data:image\//i.test(element.getAttribute('src') || '')) throw new Error('知识库图片未打包为离线资源');
    }
    doc.body.querySelectorAll(':scope > h1,:scope > .publication-scope,:scope > .publication-version,:scope > nav.toc').forEach(node => node.remove());
    const headings = [...doc.body.querySelectorAll('h2[id]')].filter(node => node.id.startsWith(id + '--sec-'));
    if (!headings.length) throw new Error('手册没有可发布的章节');
    const footnotes = doc.body.querySelector('.export-footnotes');
    const entries = headings.map((heading, index) => {
      const range = doc.createRange(); range.setStartBefore(heading);
      if (headings[index + 1]) range.setEndBefore(headings[index + 1]);
      else if (footnotes) range.setEndBefore(footnotes);
      else range.setEnd(doc.body, doc.body.childNodes.length);
      const content = range.cloneContents();
      const notes = [...new Set([...content.querySelectorAll('sup.fn-ref a[href]')].map(link => link.getAttribute('href').slice(1)))];
      const text = [content.textContent, ...notes.map(key => doc.getElementById(key)?.querySelector('.footnote-content')?.textContent || '')].join(' ').replace(/\s+/g, ' ').trim();
      return { anchor: heading.id, title: heading.textContent.trim(), text };
    });
    const toc = headings.map(heading => ({ anchor: heading.id, title: heading.textContent.trim() }));
    return { body: doc.body.innerHTML, toc, entries };
  }
  const api = { extractManual };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeDocument = api;
})(typeof window === 'undefined' ? globalThis : window);

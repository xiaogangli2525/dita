'use strict';
(function (root) {
  const { parseXml, serializeXmlNode, xmlNodePath } = typeof module !== 'undefined' ? require('./xml-dom') : root.DitaXmlDom;
  const assetCore = typeof module !== 'undefined' ? require('./asset-core') : root.DitaAssetCore;
  const presentation = typeof module !== 'undefined' ? require('./document-presentation') : root.DitaDocumentPresentation;
  const { normalizeOxyPIs } = typeof module !== 'undefined' ? require('./oxygen-core') : root.DitaOxygenCore;
  const BODY_TAGS = presentation.bodies, resolveAssetPath = assetCore.resolveAssetPath;
  const createAuthorContext = (topicPath = '') => ({ topicPath, fnCounter: 0 });

  // Source-only attributes remain in inert metadata, never active HTML. Keeping
  // them separately also preserves exact XML when adjacent prose is edited.
  function setAuthorAttribute(element, name, value) {
    const local = name.toLowerCase();
    const unsafeHref = local === 'href' && !assetCore.safeLinkHref(value);
    if (/^(?:on|data-|src|form|xmlns)/.test(local) || ['style', 'class', 'contenteditable', 'autofocus', 'is', 'tabindex'].includes(local) || unsafeHref) {
      const saved = JSON.parse(element.getAttribute('data-dita-inert-attrs') || '{}');
      Object.defineProperty(saved, name, { value, enumerable: true, configurable: true, writable: true });
      element.setAttribute('data-dita-inert-attrs', JSON.stringify(saved));
    } else element.setAttribute(name, value);
  }

  function authorHeading(node, documentRef, tag = 'h3', ctx) {
    const heading = documentRef.createElement(tag);
    heading.ditaSourcePath = xmlNodePath(node);
    for (const attr of Array.from(node.attributes || [])) setAuthorAttribute(heading, attr.name, attr.value);
    for (const child of node.childNodes) { const rendered = renderDitaNode(child, documentRef, ctx); if (rendered) heading.appendChild(rendered); }
    return heading;
  }
  function createAuthorTopic(source, documentRef, normalizeOxy = false, topicPath = '', parsed = null) {
    const ctx = createAuthorContext(topicPath);
    const doc = parsed || parseXml(source);
    if (normalizeOxy) normalizeOxyPIs(doc, true);
    const root = doc.documentElement;
    const container = documentRef.createElement('article');
    container.ditaSourceContent = source;
    const sourceTitle = Array.from(root.childNodes).find(node => node.localName === 'title');
    const title = sourceTitle ? authorHeading(sourceTitle, documentRef, 'h2', ctx) : documentRef.createElement('h2');
    container.appendChild(title);
    const summary = Array.from(root.childNodes).find(node => node.localName === 'shortdesc');
    if (summary) container.appendChild(renderDitaNode(summary, documentRef, ctx));
    const body = Array.from(root.childNodes).find(node => BODY_TAGS.has(node.localName));
    const bodyContainer = documentRef.createElement('div');
    bodyContainer.setAttribute('data-dita-body', 'true');
    if (body) {
      for (const node of body.childNodes) {
        const rendered = renderDitaNode(node, documentRef, ctx);
        if (rendered) bodyContainer.appendChild(rendered);
      }
    }
    if (!bodyContainer.childNodes.length) {
      const placeholder = documentRef.createElement('p');
      placeholder.setAttribute('data-dita-source', 'p'); placeholder.setAttribute('data-dita-placeholder', 'true');
      bodyContainer.appendChild(placeholder);
    }
    container.appendChild(bodyContainer);
    return container;
  }

  function renderFootnoteMarker(node, documentRef, inline, ctx) {
    const marker = documentRef.createElement('sup'); marker.className = 'fn-ref';
    marker.setAttribute('data-dita-source', node.localName);
    marker.setAttribute('data-dita-original', serializeXmlNode(node));
    if (node.localName === 'xref') marker.setAttribute('type', 'fn');
    else if (!inline) marker.setAttribute('data-fn-definition', 'true');
    marker.setAttribute('contenteditable', 'false'); marker.setAttribute('role', 'button'); marker.setAttribute('tabindex', '0');
    const label = inline ? String(++ctx.fnCounter) : node.localName === 'fn' ? '定义' : '?';
    marker.setAttribute('aria-label', '注脚 ' + label + '，双击或按 Enter 编辑'); marker.textContent = '[' + label + ']';
    marker.title = node.textContent.trim() + ' · 双击编辑'; marker.setAttribute('data-fn-text', node.textContent.trim());
    return marker;
  }

  function renderDitaNode(node, documentRef, ctx = createAuthorContext()) {
    const rendered = renderAuthorNode(node, documentRef, ctx);
    if (rendered && node.nodeType === 1) rendered.ditaSourcePath = xmlNodePath(node);
    return rendered;
  }

  function renderAuthorNode(node, documentRef, ctx) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      const text = node.data.replace(/\s+/g, ' ');
      if (text.trim()) return documentRef.createTextNode(text);
      return null;
    }
    if (node.nodeType !== 1) return null;
    const tag = node.localName;
    if (tag === 'title') return null;
    if (tag === 'shortdesc') {
      const element = documentRef.createElement('p');
      element.setAttribute('data-dita-source', 'shortdesc');
      for (const attribute of Array.from(node.attributes || [])) setAuthorAttribute(element, attribute.name, attribute.value);
      for (const child of node.childNodes) {
        const rendered = renderDitaNode(child, documentRef, ctx);
        if (rendered) element.appendChild(rendered);
      }
      return element;
    }
    if (tag === 'note') {
      const element = documentRef.createElement('div');
      element.className = `note ${node.getAttribute('type') || ''}`.trim();
      element.setAttribute('data-dita-source', 'note');
      const detail = presentation.note(node.getAttribute('type') || 'note', node.getAttribute('othertype') || '');
      element.setAttribute('data-dita-note-label', detail.label); element.setAttribute('data-dita-note-tone', detail.tone);
      for (const attribute of Array.from(node.attributes || [])) {
        if (attribute.name !== 'type') setAuthorAttribute(element, attribute.name, attribute.value);
      }
      for (const child of node.childNodes) {
        const rendered = renderDitaNode(child, documentRef, ctx);
        if (rendered) element.appendChild(rendered);
      }
      return element;
    }
    if (presentation.preformatted.has(tag)) {
      const element = documentRef.createElement('pre');
      element.setAttribute('data-dita-source', tag);
      for (const attribute of Array.from(node.attributes || [])) setAuthorAttribute(element, attribute.name, attribute.value);
      function exactChild(child) {
        if (child.nodeType === 3 || child.nodeType === 4) return documentRef.createTextNode(child.data);
        const rendered = renderDitaNode(child, documentRef, ctx);
        if (rendered && child.nodeType === 1 && child.localName !== 'image' && child.localName !== 'fn' && !(child.localName === 'xref' && child.getAttribute('type') === 'fn')) {
          rendered.replaceChildren(...Array.from(child.childNodes).map(exactChild).filter(Boolean));
        }
        return rendered;
      }
      for (const child of node.childNodes) { const rendered = exactChild(child); if (rendered) element.appendChild(rendered); }
      return element;
    }
    if (tag === 'image') {
      const element = documentRef.createElement('img');
      const href = node.getAttribute('href') || '';
      element.src = '/api/asset?path=' + encodeURIComponent(resolveAssetPath(href, ctx));
      const presentation = assetCore.imagePresentation(node);
      element.alt = presentation.alt;
      const dimensions = ['width', 'height'].filter(name => presentation[name]).map(name => name + ':' + presentation[name] + ';').join('');
      if (dimensions) element.setAttribute('style', dimensions);
      element.setAttribute('data-dita-source', 'image');
      element.setAttribute('data-dita-original', serializeXmlNode(node));
      element.setAttribute('data-dita-href', href);
      for (const attribute of Array.from(node.attributes || [])) {
        if (!['href', 'alt'].includes(attribute.name)) setAuthorAttribute(element, attribute.name, attribute.value);
      }
      return element;
    }
    if (tag === 'table') {
      const wrapper = documentRef.createElement('div');
      wrapper.setAttribute('data-dita-source', 'table');
      // Keep the original table structure available while editing cells. This
      // lets the serializer retain colspecs, tgroup attributes, captions, and
      // other DITA table metadata that has no direct HTML equivalent.
      wrapper.setAttribute('data-dita-original', serializeXmlNode(node));
      for (const attribute of Array.from(node.attributes || [])) setAuthorAttribute(wrapper, attribute.name, attribute.value);
      const sourceTitle = Array.from(node.childNodes).find(child => child.localName === 'title');
      if (sourceTitle) wrapper.appendChild(authorHeading(sourceTitle, documentRef, 'h3', ctx));
      const rows = [];
      const collectRows = (current, section = 'tbody') => {
        for (const child of Array.from(current.childNodes || [])) {
          if (child.nodeType !== 1) continue;
          const nextSection = child.localName === 'thead' || child.localName === 'tbody' ? child.localName : section;
          if (child.localName === 'row') rows.push({ node: child, section: nextSection });
          else collectRows(child, nextSection);
        }
      };
      collectRows(node);
      const htmlTable = documentRef.createElement('table');
      const specs = Array.from(node.querySelectorAll('colspec')), names = specs.map(spec => spec.getAttribute('colname'));
      if (specs.length) {
        const colgroup = documentRef.createElement('colgroup');
        const total = specs.reduce((sum, spec) => sum + (/^\d+(?:\.\d+)?\*$/.test(spec.getAttribute('colwidth') || '') ? parseFloat(spec.getAttribute('colwidth')) : 0), 0);
        for (const spec of specs) {
          const col = documentRef.createElement('col'), width = spec.getAttribute('colwidth') || '';
          if (col.style && /^\d+(?:\.\d+)?(?:mm|cm|in|pt|pc|px)$/.test(width)) col.style.width = width;
          else if (col.style && /^\d+(?:\.\d+)?\*$/.test(width) && total) col.style.width = (parseFloat(width) / total * 100) + '%';
          colgroup.appendChild(col);
        }
        htmlTable.appendChild(colgroup);
      }
      const htmlSections = new Map();
      for (const item of rows) {
        const row = item.node;
        const tr = documentRef.createElement('tr');
        tr.ditaSourcePath = xmlNodePath(row);
        tr.setAttribute('data-dita-row-attrs', JSON.stringify(Object.fromEntries(Array.from(row.attributes || []).map(attribute => [attribute.name, attribute.value]))));
        tr.setAttribute('data-dita-section', item.section);
        if (row.getAttribute('outputclass')) tr.setAttribute('data-dita-outputclass', row.getAttribute('outputclass'));
        for (const entry of row.children) {
          const cell = documentRef.createElement(item.section === 'thead' ? 'th' : 'td');
          cell.ditaSourcePath = xmlNodePath(entry);
          cell.setAttribute('data-dita-source', 'entry');
          const first = names.indexOf(entry.getAttribute('namest')), last = names.indexOf(entry.getAttribute('nameend'));
          if (first >= 0 && last > first) cell.setAttribute('colspan', String(last - first + 1));
          if (/^\d+$/.test(entry.getAttribute('morerows') || '')) cell.setAttribute('rowspan', String(Number(entry.getAttribute('morerows')) + 1));
          cell.setAttribute('data-dita-entry-attrs', JSON.stringify(Object.fromEntries(Array.from(entry.attributes || []).map(attribute => [attribute.name, attribute.value]))));
          for (const child of entry.childNodes || []) {
            const rendered = child.nodeType === 3
              ? documentRef.createTextNode(child.data)
              : renderDitaNode(child, documentRef, ctx);
            if (rendered) cell.appendChild(rendered);
          }
          tr.appendChild(cell);
        }
        let section = htmlSections.get(item.section);
        if (!section) {
          section = documentRef.createElement(item.section === 'thead' ? 'thead' : 'tbody');
          htmlSections.set(item.section, section);
          htmlTable.appendChild(section);
        }
        section.appendChild(tr);
      }
      wrapper.appendChild(htmlTable);
      return wrapper;
    }
    if (['ul', 'ol', 'sl'].includes(tag)) {
      const element = documentRef.createElement(tag === 'sl' ? 'ul' : tag);
      element.setAttribute('data-dita-source', tag);
      for (const attr of Array.from(node.attributes || [])) setAuthorAttribute(element, attr.name, attr.value);
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (['li', 'sli'].includes(child.localName)) {
          const item = documentRef.createElement('li');
          item.ditaSourcePath = xmlNodePath(child);
          item.setAttribute('data-dita-source', child.localName === 'sli' ? 'sli' : 'li');
          for (const attr of Array.from(child.attributes || [])) setAuthorAttribute(item, attr.name, attr.value);
          for (const nested of child.childNodes) {
            const rendered = renderDitaNode(nested, documentRef, ctx);
            if (rendered) item.appendChild(rendered);
          }
          element.appendChild(item);
        } else {
          const rendered = renderDitaNode(child, documentRef, ctx);
          if (rendered) element.appendChild(rendered);
        }
      }
      return element;
    }
    if (['p', 'example', 'fig', 'section'].includes(tag)) {
      const element = documentRef.createElement(tag === 'p' ? 'p' : 'div');
      for (const attribute of Array.from(node.attributes || [])) setAuthorAttribute(element, attribute.name, attribute.value);
      element.setAttribute('data-dita-source', tag);
      for (const child of node.childNodes) {
        if (child.localName === 'title') {
          // Author presents container titles as real headings. Keeping the
          // heading in the visual tree also lets the source serializer map it
          // back to the original DITA <title> without forcing source editing.
          if (tag !== 'p') {
            element.appendChild(authorHeading(child, documentRef, 'h3', ctx));
          }
          continue;
        }
        const rendered = renderDitaNode(child, documentRef, ctx);
        if (rendered) element.appendChild(rendered);
      }
      return element;
    }
    if (tag === 'xref' && node.getAttribute('type') === 'fn') return renderFootnoteMarker(node, documentRef, false, ctx);
    if (tag === 'xref' || ['ph', 'b', 'i', 'u', 'codeph', 'keyword', 'term', 'cite'].includes(tag)) {
      const element = documentRef.createElement(tag === 'xref' ? 'a' : 'span');
      element.setAttribute('data-dita-source', tag);
      for (const attribute of Array.from(node.attributes || [])) setAuthorAttribute(element, attribute.name, attribute.value);
      for (const child of node.childNodes) {
        const rendered = renderDitaNode(child, documentRef, ctx);
        if (rendered) element.appendChild(rendered);
      }
      return element;
    }
    // Preserve DITA elements that do not have a dedicated Author renderer yet.
    // They remain editable as a neutral block/inline surface and carry their
    // original element name in data-dita-source, so visual round-tripping does
    // not silently delete task steps, definition lists, foreign content, etc.
    if (tag === 'dl') {
      const el = documentRef.createElement('dl');
      el.setAttribute('data-dita-source', 'dl');
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (child.localName === 'dlentry') {
          for (const entry of child.childNodes) {
            if (entry.nodeType !== 1) continue;
            if (entry.localName === 'dt') {
              const dt = documentRef.createElement('dt');
              dt.ditaSourcePath = xmlNodePath(entry);
              for (const attr of Array.from(entry.attributes || [])) setAuthorAttribute(dt, attr.name, attr.value);
              dt.setAttribute('data-dita-source', 'dt');
              for (const child of entry.childNodes) { const rendered = renderDitaNode(child, documentRef, ctx); if (rendered) dt.appendChild(rendered); }
              el.appendChild(dt);
            } else if (entry.localName === 'dd') {
              const dd = documentRef.createElement('dd');
              dd.ditaSourcePath = xmlNodePath(entry);
              for (const attr of Array.from(entry.attributes || [])) setAuthorAttribute(dd, attr.name, attr.value);
              dd.setAttribute('data-dita-source', 'dd');
              for (const dc of entry.childNodes) {
                const r = renderDitaNode(dc, documentRef, ctx);
                if (r) dd.appendChild(r);
              }
              el.appendChild(dd);
            }
          }
        }
      }
      return el;
    }
    if (tag === 'fn') {
      return renderFootnoteMarker(node, documentRef, !node.hasAttribute('id'), ctx);
    }
    if (tag === 'filepath') {
      const el = documentRef.createElement('code');
      el.setAttribute('data-dita-source', tag);
      for (const attr of Array.from(node.attributes || [])) setAuthorAttribute(el, attr.name, attr.value);
      el.className = 'filepath';
      el.textContent = node.textContent;
      return el;
    }
    if (tag === 'ins') {
      const el = documentRef.createElement('span');
      el.className = 'oxy-insert';
      if (node.hasAttribute('data-oxy-index')) el.dataset.oxyIndex = node.getAttribute('data-oxy-index');
      if (node.hasAttribute('data-author')) el.title = '插入 — ' + node.getAttribute('data-author');
      for (const child of node.childNodes) {
        const rendered = renderDitaNode(child, documentRef, ctx);
        if (rendered) el.appendChild(rendered);
      }
      return el;
    }
    if (tag === 'del') {
      const el = documentRef.createElement('span');
      el.className = 'oxy-delete';
      el.textContent = node.textContent;
      if (node.hasAttribute('data-oxy-index')) el.dataset.oxyIndex = node.getAttribute('data-oxy-index');
      if (node.hasAttribute('data-author')) el.title = '删除 — ' + node.getAttribute('data-author');
      return el;
    }
    if (tag === 'span' && (node.getAttribute('class') || '').includes('oxy-comment')) {
      const el = documentRef.createElement('span');
      el.className = 'oxy-comment';
      const comment = node.getAttribute('data-comment');
      const author = node.getAttribute('data-author');
      if (node.hasAttribute('data-oxy-index')) el.dataset.oxyIndex = node.getAttribute('data-oxy-index');
      if (comment) el.title = (author ? author + '：' : '') + comment;
      for (const child of node.childNodes) {
        const rendered = renderDitaNode(child, documentRef, ctx);
        if (rendered) el.appendChild(rendered);
      }
      return el;
    }
    const inline = new Set(['cmd', 'info', 'term', 'dt', 'dd', 'keyword', 'q', 'sub', 'sup', 'u', 'varname', 'parmname', 'tm', 'menucascade', 'uicontrol', 'state', 'boolean', 'cmdname', 'userinput', 'systemoutput', 'msgph', 'option', 'apiname']);
    const semantic = { parml: 'dl', pt: 'dt', pd: 'dd', sub: 'sub', sup: 'sup', q: 'q', tt: 'code' };
    const element = documentRef.createElement(semantic[tag] || (inline.has(tag) ? 'span' : 'div'));
    element.setAttribute('data-dita-source', tag);
    for (const attribute of Array.from(node.attributes || [])) setAuthorAttribute(element, attribute.name, attribute.value);
    for (const child of node.childNodes) {
      if (child.localName === 'title') {
        element.appendChild(authorHeading(child, documentRef, 'h3', ctx));
        continue;
      }
      const rendered = renderDitaNode(child, documentRef, ctx);
      if (rendered) element.appendChild(rendered);
    }
    return element;
  }



  const api = { createAuthorTopic, renderDitaNode };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaAuthorRenderer = api;
})(typeof window === 'undefined' ? globalThis : window);

'use strict';
(function (root) {
  const markup = typeof module !== 'undefined' ? require('./review-markup') : root.DitaReviewMarkup;
  function createReviewLocations({ visualEditor, legend, inspectSource, ditaCore, decisionFor, setStatus }) {
    const dom = { visualEditor }, locations = new Map();
    const { inlineDiff } = ditaCore;
    const reviewBlocks = 'h1,h2,h3,h4,h5,h6,p,li,pre,td,th,dt,dd,figcaption,img,blockquote,[data-dita-source="fn"],[data-dita-source="note"],[data-dita-source="stentry"]';
    function clear() {
      locations.clear();
      if (legend) legend.hidden = true;
      markup.clear(dom.visualEditor);
      dom.visualEditor.querySelectorAll('[data-review-change],[data-review-deletion]').forEach(node => {
        delete node.dataset.reviewChange;
        delete node.dataset.reviewDeletion;
      });
    }

    function mark(file, surface, groups, keyFor, baseline) {
      if (surface?.ditaSourceContent !== file.current || !groups.some(group => group.type === 'changed')) return;
      const source = file.current;
      let tree;
      try { tree = inspectSource(source); }
      catch { return; } // Invalid XML remains reviewable as a source diff.

      const projected = new Map(Array.from(surface.querySelectorAll('*'), node => [node.ditaSourcePath, node]));
      projected.delete(undefined);
      const spans = [];
      const add = (start, end, target) => {
        if (target && start < end) spans.push({ start, end, target });
      };
      function visit(item, path, owner) {
        const node = projected.get(path);
        const target = node?.closest(reviewBlocks) || owner;
        add(item.start, item.end, target);
        let index = 0;
        for (const child of item.children) {
          if (child.kind === 'element') visit(child, path ? path + '/' + index++ : String(index++), target);
          else if (child.kind === 'text' || child.kind === 'cdata') add(child.start, child.end, target);
        }
        if (item.close) add(item.close.start, item.close.end, target);
      }
      if (surface.hasAttribute('data-map-title')) {
        const child = (item, name) => item?.children.find(node => node.kind === 'element' && node.name.split(':').at(-1) === name);
        const title = child(child(tree, 'booktitle'), 'mainbooktitle') || child(tree, 'title');
        if (title) add(title.start, title.close?.end ?? title.end, surface);
        else if (Object.hasOwn(tree.attrs, 'title')) {
          const attribute = /\s+title\s*=\s*(["'])[\s\S]*?\1/.exec(source.slice(tree.start, tree.end));
          if (attribute) add(tree.start + attribute.index, tree.start + attribute.index + attribute[0].length, surface);
        }
      } else visit(tree, '', null);
      if (!spans.length) return;

      const lines = [0];
      for (const match of source.matchAll(/\n/g)) lines.push(match.index + 1);
      const oldLines = [0];
      for (const match of baseline.matchAll(/\n/g)) oldLines.push(match.index + 1);
      let decorations;
      try { decorations = markup.create({ source, baseline, surface, createAuthorTopic: ditaCore.createAuthorTopic }); }
      catch { /* Invalid/unsupported baseline XML keeps source-level review and locations. */ }
      let originalShift = 0, rejectedShift = 0, spanIndex = 0;
      groups.forEach((group, index) => {
        if (group.type !== 'changed') return;
        const oldRows = group.rows.filter(row => row.type === 'old');
        const newRows = group.rows.filter(row => row.type === 'new');
        const line = newRows[0]?.newIndex ?? oldRows[0].oldIndex + originalShift;
        const count = newRows.length - oldRows.length;
        originalShift += count;
        const key = keyFor(index), decision = decisionFor(key);
        if (decision === 'reject') { rejectedShift -= count; return; }

        const targets = new Set();
        let offset = lines[line - 1 + rejectedShift] ?? source.length;
        let oldOffset = oldLines[(oldRows[0]?.oldIndex ?? 1) - 1] ?? baseline.length;
        const finish = lines[line - 1 + rejectedShift + newRows.length];
        const working = newRows.length ? source.slice(offset, finish === undefined ? source.length : finish - (source[finish - 2] === '\r' ? 2 : 1)) : '';
        const before = oldRows.map(row => row.text).join(baseline.includes('\r\n') ? '\r\n' : '\n');
        let added = '', removed = '';
        const mark = () => {
          const end = offset + added.length;
          while (spanIndex < spans.length && spans[spanIndex].end <= offset) spanIndex++;
          if (!decision) {
            const anchor = spans[spanIndex]?.target || spans[spanIndex - 1]?.target;
            const ghosts = decorations?.mark({ start: offset, end, oldStart: oldOffset, oldEnd: oldOffset + removed.length, anchor }) || [];
            for (const ghost of ghosts) targets.add(ghost);
          }
          if (added) {
            for (let i = spanIndex; i < spans.length && spans[i].start < end; i++) {
              const span = spans[i];
              if (!added.trim() && !span.target.matches('pre')) continue;
              if (!decision) span.target.dataset.reviewChange = 'changed';
              targets.add(span.target);
            }
          } else if (removed.trim() && offset >= tree.start && offset <= (tree.close?.end ?? tree.end)) {
            const next = spans[spanIndex], previous = spans[spanIndex - 1];
            const target = next?.target || previous?.target;
            if (target) {
              const inside = next && (next.start < offset || (next.start === offset && previous?.target === next.target));
              if (!decision) target.dataset.reviewDeletion = inside ? 'inside' : next ? 'before' : 'after';
              targets.add(target);
            }
          }
          offset = end;
          oldOffset += removed.length;
          added = ''; removed = '';
        };
        for (const segment of inlineDiff(before, working)) {
          if (segment.type === 'old') removed += segment.text;
          else if (segment.type === 'new') added += segment.text;
          else { if (added || removed) mark(); offset += segment.text.length; oldOffset += segment.text.length; }
        }
        if (added || removed) mark();
        if (targets.size) {
          locations.set(key, [...targets]);
          if (legend && !decision) legend.hidden = false;
        }
      });
      decorations?.finish();
    }

    function focus(key) {
      const target = locations.get(key)?.[0];
      if (!target) {
        setStatus('这处变更可在右侧对照，正文没有对应位置。');
        return;
      }
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.remove('review-target-focus');
      void target.offsetWidth;
      target.classList.add('review-target-focus');
      root.setTimeout(() => target.classList.remove('review-target-focus'), 1300);
    }
    return { clear, mark, focus };
  }
  const api = { createReviewLocations };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaReviewLocations = api;
})(typeof window === 'undefined' ? globalThis : window);

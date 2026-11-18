'use strict';
(function (root) {
  function createReviewView({ document: documentRef, inlineDiff }) {
    function reviewRowLabel(value) {
      const raw = String(value || '').trim();
      if (!raw) return '(空行)';
      const withoutTags = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (withoutTags) return withoutTags;
      const element = raw.match(/^<\/?([\w:.-]+)\b([^>]*)>/);
      if (!element) return raw;
      const attrs = element[2].replace(/\s+/g, ' ').trim().replace(/\/$/, '').trim();
      return `${element[1]}${attrs ? ` · ${attrs}` : ' 元素'}`;
    }

    function reviewDiffLabel(value) {
      const raw = String(value || '').trim();
      const label = reviewRowLabel(raw);
      const element = raw.match(/^<([\w:.-]+)\b([^>]*)>/);
      if (!element) return label;
      const attrs = element[2].replace(/\s+/g, ' ').trim().replace(/\/$/, '').trim();
      return attrs && !label.includes(attrs) ? `${label} · ${attrs}` : label;
    }

    // Render a review row from the readable text projection.  Oxygen's Author
    // review surface keeps the surrounding sentence intact and marks only the
    // changed words; doing the same here avoids turning a one-word edit into a
    // large full-line diff in the right dock.
    function createReviewLine(row, decision, segments = null) {
      const line = documentRef.createElement('div');
      line.className = `diff-line ${row.type}${segments ? ' inline' : ''}`;
      if (decision && ((decision === 'accept' && row.type === 'old') || (decision === 'reject' && row.type === 'new'))) {
        line.classList.add('inactive');
      }
      const num = documentRef.createElement('div');
      num.className = 'num';
      num.textContent = row.type === 'new' ? `+${row.newIndex}` : `-${row.oldIndex}`;
      const text = documentRef.createElement('div');
      text.className = 'text';
      const label = reviewDiffLabel(row.text);
      text.title = row.text;
      if (!segments) {
        text.textContent = label;
      } else {
        for (const segment of segments) {
          if (!segment.text) continue;
          const part = documentRef.createElement('span');
          part.className = `diff-inline-${segment.type}`;
          part.textContent = segment.text;
          text.append(part);
        }
      }
      line.append(num, text);
      return line;
    }

    function appendReviewRows(container, rows, decision) {
      const oldRows = rows.filter(row => row.type === 'old');
      const newRows = rows.filter(row => row.type === 'new');
      // A replacement of equal line count can be paired for character-level
      // highlighting. Insertions/deletions and structural changes keep their
      // complete readable line so the reviewer still sees the affected element.
      if (oldRows.length && newRows.length && oldRows.length === newRows.length && typeof inlineDiff === 'function') {
        for (let index = 0; index < oldRows.length; index += 1) {
          const oldLabel = reviewDiffLabel(oldRows[index].text);
          const newLabel = reviewDiffLabel(newRows[index].text);
          const segments = inlineDiff(oldLabel, newLabel);
          const oldSegments = segments.filter(segment => segment.type === 'same' || segment.type === 'old');
          const newSegments = segments.filter(segment => segment.type === 'same' || segment.type === 'new');
          container.append(
            createReviewLine(oldRows[index], decision, oldSegments),
            createReviewLine(newRows[index], decision, newSegments)
          );
        }
        return;
      }
      for (const row of rows) container.append(createReviewLine(row, decision));
    }

    function context(rows) {
      const element = documentRef.createElement('div');
      element.className = 'diff-context';
      element.textContent = rows.map(row => reviewRowLabel(row.text)).join(' · ');
      return element;
    }

    function block({ group, decision, number, label, focus, decide }) {
      const element = documentRef.createElement('div');
      element.className = `diff-block${decision ? ` decision-${decision}` : ''}`;
      element.tabIndex = 0;
      element.setAttribute('aria-label', label);
      element.addEventListener('click', event => {
        if (!event.target.closest('button')) focus();
      });
      element.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
          event.preventDefault(); focus();
        }
      });
      const header = documentRef.createElement('div');
      header.className = 'diff-block-header';
      header.title = '点击定位到 Author 正文';
      const title = documentRef.createElement('span');
      title.textContent = '变更块 ' + number;
      const status = documentRef.createElement('span');
      status.className = 'diff-block-state';
      status.textContent = decision === 'accept' ? '已接受' : decision === 'reject' ? '已拒绝' : '待审阅';
      header.append(title, status);
      element.append(header);
      appendReviewRows(element, group.rows, decision);
      const actions = documentRef.createElement('div');
      actions.className = 'diff-actions';
      for (const [value, text] of [['accept', '接受此块'], ['reject', '拒绝此块']]) {
        const button = documentRef.createElement('button');
        button.type = 'button'; button.textContent = text; button.disabled = Boolean(decision);
        button.addEventListener('click', () => decide(value));
        actions.append(button);
      }
      if (decision) {
        const reset = documentRef.createElement('button');
        reset.type = 'button'; reset.className = 'reset-review'; reset.textContent = '撤销决定';
        reset.addEventListener('click', () => decide(null));
        actions.append(reset);
      }
      element.append(actions);
      return element;
    }
    function oxygen(change, oxyIndex, { focus, decide }) {
      const block = documentRef.createElement('div');
      block.className = 'oxy-change oxy-' + change.type + '-type';
      block.dataset.oxyIndex = String(oxyIndex);
      block.addEventListener('click', event => {
        if (event.target.closest('button')) return;
        focus();
      });
      block.style.cursor = 'pointer';
      const typeLabel = documentRef.createElement('span');
      typeLabel.className = 'oxy-type ' + change.type;
      typeLabel.textContent = change.type === 'insert' ? '插入' : change.type === 'delete' ? '删除' : '批注';
      const author = documentRef.createElement('span');
      author.className = 'oxy-author';
      author.textContent = change.author || '';
      block.append(typeLabel, author);
      if (change.content) {
        const content = documentRef.createElement('div');
        content.className = 'oxy-content';
        content.textContent = change.content;
        block.append(content);
      }
      if (change.context) {
        const ctx = documentRef.createElement('div');
        ctx.className = 'oxy-context';
        ctx.textContent = '上下文：' + change.context;
        block.append(ctx);
      }
      const actions = documentRef.createElement('div');
      actions.className = 'diff-actions';
      const accept = documentRef.createElement('button');
      accept.type = 'button';
      accept.textContent = '接受';
      accept.addEventListener('click', () => decide(true));
      const reject = documentRef.createElement('button');
      reject.type = 'button';
      reject.textContent = '拒绝';
      reject.addEventListener('click', () => decide(false));
      actions.append(accept, reject);
      block.append(actions);
      return block;
    }
    return { context, block, oxygen };
  }
  const api = { createReviewView };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaReviewView = api;
})(typeof window === 'undefined' ? globalThis : window);

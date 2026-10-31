'use strict';
(function (root) {
  function createReviewController({ state, dom, ditaCore, setFileContent, updateVisual, renderTabs, updateHistoryButtons, setStatus }) {
    const { lineDiff, groupDiffRows, applyDiffGroups, inlineDiff } = ditaCore;
    const REVIEW_CONTEXT_SIZE = 3;
function resetReviewSnapshot(file) {
  state.reviewGroups = new Map();
  state.reviewDecisions = new Map();
  state.reviewPath = file ? file.path : '';
  state.reviewBaseline = file ? file.baseline : '';
  state.reviewCurrent = file ? file.current : '';
}

// A block decision changes file.current while the review still refers to the
// original baseline/current pair. Preserve that session across a temporary
// mode switch as long as the current content is still derived from it.
function reviewSnapshotCanReuse(file) {
  if (!file || state.reviewPath !== file.path) return false;
  if (state.reviewBaseline !== file.baseline) return false;
  if (state.reviewCurrent === file.current) return true;
  return applyDiffGroups(
    state.reviewBaseline,
    state.reviewCurrent,
    state.reviewDecisions,
    0
  ) === file.current;
}

function reviewTextWithoutMarkup(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|apos);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

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
  const line = document.createElement('div');
  line.className = `diff-line ${row.type}${segments ? ' inline' : ''}`;
  if (decision && ((decision === 'accept' && row.type === 'old') || (decision === 'reject' && row.type === 'new'))) {
    line.classList.add('inactive');
  }
  const num = document.createElement('div');
  num.className = 'num';
  num.textContent = row.type === 'new' ? `+${row.newIndex}` : `-${row.oldIndex}`;
  const text = document.createElement('div');
  text.className = 'text';
  const label = reviewDiffLabel(row.text);
  text.title = row.text;
  if (!segments) {
    text.textContent = label;
  } else {
    for (const segment of segments) {
      if (!segment.text) continue;
      const part = document.createElement('span');
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

// Review entries live in the right dock while the center remains an Author
// surface. Selecting an entry can still locate its visual counterpart, which
// keeps the review workflow connected to the rendered document without
// painting source-line markup over the Author content.
function focusReviewGroup(group, topicPath = '') {
  if (!group || !dom.visualEditor) return;
  let candidates = Array.from(dom.visualEditor.querySelectorAll(
    '[data-dita-source], h1, h2, h3, h4, h5, h6, p, li, pre, table, img'
  ));
  if (topicPath) {
    if (/\.ditamap$/i.test(topicPath)) {
      candidates = candidates.filter(element => element.closest('[data-map-title]') || element.closest('[data-map-topic-path]')?.dataset.mapTopicPath === topicPath);
    } else {
      candidates = candidates.filter(element => element.closest('.map-topic')?.dataset.mapTopicPath === topicPath);
    }
  }
  if (!candidates.length) return;
    const changedRows = group.rows.filter(row => row.type !== 'same');
  const needles = changedRows.map(row => reviewTextWithoutMarkup(row.text)).filter(text => text.length >= 2);
  let target = candidates.find(element => {
    const content = reviewTextWithoutMarkup(element.textContent || element.getAttribute('alt') || '');
    return needles.some(needle => content.includes(needle) || needle.includes(content));
  });
  if (!target) {
    const firstRow = changedRows[0];
    const line = Number(firstRow?.newIndex || firstRow?.oldIndex || 1);
    target = candidates[Math.min(candidates.length - 1, Math.max(0, line - 1))];
  }
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('review-target-focus');
  void target.offsetWidth;
  target.classList.add('review-target-focus');
  window.setTimeout(() => target.classList.remove('review-target-focus'), 1300);
}

function getOxyReplacement(change, accept) {
  if (change.type === 'insert') return accept ? (change.keepContent || '') : '';
  if (change.type === 'delete') return accept ? '' : (change.deletedContent ?? change.content ?? '');
  return change.keepContent || '';
}

function applyOxyChange(file, change, accept) {
  if (!file || typeof change.index !== 'number') return;
  const source = file.current;
  const replacement = getOxyReplacement(change, accept);
  const next = source.slice(0, change.index) + replacement + source.slice(change.index + change.matchLength);
  setFileContent(file, next, {});
  setStatus(accept ? '已接受修订' : '已拒绝修订');
  if (state.mode === 'review') {
    const activeFile = state.filesMap.get(state.activePath);
    if (activeFile && /\.ditamap$/i.test(activeFile.path)) {
      updateVisual(activeFile, true);
      renderMapReview(activeFile);
    } else {
      updateVisual(file, true);
      renderDiff(file, true);
    }
  }
}

function scrollToOxyChange(oxyIndex) {
  if (typeof oxyIndex !== 'number') return;
  const el = dom.visualEditor.querySelector('[data-oxy-index="' + oxyIndex + '"]');
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('oxy-flash');
  setTimeout(() => el.classList.remove('oxy-flash'), 1500);
}

function createOxyChangeBlock(change, oxyIndex, file) {
  const block = document.createElement('div');
  block.className = 'oxy-change oxy-' + change.type + '-type';
  block.dataset.oxyIndex = String(oxyIndex);
  block.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    scrollToOxyChange(oxyIndex);
  });
  block.style.cursor = 'pointer';
  const typeLabel = document.createElement('span');
  typeLabel.className = 'oxy-type ' + change.type;
  typeLabel.textContent = change.type === 'insert' ? '插入' : change.type === 'delete' ? '删除' : '批注';
  const author = document.createElement('span');
  author.className = 'oxy-author';
  author.textContent = change.author || '';
  block.append(typeLabel, author);
  if (change.content) {
    const content = document.createElement('div');
    content.className = 'oxy-content';
    content.textContent = change.content;
    block.append(content);
  }
  if (change.context) {
    const ctx = document.createElement('div');
    ctx.className = 'oxy-context';
    ctx.textContent = '上下文：' + change.context;
    block.append(ctx);
  }
  const actions = document.createElement('div');
  actions.className = 'diff-actions';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.textContent = '接受';
  accept.addEventListener('click', () => applyOxyChange(file, change, true));
  const reject = document.createElement('button');
  reject.type = 'button';
  reject.textContent = '拒绝';
  reject.addEventListener('click', () => applyOxyChange(file, change, false));
  actions.append(accept, reject);
  block.append(actions);
  return block;
}
function renderDiff(file, resetSnapshot = false) {
  if (!file) {
    resetReviewSnapshot(null);
    dom.diff.replaceChildren(document.createTextNode('未打开文件'));
    dom.reviewMeta.textContent = '';
    dom.acceptAllButton.disabled = true;
    dom.rejectAllButton.disabled = true;
    return;
  }

  if (resetSnapshot || !reviewSnapshotCanReuse(file)) resetReviewSnapshot(file);
  const fragment = document.createDocumentFragment();
  let changed = 0;
  let oxyCount = 0;
  const oxyChanges = ditaCore.collectOxyTrackedChanges ? ditaCore.collectOxyTrackedChanges(file.current) : [];
  if (oxyChanges.length) {
    const oxyHeader = document.createElement('div');
    oxyHeader.className = 'diff-section-header';
    oxyHeader.textContent = 'Oxygen 修订标记（' + oxyChanges.length + '）';
    fragment.append(oxyHeader);
    oxyChanges.forEach((change, idx) => {
      oxyCount++;
      fragment.append(createOxyChangeBlock(change, idx, file));
    });
  }
  const groups = groupDiffRows(lineDiff(state.reviewBaseline, state.reviewCurrent), REVIEW_CONTEXT_SIZE);
  const hasGitDiff = groups.some(g => g.type !== 'same');
  if (oxyChanges.length && hasGitDiff) {
    const gitHeader = document.createElement('div');
    gitHeader.className = 'diff-section-header';
    gitHeader.textContent = 'Git 工作区变更';
    fragment.append(gitHeader);
  }
  groups.forEach((group, index) => {
    if (group.type === 'same') {
      const line = document.createElement('div');
      line.className = 'diff-context';
      line.textContent = group.rows.map(row => reviewRowLabel(row.text)).join(' · ');
      fragment.append(line);
      return;
    }

    changed += group.rows.length;
    state.reviewGroups.set(index, group);
    const decision = state.reviewDecisions.get(index);
    const block = document.createElement('div');
    block.className = `diff-block${decision ? ` decision-${decision}` : ''}`;
    block.tabIndex = 0;
    block.setAttribute('aria-label', `定位变更块 ${state.reviewGroups.size}`);
    block.addEventListener('click', event => {
      if (!event.target.closest('button')) focusReviewGroup(group);
    });
    block.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
        event.preventDefault();
        focusReviewGroup(group);
      }
    });
    const blockHeader = document.createElement('div');
    blockHeader.className = 'diff-block-header';
    blockHeader.title = '点击定位到 Author 正文';
    const blockTitle = document.createElement('span');
    blockTitle.textContent = `变更块 ${state.reviewGroups.size}`;
    const blockState = document.createElement('span');
    blockState.className = 'diff-block-state';
    blockState.textContent = decision === 'accept' ? '已接受' : decision === 'reject' ? '已拒绝' : '待审阅';
    blockHeader.append(blockTitle, blockState);
    block.append(blockHeader);
    appendReviewRows(block, group.rows, decision);

    const actions = document.createElement('div');
    actions.className = 'diff-actions';
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.textContent = '接受此块';
    accept.disabled = Boolean(decision);
    accept.addEventListener('click', () => applyReviewedGroup(file, index, true));
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.textContent = '拒绝此块';
    reject.disabled = Boolean(decision);
    reject.addEventListener('click', () => applyReviewedGroup(file, index, false));
    actions.append(accept, reject);
    if (decision) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'reset-review';
      reset.textContent = '撤销决定';
      reset.addEventListener('click', () => resetReviewedGroup(file, index));
      actions.append(reset);
    }
    block.append(actions);
    fragment.append(block);
  });

  dom.diff.replaceChildren(fragment);
  const decided = Array.from(state.reviewDecisions.values()).length;
  const pending = Math.max(0, state.reviewGroups.size - decided);
  updateBulkButtons(changed > 0, oxyCount > 0);

  const oxySummary = oxyCount ? oxyCount + ' 个 Oxygen 修订' : '';
  const gitSummary = changed ? changed + ' 行变更，' + pending + ' 个待审块' : '';
  const combinedSummary = [oxySummary, gitSummary].filter(Boolean).join('；') || '无变更';
  dom.reviewMeta.textContent = `基线：${file.gitStatus || 'unknown'}；${combinedSummary}`;
  setStatus(combinedSummary);
}

function renderMapReview(file) {
  state.reviewGroups = new Map();
  const topicFiles = Array.from(state.mapAuthorPaths || [])
    .map(path => state.filesMap.get(path))
    .filter(Boolean);
  for (const topic of topicFiles) {
    if (!mapReviewSnapshotCanReuse(topic)) {
      topic.reviewBaseline = topic.baseline;
      topic.reviewCurrent = topic.current;
      for (const key of Array.from(state.reviewDecisions.keys())) {
        if (typeof key === 'string' && key.startsWith(`${topic.path}::`)) state.reviewDecisions.delete(key);
      }
    }
  }
  if (file && !mapReviewSnapshotCanReuse(file)) {
    file.reviewBaseline = file.baseline;
    file.reviewCurrent = file.current;
    for (const key of Array.from(state.reviewDecisions.keys())) {
      if (typeof key === 'string' && key.startsWith(`${file.path}::`)) state.reviewDecisions.delete(key);
    }
  }
  const changedFiles = topicFiles.filter(topic => topic.reviewCurrent !== topic.reviewBaseline);
  if (file?.reviewCurrent !== file?.reviewBaseline && !changedFiles.includes(file)) changedFiles.unshift(file);
  const fragment = document.createDocumentFragment();
  let totalOxy = 0;
  for (const topic of [file, ...topicFiles].filter(Boolean)) {
    const changes = ditaCore.collectOxyTrackedChanges ? ditaCore.collectOxyTrackedChanges(topic.current) : [];
    if (changes.length) {
      totalOxy += changes.length;
      const section = document.createElement('section');
      section.className = 'map-review-topic';
      const header = document.createElement('div');
      header.className = 'map-review-topic-header';
      header.textContent = topic.path;
      section.append(header);
      const oxyHeader = document.createElement('div');
      oxyHeader.className = 'diff-section-header';
      oxyHeader.textContent = 'Oxygen 修订标记（' + changes.length + '）';
      section.append(oxyHeader);
      changes.forEach((change, idx) => {
        section.append(createOxyChangeBlock(change, idx, topic));
      });
      fragment.append(section);
    }
  }
  if (!changedFiles.length && !totalOxy) {
    const empty = document.createElement('div');
    empty.className = 'map-review-empty';
    empty.textContent = '完整 Map 没有待审阅的 topic 变更。';
    fragment.append(empty);
    dom.reviewMeta.textContent = '无变更';
    dom.acceptAllButton.disabled = true;
    dom.rejectAllButton.disabled = true;
    dom.diff.replaceChildren(fragment);
    setStatus('完整 Map 无变更');
    return;
  }
  for (const topic of changedFiles) {
    const section = document.createElement('section');
    section.className = 'map-review-topic';
    const header = document.createElement('div');
    header.className = 'map-review-topic-header';
    header.textContent = topic.path;
    section.append(header);
    const reviewBaseline = topic.reviewBaseline ?? topic.baseline;
    const reviewCurrent = topic.reviewCurrent ?? topic.current;
    const groups = groupDiffRows(lineDiff(reviewBaseline, reviewCurrent), REVIEW_CONTEXT_SIZE);
    for (const [groupIndex, group] of groups.entries()) {
      if (group.type === 'same') {
        const context = document.createElement('div');
        context.className = 'diff-context';
        context.textContent = group.rows.map(row => reviewRowLabel(row.text)).join(' · ');
        section.append(context);
        continue;
      }
      const decisionKey = `${topic.path}::${groupIndex}`;
      state.reviewGroups.set(decisionKey, { ...group, topicPath: topic.path });
      const decision = state.reviewDecisions.get(decisionKey);
      const block = document.createElement('div');
      block.className = `diff-block${decision ? ` decision-${decision}` : ''}`;
      block.tabIndex = 0;
      block.setAttribute('aria-label', `定位 ${topic.path} 的变更`);
      block.addEventListener('click', event => {
        if (!event.target.closest('button')) focusReviewGroup(group, topic.path);
      });
      block.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
          event.preventDefault();
          focusReviewGroup(group, topic.path);
        }
      });
      const blockHeader = document.createElement('div');
      blockHeader.className = 'diff-block-header';
      const blockTitle = document.createElement('span');
      blockTitle.textContent = `变更块 ${groupIndex + 1}`;
      const blockState = document.createElement('span');
      blockState.className = 'diff-block-state';
      blockState.textContent = decision === 'accept' ? '已接受' : decision === 'reject' ? '已拒绝' : '待审阅';
      blockHeader.append(blockTitle, blockState);
      block.append(blockHeader);
      appendReviewRows(block, group.rows, decision);
      const actions = document.createElement('div');
      actions.className = 'diff-actions';
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.textContent = '接受此块';
      accept.disabled = Boolean(decision);
      accept.addEventListener('click', () => applyReviewedMapGroup(file, topic, decisionKey, groupIndex, true));
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.textContent = '拒绝此块';
      reject.disabled = Boolean(decision);
      reject.addEventListener('click', () => applyReviewedMapGroup(file, topic, decisionKey, groupIndex, false));
      actions.append(accept, reject);
      if (decision) {
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'reset-review';
        reset.textContent = '撤销决定';
        reset.addEventListener('click', () => resetReviewedMapGroup(file, topic, decisionKey, groupIndex));
        actions.append(reset);
      }
      block.append(actions);
      section.append(block);
    }
    fragment.append(section);
  }
  dom.diff.replaceChildren(fragment);
  updateBulkButtons(changedFiles.length > 0, totalOxy > 0);

  const oxySummary = totalOxy ? totalOxy + ' 个 Oxygen 修订' : '';
  const gitSummary = changedFiles.length ? changedFiles.length + ' 个 topic 有变更' : '';
  const combinedSummary = [oxySummary, gitSummary].filter(Boolean).join('；') || '无变更';
  dom.reviewMeta.textContent = combinedSummary;
  setStatus(combinedSummary);
}

function mapReviewDecisions(topicPath, exceptKey, replacement) {
  const decisions = new Map();
  for (const [key, decision] of state.reviewDecisions || []) {
    if (typeof key === 'string' && key.startsWith(`${topicPath}::`) && key !== exceptKey) {
      const index = Number(key.slice(topicPath.length + 2));
      if (Number.isInteger(index)) decisions.set(index, decision);
    }
  }
  if (replacement) decisions.set(replacement.index, replacement.decision);
  return decisions;
}

function mapReviewSnapshotCanReuse(topic) {
  if (!topic || typeof topic.reviewBaseline !== 'string' || typeof topic.reviewCurrent !== 'string') return false;
  if (topic.reviewBaseline !== topic.baseline) return false;
  if (topic.reviewCurrent === topic.current) return true;
  return applyDiffGroups(
    topic.reviewBaseline,
    topic.reviewCurrent,
    mapReviewDecisions(topic.path, '', null),
    0
  ) === topic.current;
}

function applyReviewedMapGroup(file, topic, decisionKey, groupIndex, accept) {
  if (!file || !topic) return;
  const previousDecisions = new Map(state.reviewDecisions || []);
  const decisions = new Map(state.reviewDecisions || []);
  decisions.set(decisionKey, accept ? 'accept' : 'reject');
  state.reviewDecisions = decisions;
  const local = mapReviewDecisions(topic.path, decisionKey, { index: groupIndex, decision: accept ? 'accept' : 'reject' });
  const next = applyDiffGroups(topic.reviewBaseline ?? topic.baseline, topic.reviewCurrent ?? topic.current, local, REVIEW_CONTEXT_SIZE);
  setFileContent(topic, next, {
    historyMeta: {
      reviewDecisionsBefore: previousDecisions,
      reviewDecisionsAfter: new Map(decisions)
    }
  });
  renderTabs();
  updateHistoryButtons();
  renderMapReview(file);
  setStatus(accept ? `已接受 ${topic.path} 的所选变更块` : `已拒绝 ${topic.path} 的所选变更块`);
}

function resetReviewedMapGroup(file, topic, decisionKey, groupIndex) {
  if (!file || !topic) return;
  const previousDecisions = new Map(state.reviewDecisions || []);
  const decisions = new Map(state.reviewDecisions || []);
  decisions.delete(decisionKey);
  state.reviewDecisions = decisions;
  const local = mapReviewDecisions(topic.path, decisionKey, null);
  const next = applyDiffGroups(topic.reviewBaseline ?? topic.baseline, topic.reviewCurrent ?? topic.current, local, REVIEW_CONTEXT_SIZE);
  setFileContent(topic, next, {
    historyMeta: {
      reviewDecisionsBefore: previousDecisions,
      reviewDecisionsAfter: new Map(decisions)
    }
  });
  renderTabs();
  updateHistoryButtons();
  renderMapReview(file);
  setStatus(`已撤销 ${topic.path} 的审阅决定`);
}

function applyReviewedGroup(file, groupIndex, accept) {
  if (!file) return;
  const previousDecisions = new Map(state.reviewDecisions || []);
  const decisions = new Map(state.reviewDecisions || []);
  decisions.set(groupIndex, accept ? 'accept' : 'reject');
  state.reviewDecisions = decisions;
  const next = applyDiffGroups(state.reviewBaseline, state.reviewCurrent, decisions, REVIEW_CONTEXT_SIZE);
  setFileContent(file, next, {
    historyMeta: {
      reviewDecisionsBefore: previousDecisions,
      reviewDecisionsAfter: new Map(decisions)
    }
  });
  renderDiff(file, false);
  setStatus(accept ? '已接受所选变更块' : '已拒绝所选变更块');
}

function resetReviewedGroup(file, groupIndex) {
  if (!file) return;
  const previousDecisions = new Map(state.reviewDecisions || []);
  const decisions = new Map(state.reviewDecisions || []);
  decisions.delete(groupIndex);
  state.reviewDecisions = decisions;
  const next = applyDiffGroups(state.reviewBaseline, state.reviewCurrent, decisions, REVIEW_CONTEXT_SIZE);
  setFileContent(file, next, {
    historyMeta: {
      reviewDecisionsBefore: previousDecisions,
      reviewDecisionsAfter: new Map(decisions)
    }
  });
  renderDiff(file, false);
  setStatus('已撤销该审阅决定');
}


function reviewFiles() {
  const active = state.filesMap.get(state.activePath);
  if (!active) return [];
  return /\.ditamap$/i.test(active.path)
    ? [active, ...Array.from(state.mapAuthorPaths || [], path => state.filesMap.get(path))].filter(Boolean)
    : [active];
}
function updateBulkButtons(git, oxygen) {
  const scope = dom.reviewScope?.value || 'git';
  const available = scope === 'oxygen' ? oxygen : git;
  dom.acceptAllButton.disabled = !available;
  dom.rejectAllButton.disabled = !available;
}
function reviewAll(accept) {
  const files = reviewFiles();
  const scope = dom.reviewScope?.value || 'git';
  for (const file of files) {
    if (scope === 'oxygen') {
      let next = file.current;
      // Work backwards so offsets remain valid; nested insertions are resolved
      // in later passes rather than applying overlapping ranges.
      for (let pass = 0; pass < 100; pass++) {
        const changes = ditaCore.collectOxyTrackedChanges(next);
        if (!changes.length) break;
        let right = next.length;
        for (const change of changes.reverse()) {
          if (change.index + change.matchLength > right) continue;
          next = next.slice(0, change.index) + getOxyReplacement(change, accept) + next.slice(change.index + change.matchLength);
          right = change.index;
        }
      }
      setFileContent(file, next);
    } else {
      const isMap = /\.ditamap$/i.test(state.activePath);
      const baseline = isMap ? file.reviewBaseline ?? file.baseline : state.reviewBaseline;
      const current = isMap ? file.reviewCurrent ?? file.current : state.reviewCurrent;
      const before = new Map(state.reviewDecisions);
      const decisions = new Map();
      groupDiffRows(lineDiff(baseline, current), REVIEW_CONTEXT_SIZE).forEach((group, index) => {
        if (group.type === 'same') return;
        const decision = accept ? 'accept' : 'reject';
        decisions.set(index, decision);
        state.reviewDecisions.set(isMap ? `${file.path}::${index}` : index, decision);
      });
      setFileContent(file, applyDiffGroups(baseline, current, decisions, REVIEW_CONTEXT_SIZE), {
        historyMeta: { reviewDecisionsBefore: before, reviewDecisionsAfter: new Map(state.reviewDecisions) }
      });
    }
  }
  const active = state.filesMap.get(state.activePath);
  if (active) {
    updateVisual(active, true);
    if (/\.ditamap$/i.test(active.path)) renderMapReview(active); else renderDiff(active, scope === 'oxygen');
  }
  setStatus(`${scope === 'oxygen' ? 'Oxygen 修订' : 'Git 工作区变更'}：已${accept ? '接受' : '拒绝'}全部；保存后写入磁盘`);
}

return { resetReviewSnapshot, renderDiff, renderMapReview, reviewAll };
  }
  const api = { createReviewController };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DitaReview = api;
})(typeof window === 'undefined' ? globalThis : window);

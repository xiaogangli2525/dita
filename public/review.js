'use strict';
(function (root) {
  const markup = typeof module !== 'undefined' ? require('./review-markup') : root.DitaReviewMarkup;
  const progress = typeof module !== 'undefined' ? require('./review-store') : root.DitaReviewStore;
  function createReviewController({ state, dom, ditaCore, setFileContent, updateVisual, renderTabs, updateHistoryButtons, setStatus }) {
    const { lineDiff, groupDiffRows, applyDiffGroups, inlineDiff } = ditaCore;
    const REVIEW_CONTEXT_SIZE = 3;
    const locations = new Map();
    let storage;
    try { storage = root.localStorage; }
    catch (error) { console.warn('无法读取审阅进度存储', error); }
    const reviewStore = progress.createReviewStore(storage);
    let reviewSurface = null, reviewingMap = false;
    const legend = dom.reviewPane?.querySelector('.review-legend');
    const reviewBlocks = 'h1,h2,h3,h4,h5,h6,p,li,pre,td,th,dt,dd,figcaption,img,blockquote,[data-dita-source="fn"],[data-dita-source="note"],[data-dita-source="stentry"]';
    const applyDecisions = (baseline, current, decisions) => applyDiffGroups(baseline, current, decisions, 0, 'accept');
function resetReviewSnapshot(file) {
  const saved = file && reviewStore.restore(state, file);
  state.reviewGroups = new Map();
  state.reviewDecisions = saved ? saved.decisions : new Map();
  state.reviewPath = file ? file.path : '';
  state.reviewBaseline = saved ? saved.baseline : '';
  state.reviewCurrent = saved ? saved.current : '';
}

// A block decision changes file.current while the review still refers to the
// original baseline/current pair. Preserve that session across a temporary
// mode switch as long as the current content is still derived from it.
function reviewSnapshotCanReuse(file) {
  if (!file || state.reviewPath !== file.path) return false;
  if (state.reviewBaseline !== file.baseline) return false;
  if (state.reviewCurrent === file.current) return true;
  return applyDecisions(
    state.reviewBaseline,
    state.reviewCurrent,
    state.reviewDecisions
  ) === file.current;
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

function clearReviewLocations() {
  locations.clear();
  if (legend) legend.hidden = true;
  markup.clear(dom.visualEditor);
  dom.visualEditor.querySelectorAll('[data-review-change],[data-review-deletion]').forEach(node => {
    delete node.dataset.reviewChange;
    delete node.dataset.reviewDeletion;
  });
}

function markReviewLocations(file, surface, groups, keyFor, baseline) {
  if (surface?.ditaSourceContent !== file.current || !groups.some(group => group.type === 'changed')) return;
  const source = file.current;
  let tree;
  try { tree = root.DitaXmlSource.inspectSource(source); }
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
    const key = keyFor(index), decision = state.reviewDecisions.get(key);
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

function focusReviewGroup(key) {
  const target = locations.get(key)?.[0];
  if (!target) {
    setStatus('这处变更可在右侧对照，正文没有对应位置。');
    return;
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
  clearReviewLocations();
  if (!file) {
    resetReviewSnapshot(null);
    showReviewEmpty('请先从左侧打开一个 Topic 或 Map，再审阅文档变更。');
    dom.reviewMeta.textContent = '';
    dom.acceptAllButton.disabled = true;
    dom.rejectAllButton.disabled = true;
    return;
  }

  if (resetSnapshot || reviewSurface !== file || reviewingMap || !reviewSnapshotCanReuse(file)) resetReviewSnapshot(file);
  reviewSurface = file; reviewingMap = false;
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
  const groups = state.reviewBaseline === state.reviewCurrent ? [] : groupDiffRows(lineDiff(state.reviewBaseline, state.reviewCurrent), REVIEW_CONTEXT_SIZE);
  const hasGitDiff = groups.some(g => g.type !== 'same');
  markReviewLocations(file, dom.visualEditor, groups, index => index, state.reviewBaseline);
  if (oxyChanges.length && hasGitDiff) {
    const gitHeader = document.createElement('div');
    gitHeader.className = 'diff-section-header';
    gitHeader.textContent = 'Git 工作区变更';
    fragment.append(gitHeader);
  }
  groups.forEach((group, index) => {
    if (group.type === 'same') {
      if (!hasGitDiff) return;
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
      if (!event.target.closest('button')) focusReviewGroup(index);
    });
    block.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
        event.preventDefault();
        focusReviewGroup(index);
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

  if (hasGitDiff || oxyCount) dom.diff.replaceChildren(fragment);
  else showReviewEmpty('当前 Topic 没有待审阅的变更。修改正文或应用 AI 提案后，可在这里查看差异。');
  const decided = Array.from(state.reviewDecisions.values()).length;
  const pending = Math.max(0, state.reviewGroups.size - decided);
  updateBulkButtons(changed > 0, oxyCount > 0);

  const oxySummary = oxyCount ? oxyCount + ' 个 Oxygen 修订' : '';
  const gitSummary = changed ? changed + ' 行变更，' + pending + ' 个待审块' : '';
  const combinedSummary = [oxySummary, gitSummary].filter(Boolean).join('；') || '无变更';
  dom.reviewMeta.textContent = combinedSummary;
  reviewStore.save(state, file, state.reviewBaseline, state.reviewCurrent, state.reviewDecisions);
  if (reviewStore.warning) dom.reviewMeta.textContent += ' · ' + reviewStore.warning;
  setStatus(combinedSummary);
}

function showReviewEmpty(message) {
  const empty = document.createElement('p');
  empty.className = 'review-empty';
  empty.textContent = message;
  dom.diff.replaceChildren(empty);
}

function renderMapReview(file) {
  clearReviewLocations();
  const restoreAll = reviewSurface !== file || !reviewingMap;
  reviewSurface = file; reviewingMap = true;
  state.reviewGroups = new Map();
  const topicFiles = Array.from(state.mapAuthorPaths || [])
    .map(path => state.filesMap.get(path))
    .filter(Boolean);
  for (const topic of [file, ...topicFiles].filter(Boolean)) {
    if (restoreAll || !mapReviewSnapshotCanReuse(topic)) {
      const saved = reviewStore.restore(state, topic);
      topic.reviewBaseline = saved.baseline;
      topic.reviewCurrent = saved.current;
      for (const key of Array.from(state.reviewDecisions.keys())) {
        if (typeof key === 'string' && key.startsWith(`${topic.path}::`)) state.reviewDecisions.delete(key);
      }
      for (const [index, decision] of saved.decisions) state.reviewDecisions.set(`${topic.path}::${index}`, decision);
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
    showReviewEmpty('当前手册没有待审阅的变更。修改正文或应用 AI 提案后，可在这里查看差异。');
    dom.reviewMeta.textContent = '无变更';
    dom.acceptAllButton.disabled = true;
    dom.rejectAllButton.disabled = true;
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
    const surface = topic === file ? dom.visualEditor.querySelector('[data-map-title]') :
      Array.from(dom.visualEditor.querySelectorAll('.map-topic-surface')).find(node => node.dataset.mapTopicPath === topic.path);
    const keyFor = index => `${topic.path}::${index}`;
    markReviewLocations(topic, surface, groups, keyFor, reviewBaseline);
    for (const [groupIndex, group] of groups.entries()) {
      if (group.type === 'same') {
        const context = document.createElement('div');
        context.className = 'diff-context';
        context.textContent = group.rows.map(row => reviewRowLabel(row.text)).join(' · ');
        section.append(context);
        continue;
      }
      const decisionKey = keyFor(groupIndex);
      state.reviewGroups.set(decisionKey, { ...group, topicPath: topic.path });
      const decision = state.reviewDecisions.get(decisionKey);
      const block = document.createElement('div');
      block.className = `diff-block${decision ? ` decision-${decision}` : ''}`;
      block.tabIndex = 0;
      block.setAttribute('aria-label', `定位 ${topic.path} 的变更`);
      block.addEventListener('click', event => {
        if (!event.target.closest('button')) focusReviewGroup(decisionKey);
      });
      block.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
          event.preventDefault();
          focusReviewGroup(decisionKey);
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
        reset.addEventListener('click', () => resetReviewedMapGroup(file, topic, decisionKey));
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
  for (const topic of [file, ...topicFiles].filter(Boolean)) {
    reviewStore.save(state, topic, topic.reviewBaseline, topic.reviewCurrent, mapReviewDecisions(topic.path));
  }
  if (reviewStore.warning) dom.reviewMeta.textContent += ' · ' + reviewStore.warning;
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
  return applyDecisions(
    topic.reviewBaseline,
    topic.reviewCurrent,
    mapReviewDecisions(topic.path, '', null)
  ) === topic.current;
}

function applyReviewedMapGroup(file, topic, decisionKey, groupIndex, accept) {
  if (!file || !topic) return;
  const previousDecisions = new Map(state.reviewDecisions || []);
  const decisions = new Map(state.reviewDecisions || []);
  decisions.set(decisionKey, accept ? 'accept' : 'reject');
  state.reviewDecisions = decisions;
  const local = mapReviewDecisions(topic.path, decisionKey, { index: groupIndex, decision: accept ? 'accept' : 'reject' });
  const next = applyDecisions(topic.reviewBaseline ?? topic.baseline, topic.reviewCurrent ?? topic.current, local);
  const changed = setFileContent(topic, next, {
    historyMeta: {
      reviewDecisionsBefore: previousDecisions,
      reviewDecisionsAfter: new Map(decisions)
    }
  });
  if (changed && topic !== file) updateVisual(file, true);
  renderTabs();
  updateHistoryButtons();
  renderMapReview(file);
  setStatus(accept ? `已接受 ${topic.path} 的所选变更块` : `已拒绝 ${topic.path} 的所选变更块`);
}

function resetReviewedMapGroup(file, topic, decisionKey) {
  if (!file || !topic) return;
  const previousDecisions = new Map(state.reviewDecisions || []);
  const decisions = new Map(state.reviewDecisions || []);
  decisions.delete(decisionKey);
  state.reviewDecisions = decisions;
  const local = mapReviewDecisions(topic.path, decisionKey, null);
  const next = applyDecisions(topic.reviewBaseline ?? topic.baseline, topic.reviewCurrent ?? topic.current, local);
  const changed = setFileContent(topic, next, {
    historyMeta: {
      reviewDecisionsBefore: previousDecisions,
      reviewDecisionsAfter: new Map(decisions)
    }
  });
  if (changed && topic !== file) updateVisual(file, true);
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
  const next = applyDecisions(state.reviewBaseline, state.reviewCurrent, decisions);
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
  const next = applyDecisions(state.reviewBaseline, state.reviewCurrent, decisions);
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

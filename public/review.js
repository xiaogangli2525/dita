'use strict';
(function (root) {
  const markup = typeof module !== 'undefined' ? require('./review-markup') : root.DitaReviewMarkup;
  const views = typeof module !== 'undefined' ? require('./review-view') : root.DitaReviewView;
  const progress = typeof module !== 'undefined' ? require('./review-store') : root.DitaReviewStore;
  function createReviewController({ state, dom, ditaCore, setFileContent, updateVisual, renderTabs, updateHistoryButtons, setStatus }) {
    const { lineDiff, groupDiffRows, applyDiffGroups, inlineDiff } = ditaCore;
    const REVIEW_CONTEXT_SIZE = 3;
    const reviewView = views.createReviewView({ document: dom.visualEditor?.ownerDocument || root.document, inlineDiff });
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
function reviewFrame(file, inManual = reviewingMap) {
  return {
    file, inManual, rootPath: state.activePath,
    baseline: inManual ? file.reviewBaseline ?? file.baseline : state.reviewBaseline,
    current: inManual ? file.reviewCurrent ?? file.current : state.reviewCurrent,
    keyFor: inManual ? index => `${file.path}::${index}` : index => index
  };
}

function decisionsFor(frame, source = state.reviewDecisions) {
  if (!frame.inManual) return new Map([...source].filter(([key]) => typeof key === 'number'));
  const prefix = frame.file.path + '::', decisions = new Map();
  for (const [key, decision] of source) {
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
    const index = Number(key.slice(prefix.length));
    if (Number.isInteger(index)) decisions.set(index, decision);
  }
  return decisions;
}

function reviewSnapshotCanReuse(file, inManual = false) {
  if (!file) return false;
  if (inManual ? typeof file.reviewBaseline !== 'string' || typeof file.reviewCurrent !== 'string' : state.reviewPath !== file.path) return false;
  const frame = reviewFrame(file, inManual);
  return frame.baseline === file.baseline && (frame.current === file.current ||
    applyDecisions(frame.baseline, frame.current, decisionsFor(frame)) === file.current);
}

function saveFrame(frame) {
  reviewStore.save(state, frame.file, frame.baseline, frame.current, decisionsFor(frame));
}

function appendGitGroups(container, frame, groups) {
  let changed = 0;
  for (const [index, group] of groups.entries()) {
    if (group.type === 'same') {
      container.append(reviewView.context(group.rows));
      continue;
    }
    const key = frame.keyFor(index);
    changed += group.rows.length;
    state.reviewGroups.set(key, frame.inManual ? { ...group, topicPath: frame.file.path } : group);
    const number = frame.inManual ? index + 1 : state.reviewGroups.size;
    container.append(reviewView.block({
      group, number, decision: state.reviewDecisions.get(key),
      label: frame.inManual ? `定位 ${frame.file.path} 的变更` : `定位变更块 ${number}`,
      focus: () => focusReviewGroup(key),
      decide: decision => applyReviewedGroup(frame, index, decision)
    }));
  }
  return changed;
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

function surfaceFor(file) {
  if (file.path === state.activePath) return /\.ditamap$/i.test(file.path) ?
    dom.visualEditor.querySelector('[data-map-title]') : dom.visualEditor;
  return Array.from(dom.visualEditor.querySelectorAll('.map-topic-surface')).find(node => node.dataset.mapTopicPath === file.path);
}

function scrollToOxyChange(oxyIndex, file) {
  if (typeof oxyIndex !== 'number') return;
  const el = surfaceFor(file)?.querySelector('[data-oxy-index="' + oxyIndex + '"]');
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
    scrollToOxyChange(oxyIndex, file);
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
  const frame = reviewFrame(file, false);
  const groups = frame.baseline === frame.current ? [] : groupDiffRows(lineDiff(frame.baseline, frame.current), REVIEW_CONTEXT_SIZE);
  const hasGitDiff = groups.some(g => g.type !== 'same');
  markReviewLocations(file, dom.visualEditor, groups, frame.keyFor, frame.baseline);
  if (oxyChanges.length && hasGitDiff) {
    const gitHeader = document.createElement('div');
    gitHeader.className = 'diff-section-header';
    gitHeader.textContent = 'Git 工作区变更';
    fragment.append(gitHeader);
  }
  const changed = appendGitGroups(fragment, frame, hasGitDiff ? groups : []);

  if (hasGitDiff || oxyCount) dom.diff.replaceChildren(fragment);
  else showReviewEmpty('当前 Topic 没有待审阅的变更。修改正文或应用 AI 提案后，可在这里查看差异。');
  const decided = decisionsFor(frame).size;
  const pending = Math.max(0, state.reviewGroups.size - decided);
  updateBulkButtons(changed > 0, oxyCount > 0);

  const oxySummary = oxyCount ? oxyCount + ' 个 Oxygen 修订' : '';
  const gitSummary = changed ? changed + ' 行变更，' + pending + ' 个待审块' : '';
  const combinedSummary = [oxySummary, gitSummary].filter(Boolean).join('；') || '无变更';
  dom.reviewMeta.textContent = combinedSummary;
  saveFrame(frame);
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
    if (restoreAll || !reviewSnapshotCanReuse(topic, true)) {
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
    const frame = reviewFrame(topic, true);
    const groups = groupDiffRows(lineDiff(frame.baseline, frame.current), REVIEW_CONTEXT_SIZE);
    const surface = surfaceFor(topic);
    markReviewLocations(topic, surface, groups, frame.keyFor, frame.baseline);
    appendGitGroups(section, frame, groups);
    fragment.append(section);
  }
  dom.diff.replaceChildren(fragment);
  updateBulkButtons(changedFiles.length > 0, totalOxy > 0);

  const oxySummary = totalOxy ? totalOxy + ' 个 Oxygen 修订' : '';
  const gitSummary = changedFiles.length ? changedFiles.length + ' 个 topic 有变更' : '';
  const combinedSummary = [oxySummary, gitSummary].filter(Boolean).join('；') || '无变更';
  dom.reviewMeta.textContent = combinedSummary;
  for (const topic of [file, ...topicFiles].filter(Boolean)) {
    saveFrame(reviewFrame(topic, true));
  }
  if (reviewStore.warning) dom.reviewMeta.textContent += ' · ' + reviewStore.warning;
  setStatus(combinedSummary);
}

// Single-block actions and bulk Git review use the same history transaction.
function writeReviewDecisions(frame, updates) {
  const before = new Map(state.reviewDecisions);
  const decisions = new Map(before);
  for (const [index, decision] of updates) {
    const key = frame.keyFor(index);
    if (decision === null) decisions.delete(key); else decisions.set(key, decision);
  }
  state.reviewDecisions = decisions;
  return setFileContent(frame.file, applyDecisions(frame.baseline, frame.current, decisionsFor(frame)), {
    historyMeta: { reviewDecisionsBefore: before, reviewDecisionsAfter: new Map(decisions) }
  });
}

function renderActiveReview(refreshSurface = false) {
  const active = state.filesMap.get(state.activePath);
  if (active && refreshSurface) updateVisual(active, true);
  if (active && /\.ditamap$/i.test(active.path)) renderMapReview(active);
  else renderDiff(active, false);
}

function applyReviewedGroup(frame, index, decision) {
  const current = reviewFrame(frame.file, frame.inManual);
  if (state.activePath !== frame.rootPath || state.filesMap.get(frame.file.path) !== frame.file ||
      current.baseline !== frame.baseline || current.current !== frame.current || !reviewSnapshotCanReuse(frame.file, frame.inManual)) {
    renderActiveReview(true);
    setStatus('原文已变化，已更新审阅，请重新核对所选变更块。');
    return;
  }
  const changed = writeReviewDecisions(frame, new Map([[index, decision]]));
  const active = state.filesMap.get(frame.rootPath);
  if (changed && active !== frame.file) updateVisual(active, true);
  renderTabs();
  updateHistoryButtons();
  renderActiveReview();
  const location = frame.inManual ? ' ' + frame.file.path + ' 的' : '';
  setStatus(decision === null ? `已撤销${location || '该'}审阅决定` :
    `已${decision === 'accept' ? '接受' : '拒绝'}${location}所选变更块`);
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
      const frame = reviewFrame(file, /\.ditamap$/i.test(state.activePath));
      const decisions = new Map();
      groupDiffRows(lineDiff(frame.baseline, frame.current), REVIEW_CONTEXT_SIZE).forEach((group, index) => {
        if (group.type !== 'same') decisions.set(index, accept ? 'accept' : 'reject');
      });
      writeReviewDecisions(frame, decisions);
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

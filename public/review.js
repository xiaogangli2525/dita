'use strict';
(function (root) {
  const sessions = typeof module !== 'undefined' ? require('./review-session') : root.DitaReviewSession;
  const bodyLocations = typeof module !== 'undefined' ? require('./review-locations') : root.DitaReviewLocations;
  const views = typeof module !== 'undefined' ? require('./review-view') : root.DitaReviewView;
  const progress = typeof module !== 'undefined' ? require('./review-store') : root.DitaReviewStore;
  function createReviewController({ state, dom, ditaCore, setFileContent, updateVisual, renderTabs, updateHistoryButtons, setStatus }) {
    const { inlineDiff } = ditaCore;
    const REVIEW_CONTEXT_SIZE = 3;
    const reviewView = views.createReviewView({ document: dom.visualEditor?.ownerDocument || root.document, inlineDiff });
    let storage;
    try { storage = root.localStorage; }
    catch (error) { console.warn('无法读取审阅进度存储', error); }
    const reviewStore = progress.createReviewStore(storage);
    let reviewSurface = null, reviewingMap = false;
    const session = sessions.createReviewSession({ state, progress: reviewStore });
    const resetReviewSnapshot = session.resetTopic, decisionsFor = session.decisionsFor, saveFrame = session.save;
    const reviewFrame = (file, inManual = reviewingMap) => session.frame(file, inManual);
    const reviewSnapshotCanReuse = (file, inManual = false) => session.canReuse(file, inManual);
    const { clear: clearReviewLocations, mark: markReviewLocations, focus: focusReviewGroup } = bodyLocations.createReviewLocations({
      visualEditor: dom.visualEditor, legend: dom.reviewPane?.querySelector('.review-legend'),
      inspectSource: ditaCore.inspectSource || root.DitaXmlSource?.inspectSource,
      ditaCore, decisionFor: session.decision, setStatus
    });

    function appendGitGroups(container, frame, groups) {
      let changed = 0;
      for (const [index, group] of groups.entries()) {
        if (group.type === 'same') {
          container.append(reviewView.context(group.rows));
          continue;
        }
        const { key, number, decision } = session.registerGroup(frame, index, group);
        changed += group.rows.length;
        container.append(reviewView.block({
          group, number, decision,
          label: frame.inManual ? `定位 ${frame.file.path} 的变更` : `定位变更块 ${number}`,
          focus: () => focusReviewGroup(key),
          decide: decision => applyReviewedGroup(frame, index, decision)
        }));
      }
      return changed;
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
      const expected = file.current, rootPath = state.activePath;
      return reviewView.oxygen(change, oxyIndex, {
        focus: () => scrollToOxyChange(oxyIndex, file),
        decide: accept => {
          if (state.activePath !== rootPath || state.filesMap.get(file.path) !== file || file.current !== expected) {
            renderActiveReview(true);
            setStatus('原文已变化，已更新审阅，请重新核对所选修订。');
            return;
          }
          applyOxyChange(file, change, accept);
        }
      });
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
      session.clearGroups();
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
      const groups = session.groups(frame, REVIEW_CONTEXT_SIZE);
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
      const pending = Math.max(0, session.groupCount - decided);
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
      const topicFiles = Array.from(state.mapAuthorPaths || []).map(path => state.filesMap.get(path)).filter(Boolean);
      const allFiles = [...new Set([file, ...topicFiles].filter(Boolean))];
      session.prepareManual(allFiles, restoreAll);
      const changedFiles = allFiles.filter(topic => { const frame = reviewFrame(topic, true); return frame.baseline !== frame.current; });
      const fragment = document.createDocumentFragment();
      let totalOxy = 0;
      for (const topic of allFiles) {
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
        const groups = session.groups(frame, REVIEW_CONTEXT_SIZE);
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
      for (const topic of allFiles) {
        saveFrame(reviewFrame(topic, true));
      }
      if (reviewStore.warning) dom.reviewMeta.textContent += ' · ' + reviewStore.warning;
      setStatus(combinedSummary);
    }

    // Single-block actions and bulk Git review use the same history transaction.
    function writeReviewDecisions(frame, updates) {
      return session.decide(frame, updates, setFileContent);
    }

    function renderActiveReview(refreshSurface = false) {
      const active = state.filesMap.get(state.activePath);
      if (active && refreshSurface) updateVisual(active, true);
      if (active && /\.ditamap$/i.test(active.path)) renderMapReview(active);
      else renderDiff(active, false);
    }

    function applyReviewedGroup(frame, index, decision) {
      if (!session.isCurrent(frame)) {
        renderActiveReview(true);
        setStatus('原文已变化，已更新审阅，请重新核对所选变更块。');
        return;
      }
      writeReviewDecisions(frame, new Map([[index, decision]]));
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
        ? [...new Set([active, ...Array.from(state.mapAuthorPaths || [], path => state.filesMap.get(path))].filter(Boolean))]
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
      if (scope === 'git' && files.some(file => !session.isCurrent(reviewFrame(file, /\.ditamap$/i.test(state.activePath))))) {
        renderActiveReview(true); setStatus('原文已变化，已更新审阅，请重新核对后再批量处理。'); return;
      }
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
          session.groups(frame, REVIEW_CONTEXT_SIZE).forEach((group, index) => {
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

    return { resetReviewSnapshot, renderDiff, renderMapReview, reviewAll, restoreDecisions: session.restoreDecisions };
  }
  const api = { createReviewController };
  if (typeof module !== 'undefined') module.exports = api;
  else root.DitaReview = api;
})(typeof window === 'undefined' ? globalThis : window);

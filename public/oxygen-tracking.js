// @ts-check
'use strict';
(function (root) {
  const xml = typeof module !== 'undefined' ? require('./xml-source') : root.DitaXmlSource;
  const oxygen = typeof module !== 'undefined' ? require('./oxygen-core') : root.DitaOxygenCore;
  const diff = typeof module !== 'undefined' ? require('./diff-core') : root.DitaDiffCore;
  /** @typedef {import('./data-contracts').OxygenChange} OxygenChange */
  /** @typedef {import('./data-contracts').OxygenTrackingAuthor} TrackingAuthor */
  /** @typedef {import('./data-contracts').XmlSourceElement} XmlSourceElement */
  /** @typedef {import('./data-contracts').XmlSourceToken} XmlSourceToken */
  /** @returns {never} */
  function unsupported() {
    throw new Error('跟踪修订第一版支持文字增删替换；结构、属性或跨修订边界的操作请先处理已有修订，或关闭跟踪后修改');
  }
  /** @param {string} value */
  const escape = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
  /** @param {string} source */
  function optionTokens(source) { return xml.scan(source).filter(t => t.kind === 'pi' && /^<\?oxy_options\b/.test(source.slice(t.start, t.end))); }
  /** @param {string} source */
  function setting(source) {
    try {
      const token = optionTokens(source).at(-1);
      return token ? oxygen.parseOxyPIAttrs(source.slice(token.start + 13, token.end - 2)).track_changes || null : null;
    } catch { return null; } // Source mode may temporarily contain incomplete XML.
  }
  /** @param {string} source */
  function enabled(source) { return setting(source) === 'on'; }
  /** @param {string} source @param {boolean} on */
  function setEnabled(source, on) {
    xml.validateXml(source);
    const tokens = optionTokens(source);
    if (tokens.length > 1) throw new Error('文档含多个 oxy_options，请先在源码中核对');
    const token = tokens[0];
    if (!token) return source + (source.endsWith('\n') ? '' : source.includes('\r\n') ? '\r\n' : '\n') + '<?oxy_options track_changes="' + (on ? 'on' : 'off') + '"?>';
    const previous = source.slice(token.start, token.end);
    const next = /\btrack_changes\s*=/.test(previous) ? previous.replace(/\btrack_changes\s*=\s*(["'])[^]*?\1/, 'track_changes="' + (on ? 'on' : 'off') + '"') : previous.slice(0, -2) + ' track_changes="' + (on ? 'on' : 'off') + '"?>';
    return source.slice(0, token.start) + next + source.slice(token.end);
  }
  // Resolve only insertion/deletion instructions. Comments and unknown Oxygen
  // metadata remain exact; unsupported records must never disappear in bulk review.
  /** @param {string} source @param {boolean} accept */
  function resolve(source, accept, includeComments = false) {
    for (let pass = 0; pass < 100; pass++) {
      const changes = oxygen.collectOxyTrackedChanges(source).filter(c => includeComments || c.type !== 'comment');
      if (!changes.length) return source;
      let right = source.length, changed = false;
      for (const c of changes.reverse()) {
        if (c.index + c.matchLength > right) continue;
        const value = c.type === 'delete' ? accept ? '' : c.deletedContent : c.type === 'comment' || accept ? c.keepContent : '';
        source = source.slice(0, c.index) + value + source.slice(c.index + c.matchLength);
        right = c.index; changed = true;
      }
      if (!changed) break;
    }
    throw new Error('修订嵌套过深，请在 Oxygen 中处理');
  }
  /** @param {string} source @param {boolean} accept */
  function resolveForReview(source, accept) {
    if (oxygen.hasUnsupportedChanges(source)) throw new Error('含尚不支持的 Oxygen 属性、CDATA 修订或批注回复，请在 Oxygen 中处理');
    const next = resolve(source, accept, true);
    if (oxygen.hasUnsupportedChanges(next)) throw new Error('恢复内容包含尚不支持的 Oxygen 修订，请在 Oxygen 中处理');
    xml.validateXml(next); return next;
  }
  /** @param {string} source */
  function units(source) {
    const values = []; let at = 0;
    while (at < source.length) {
      const start = at;
      if (source[at] === '&') { const end = source.indexOf(';', at); if (end < 0) unsupported(); at = end + 1; }
      else {
        const codePoint = source.codePointAt(at);
        if (codePoint === undefined) unsupported();
        at += codePoint > 0xffff ? 2 : 1;
      }
      const raw = source.slice(start, at), value = oxygen.decodeEntities(raw);
      if (Array.from(value).length !== 1) unsupported();
      values.push({ raw, value });
    }
    return values;
  }
  /** @param {OxygenChange} record @param {TrackingAuthor} meta */
  const ownRevision = (record, meta) => record.author === meta.author && record.id?.startsWith('dita-');
  /** @param {string} before @param {string} after @param {TrackingAuthor} meta
   * @param {readonly OxygenChange[]} records @param {readonly XmlSourceToken[]} previousPIs
   * @param {readonly XmlSourceToken[]} nextPIs @returns {string} */
  function trackAroundRevisions(before, after, meta, records, previousPIs, nextPIs) {
    /** @type {Map<number, number>} */
    const afterStarts = new Map();
    /** @type {Map<number, number>} */
    const afterEnds = new Map();
    for (const [index, token] of previousPIs.entries()) {
      afterStarts.set(token.start, nextPIs[index].start);
      afterEnds.set(token.end, nextPIs[index].end);
    }
    const edits = [];
    let lastEnd = 0, oldCursor = 0, newCursor = 0;
    for (const record of records) {
      const oldStart = record.index, oldEnd = oldStart + record.matchLength;
      // Splitting around an inner record could separate an enclosing pair.
      if (oldStart < lastEnd) unsupported();
      lastEnd = oldEnd;
      if (ownRevision(record, meta)) continue;
      const newStart = afterStarts.get(oldStart), newEnd = afterEnds.get(oldEnd);
      const raw = before.slice(oldStart, oldEnd);
      if (newStart === undefined || newEnd === undefined || raw !== after.slice(newStart, newEnd)) {
        throw new Error('选区修改了其他作者或外部导入的修订，请避开该修订，或先审阅处理后再修改');
      }
      edits.push(trackRun(before.slice(oldCursor, oldStart), after.slice(newCursor, newStart),
        { ...meta, id: meta.id + '-segment-' + edits.length }) + raw);
      oldCursor = oldEnd;
      newCursor = newEnd;
    }
    edits.push(trackRun(before.slice(oldCursor), after.slice(newCursor), { ...meta, id: meta.id + '-segment-' + edits.length }));
    return edits.join('');
  }
  /** @param {string} before @param {string} after @param {TrackingAuthor} meta @returns {string} */
  function trackRun(before, after, meta) {
    if (before === after) return before;
    const beforeTokens = xml.scan(before), afterTokens = xml.scan(after);
    if ([...beforeTokens, ...afterTokens].some(t => !['text', 'pi'].includes(t.kind))) unsupported();
    const records = oxygen.collectOxyTrackedChanges(before);
    if (records.some(c => c.type === 'comment')) unsupported();
    const previousPIs = beforeTokens.filter(t => t.kind === 'pi'), nextPIs = afterTokens.filter(t => t.kind === 'pi');
    if (previousPIs.length !== nextPIs.length ||
        previousPIs.length !== records.reduce((n, c) => n + (c.type === 'insert' ? 2 : 1), 0) ||
        previousPIs.some((token, i) => before.slice(token.start, token.end) !== after.slice(nextPIs[i].start, nextPIs[i].end))) unsupported();
    if (records.some(record => !ownRevision(record, meta))) {
      return trackAroundRevisions(before, after, meta, records, previousPIs, nextPIs);
    }
    for (const token of previousPIs) {
      const pi = before.slice(token.start, token.end);
      const allowed = /^<\?oxy_insert_end\b/.test(pi) ? [] : ['author', 'timestamp', 'id', 'content'];
      if (Object.keys(oxygen.parseOxyPIAttrs(pi)).some(key => !allowed.includes(key))) unsupported();
    }
    const base = resolve(before, false), final = resolve(after, true);
    const oldUnits = units(base), newUnits = units(final);
    const parts = diff.inlineDiff(oldUnits.map(u => u.value).join(''), newUnits.map(u => u.value).join(''));
    let oldAt = 0, newAt = 0, index = 0;
    const timestamp = records[0]?.timestamp || meta.timestamp;
    /** @param {'old' | 'new'} type @param {string} raw */
    function wrap(type, raw) {
      const attrs = ' author="' + escape(meta.author) + '" timestamp="' + escape(timestamp) + '" id="' + escape(meta.id + '-' + index++) + '"';
      return type === 'new' ? '<?oxy_insert_start' + attrs + '?>' + raw + '<?oxy_insert_end?>' : '<?oxy_delete' + attrs + ' content="' + escape(raw) + '"?>';
    }
    return parts.map(part => {
      const size = Array.from(part.text).length, oldPart = oldUnits.slice(oldAt, oldAt + size), newPart = newUnits.slice(newAt, newAt + size);
      if (part.type !== 'new') oldAt += size;
      if (part.type !== 'old') newAt += size;
      if (part.type === 'same') return oldPart.map((unit, i) => unit.raw === newPart[i].raw ? unit.raw : wrap('old', unit.raw) + wrap('new', newPart[i].raw)).join('');
      return wrap(part.type, (part.type === 'new' ? newPart : oldPart).map(u => u.raw).join(''));
    }).join('');
  }
  /** @param {string} source */
  function commentRuns(source) {
    const runs = [], comments = [];
    let start = 0;
    for (const token of xml.scan(source)) {
      if (token.kind !== 'comment' && token.kind !== 'pi') continue;
      const raw = source.slice(token.start, token.end);
      if (token.kind !== 'comment' && !/^<\?oxy_comment_(?:start|end)(?:\s|\?)/.test(raw)) continue;
      runs.push(source.slice(start, token.start));
      comments.push(raw);
      start = token.end;
    }
    runs.push(source.slice(start));
    return { runs, comments };
  }
  /** @param {string} before @param {string} after @param {TrackingAuthor} meta */
  function trackGap(before, after, meta) {
    const old = commentRuns(before), next = commentRuns(after);
    if (old.comments.length !== next.comments.length || old.comments.some((raw, i) => raw !== next.comments[i])) unsupported();
    // New revision records must stay within each text run so accepting or
    // rejecting them can never delete a comment or change its original order.
    if (!old.comments.length) return trackRun(before, after, meta);
    return old.runs.map((run, i) =>
      trackRun(run, next.runs[i], { ...meta, id: meta.id + '-' + i }) + (old.comments[i] || '')
    ).join('');
  }
  // Compare validated XML structure, then track text gaps at their exact source
  // ranges. XML tags, entities, namespaces and inherited conditions are never
  // split or inferred from a plain-string diff.
  /** @param {string} before @param {string} after @param {TrackingAuthor} meta */
  function trackEdit(before, after, meta) {
    if (before === after) return before;
    if (!meta.author?.trim()) throw new Error('请先填写修订作者');
    if (oxygen.hasUnsupportedChanges(before)) unsupported();
    const revisions = oxygen.collectOxyTrackedChanges(before);
    const left = xml.inspectSource(before), right = xml.inspectSource(after);
    /** @type {{start: number, end: number, value: string}[]} */
    const patches = [];
    /** @param {XmlSourceElement} node */
    const end = node => node.close?.end ?? node.end;
    if (before.slice(0, left.start) !== after.slice(0, right.start) || before.slice(end(left)) !== after.slice(end(right))) unsupported();
    /** @param {XmlSourceElement} a @param {XmlSourceElement} b */
    function visit(a, b, protectedContent = false) {
      if (before.slice(a.start, end(a)) === after.slice(b.start, end(b))) return;
      if (a.name === b.name && !a.close && b.close && !a.children.length && !b.children.some(c => c.kind === 'element') &&
          before.slice(a.start, a.end).replace(/\/\s*>$/, '>') === after.slice(b.start, b.end) && !a.attrs.conref && !a.attrs.conkeyref && !['foreign', 'unknown'].includes(a.name)) {
        if (protectedContent || revisions.some(c => c.type !== 'comment' && c.index < a.end && c.index + c.matchLength > a.start)) unsupported();
        const value = trackGap('', after.slice(b.end, b.close.start), { ...meta, id: meta.id + '-' + patches.length });
        patches.push({ start: a.start, end: a.end, value: after.slice(b.start, b.end) + value + after.slice(b.close.start, b.close.end) });
        return;
      }
      if (a.name !== b.name || before.slice(a.start, a.end) !== after.slice(b.start, b.end) || before.slice(a.close?.start ?? a.end, end(a)) !== after.slice(b.close?.start ?? b.end, end(b))) unsupported();
      protectedContent ||= Boolean(a.attrs.conref || a.attrs.conkeyref || ['foreign', 'unknown'].includes(a.name));
      if (protectedContent) unsupported();
      const ac = a.children.filter(c => c.kind === 'element'), bc = b.children.filter(c => c.kind === 'element');
      if (ac.length !== bc.length) unsupported();
      let ap = a.end, bp = b.end;
      for (let i = 0; i <= ac.length; i++) {
        const ae = ac[i]?.start ?? a.close?.start ?? a.end, be = bc[i]?.start ?? b.close?.start ?? b.end;
        const previous = before.slice(ap, ae), next = after.slice(bp, be);
        if (previous !== next) {
          // A revision crossing an element boundary cannot be isolated in this gap.
          if (revisions.some(c => c.type !== 'comment' && c.index < ae && c.index + c.matchLength > ap &&
              (c.index < ap || c.index + c.matchLength > ae))) unsupported();
          patches.push({ start: ap, end: ae, value: trackGap(previous, next, { ...meta, id: meta.id + '-' + patches.length }) });
        }
        if (i < ac.length) { visit(ac[i], bc[i], protectedContent); ap = end(ac[i]); bp = end(bc[i]); }
      }
    }
    visit(left, right);
    let output = before;
    for (const patch of patches.sort((a, b) => b.start - a.start)) output = output.slice(0, patch.start) + patch.value + output.slice(patch.end);
    xml.validateXml(output);
    return output;
  }
  const api = { enabled, setting, setEnabled, trackEdit, resolve, resolveForReview };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaOxygenTracking = api;
})(typeof window === 'undefined' ? globalThis : window);

'use strict';
(function (root) {
function lineDiff(oldText, newText) {
  const oldLines = String(oldText).split(/\r?\n/);
  const newLines = String(newText).split(/\r?\n/);
  // Use an LCS table so inserted/deleted lines stay aligned with the nearest
  // unchanged XML line. The previous lock-step comparison made one insertion
  // mark every following line as changed until the end of the document.
  const product = oldLines.length * newLines.length;
  if (product <= 4000000) {
    const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
    for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
      for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
        table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
      }
    }
    const rows = [];
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
        rows.push({ type: 'same', oldIndex: oldIndex + 1, newIndex: newIndex + 1, text: oldLines[oldIndex] });
        oldIndex++;
        newIndex++;
      } else if (newIndex < newLines.length && (oldIndex >= oldLines.length || table[oldIndex][newIndex + 1] >= table[oldIndex + 1][newIndex])) {
        rows.push({ type: 'new', newIndex: newIndex + 1, text: newLines[newIndex++] });
      } else {
        rows.push({ type: 'old', oldIndex: oldIndex + 1, text: oldLines[oldIndex++] });
      }
    }
    return rows;
  }

  // Keep large documents responsive without losing the alignment after a
  // small edit.  The old bounded look-ahead implementation could pick a
  // repeated XML line as an anchor and then classify the rest of the topic as
  // changed.  Myers' shortest-edit-path algorithm follows the nearest valid
  // path instead, so a one-line deletion in a large document remains one
  // deleted row.  The edit distance is capped to keep pathological wholesale
  // replacements bounded; those fall back to the conservative block below.
  const maxEditDistance = Math.min(oldLines.length + newLines.length, 2048);
  const offset = maxEditDistance + 1;
  const trace = [];
  let frontier = new Int32Array(offset * 2 + 3);
  frontier.fill(-1);
  frontier[offset + 1] = 0;

  function rowsFromPath(distance) {
    const path = [];
    let oldIndex = oldLines.length;
    let newIndex = newLines.length;
    for (let edit = distance; edit > 0; edit--) {
      const previous = trace[edit];
      const diagonal = oldIndex - newIndex;
      const down = diagonal === -edit || (diagonal !== edit && previous[offset + diagonal - 1] < previous[offset + diagonal + 1]);
      const previousDiagonal = down ? diagonal + 1 : diagonal - 1;
      const previousOld = previous[offset + previousDiagonal];
      const previousNew = previousOld - previousDiagonal;
      while (oldIndex > previousOld && newIndex > previousNew) {
        path.push({
          type: 'same',
          oldIndex,
          newIndex,
          text: oldLines[oldIndex - 1]
        });
        oldIndex--;
        newIndex--;
      }
      if (oldIndex === previousOld) {
        path.push({ type: 'new', newIndex, text: newLines[newIndex - 1] });
        newIndex--;
      } else {
        path.push({ type: 'old', oldIndex, text: oldLines[oldIndex - 1] });
        oldIndex--;
      }
    }
    while (oldIndex > 0 && newIndex > 0) {
      path.push({
        type: 'same',
        oldIndex,
        newIndex,
        text: oldLines[oldIndex - 1]
      });
      oldIndex--;
      newIndex--;
    }
    while (oldIndex > 0) {
      path.push({ type: 'old', oldIndex, text: oldLines[oldIndex - 1] });
      oldIndex--;
    }
    while (newIndex > 0) {
      path.push({ type: 'new', newIndex, text: newLines[newIndex - 1] });
      newIndex--;
    }
    return path.reverse();
  }

  for (let distance = 0; distance <= maxEditDistance; distance++) {
    // Keep the frontier from before this edit layer for path reconstruction.
    trace.push(frontier.slice());
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let oldIndex;
      if (diagonal === -distance || (diagonal !== distance && frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1])) {
        oldIndex = frontier[offset + diagonal + 1];
      } else {
        oldIndex = frontier[offset + diagonal - 1] + 1;
      }
      let newIndex = oldIndex - diagonal;
      while (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
        oldIndex++;
        newIndex++;
      }
      frontier[offset + diagonal] = oldIndex;
      if (oldIndex >= oldLines.length && newIndex >= newLines.length) return rowsFromPath(distance);
    }
  }

  // A very large replacement is intentionally represented as one changed
  // block. This path is only used once the bounded Myers search is exhausted.
  const rows = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      rows.push({ type: 'same', oldIndex: ++oldIndex, newIndex: ++newIndex, text: oldLines[oldIndex - 1] });
      continue;
    }
    while (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] !== newLines[newIndex]) {
      rows.push({ type: 'old', oldIndex: oldIndex + 1, text: oldLines[oldIndex++] });
      rows.push({ type: 'new', newIndex: newIndex + 1, text: newLines[newIndex++] });
    }
    while (oldIndex < oldLines.length && newIndex >= newLines.length) rows.push({ type: 'old', oldIndex: oldIndex + 1, text: oldLines[oldIndex++] });
    while (newIndex < newLines.length && oldIndex >= oldLines.length) rows.push({ type: 'new', newIndex: newIndex + 1, text: newLines[newIndex++] });
  }
  return rows;
}

// Produce a compact inline diff for a pair of already-readable text values.
// Review rendering uses this instead of displaying an entire XML row when a
// user changed only a word or two.  The result is intentionally small and
// presentation agnostic so both topic and map review panes can render it:
//   [{ type: 'same'|'old'|'new', text: '...' }, ...]
//
// Character-level LCS gives useful precision for short rows.  Very long rows
// are handled with a common-prefix/suffix fallback to keep the review panel
// responsive and bounded in memory.
function inlineDiff(oldText, newText) {
  const oldValue = String(oldText ?? '');
  const newValue = String(newText ?? '');
  if (oldValue === newValue) return oldValue ? [{ type: 'same', text: oldValue }] : [];

  // Work in Unicode code points rather than UTF-16 code units so an emoji or
  // other astral character cannot be split into two independently coloured
  // fragments in the review pane.
  const oldChars = Array.from(oldValue);
  const newChars = Array.from(newValue);
  const maxCells = 1000000;

  function append(result, type, chars) {
    if (!chars.length) return;
    const text = chars.join('');
    const previous = result[result.length - 1];
    if (previous && previous.type === type) previous.text += text;
    else result.push({ type, text });
  }

  // Peel off the obvious context first. Apart from avoiding unnecessary LCS
  // work, this gives replacements the natural shape `[old], [new]` instead
  // of letting an LCS tie consume all of one side before the other (for
  // example, changing "Old title" to "New title").
  let prefix = 0;
  while (prefix < oldChars.length && prefix < newChars.length && oldChars[prefix] === newChars[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldChars.length - prefix &&
    suffix < newChars.length - prefix &&
    oldChars[oldChars.length - suffix - 1] === newChars[newChars.length - suffix - 1]
  ) suffix++;
  const oldMiddle = oldChars.slice(prefix, oldChars.length - suffix);
  const newMiddle = newChars.slice(prefix, newChars.length - suffix);
  const result = [];
  append(result, 'same', oldChars.slice(0, prefix));

  // Keep a bounded algorithm for large rows.  The unchanged prefix and
  // suffix are still useful context while the middle replacement is kept as
  // two precise old/new fragments.
  if (oldMiddle.length * newMiddle.length > maxCells) {
    append(result, 'old', oldMiddle);
    append(result, 'new', newMiddle);
    append(result, 'same', oldChars.slice(oldChars.length - suffix));
    return result;
  }

  const table = Array.from({ length: oldMiddle.length + 1 }, () => new Uint32Array(newMiddle.length + 1));
  for (let oldIndex = oldMiddle.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newMiddle.length - 1; newIndex >= 0; newIndex--) {
      table[oldIndex][newIndex] = oldMiddle[oldIndex] === newMiddle[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
    }
  }

  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldMiddle.length || newIndex < newMiddle.length) {
    if (
      oldIndex < oldMiddle.length &&
      newIndex < newMiddle.length &&
      oldMiddle[oldIndex] === newMiddle[newIndex]
    ) {
      append(result, 'same', [oldMiddle[oldIndex++]]);
    } else if (
      newIndex < newMiddle.length &&
      (oldIndex >= oldMiddle.length || table[oldIndex][newIndex + 1] > table[oldIndex + 1][newIndex])
    ) {
      append(result, 'new', [newMiddle[newIndex++]]);
    } else {
      append(result, 'old', [oldMiddle[oldIndex++]]);
    }
  }
  append(result, 'same', oldChars.slice(oldChars.length - suffix));
  return result;
}

function groupDiffRows(rows, contextSize = 3) {
  const groups = [];
  const pending = [];
  let afterChange = false;

  function emit(rows) {
    if (rows.length) groups.push({ type: 'same', rows });
  }

  for (const row of rows) {
    if (row.type === 'same') {
      pending.push(row);
      continue;
    }

    const rows = pending.splice(0);
    if (!afterChange) emit(contextSize > 0 ? rows.slice(-contextSize) : rows);
    else emit(rows.slice(-contextSize));

    const group = groups[groups.length - 1];
    if (!group || group.type !== 'changed') groups.push({ type: 'changed', rows: [] });
    groups[groups.length - 1].rows.push(row);
    afterChange = true;
  }

  emit(contextSize > 0 ? pending.slice(0, contextSize) : pending);
  return groups;
}

function applyDiffGroups(oldText, newText, decisions, contextSize = 0) {
  // `groupDiffRows` may trim unchanged context between review blocks for a
  // compact display.  That projection must never be used to rebuild the
  // document: omitted context lines would be silently deleted whenever a
  // reviewer accepts or rejects one block in a long file.  The changed-group
  // indexes stay identical when all context is retained, so use an
  // untrimmed grouping for the actual merge.
  const groups = groupDiffRows(lineDiff(oldText, newText), 0);
  const output = [];
  groups.forEach((group, index) => {
    if (group.type === 'same') {
      output.push(...group.rows.map(row => row.text));
      return;
    }
    const decision = decisions instanceof Map ? decisions.get(index) : undefined;
    const keepNew = decision === 'accept';
    const oldRows = group.rows.filter(row => row.type === 'old');
    const newRows = group.rows.filter(row => row.type === 'new');
    output.push(...(keepNew ? newRows : oldRows).map(row => row.text));
  });
  // Preserve the working document's line-ending convention. The baseline
  // often comes from `git show` (LF) while the open file may be CRLF; using
  // the baseline here would rewrite the entire document after one decision.
  const joiner = /\r\n/.test(String(newText))
    ? '\r\n'
    : /\r\n/.test(String(oldText)) ? '\r\n' : '\n';
  return output.join(joiner);
}

const api = { lineDiff, inlineDiff, groupDiffRows, applyDiffGroups };
if (typeof module !== 'undefined') module.exports = api; else root.DitaDiffCore = api;
})(typeof window === 'undefined' ? globalThis : window);

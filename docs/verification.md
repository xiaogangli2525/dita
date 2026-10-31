# Verification

Run `npm ci --ignore-scripts` and `npm test` with Node 20 or later and Git installed.

The regression suite covers:

- XML/GBK round trips, source-preserving Author edits, Oxygen review and bounded diff algorithms.
- Save acknowledgements arriving after newer edits; failed saves preserving the working copy.
- Nested Git paths, dirty branch-switch refusal, disk conflicts, safe create/overwrite and symbolic-link boundaries through real HTTP requests against temporary Git repositories.
- Workspace identity rotation and stale-response rejection, including body decoding after a switch.
- Export orchestration using current buffers and embedded images; missing-image failures and early-return loading cleanup.
- Future AI proposal validation, stale-base rejection, explicit application and undo.

`npm run dev` starts a disposable example Git workspace. Use it for manual browser checks; `npm start` opens real documents according to `DOCS_ROOT`.

Browser checklist:

1. Open a topic; edit in Source/Author; confirm Reading is read-only.
2. Save; verify the pending badge clears while Git review still shows the edit.
3. Type during a delayed save; verify the newer input stays dirty.
4. Open a Map, edit a topic and export without saving; verify current text and embedded local images.
5. Open an invalid/non-Map export and verify the loading indicator clears.
6. Change a Map node; undo; verify neither action writes to disk until Save.
7. Open two tabs, switch workspace in one, and verify the old tab cannot write into it.
8. Check desktop and a 390px iframe/viewport: navigation and inspector open/close, document content remains scrollable, and no horizontal page overflow appears.

The GitHub Actions workflow runs the suite on Node 20 and 22. The browser workflow installs Chromium and runs `npm run test:browser` on Node 22.

## Checks performed for this change

- All 67 automated tests passed locally (Node 24); CI is configured for Node 20 and 22.
- Browser: desktop topic open, Source edit/save, Git diff review, Map Author, HTML preview and Map reorder/undo passed.
- Responsive: 390 × 844 CSS-pixel iframe checked for document navigation, automatic drawer close and scrollable Author content. This is responsive layout verification, not a mobile-device compatibility certification.

## Editor foundation regression checks

- `npm test`: 84 passing tests, including invalid attributes/entities/root structure through the shared validator and HTTP write routes; code/mixed-content/GBK declaration/comment preservation; unified undo/redo.
- `npm run test:browser`: 9 passing checks in real Chromium checks for Topic/Map read-only mode, Chinese text insertion, clipboard paste, table row/column insertion and undo, format/undo, Git and Oxygen bulk review, complete restoration of long Oxygen deletions, Map explicit-save behavior and a 390px viewport. Chinese insertion uses browser text input; operating-system IME composition is not simulated.
- The duplicate hidden preview DOM and its separate renderer/loading pipeline were removed; reading uses the same rendering surface with editing disabled.
- Bulk review scopes are separate: accepting Git changes retains them for comparison with HEAD; Oxygen acceptance resolves PI markers. Neither saves automatically.
- Full DITA schema validation, external entity expansion, multi-file save transactions and multi-user collaboration remain outside this implementation.

## Model footnotes checks

- 91 unit/HTTP tests: indexing, model filtering without inferred support, unknown-model retention, exact source updates, inline markup/CDATA/encoding preservation, stale edits, reference protection, Author round trips and complete HTML/Markdown footnotes.
- 10 real-browser checks: the existing regression workflow plus model filtering, text and inline-XML editing, undo/redo, stale-dialog protection, Map scope retention on source navigation and HTML preview content.
- MQTT example inspected in desktop Chromium and a 390 × 844 viewport. Screenshot: `docs/assets/model-footnotes-preview.png`. Model filtering assists authoring only; it does not produce a model-filtered customer manual.

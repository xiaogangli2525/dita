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

## Model publication checks

- `npm test`: 97 passing unit/HTTP tests. New checks cover source-preserving filtering, retained unlabelled notes, removed excluded references, repeated `xref type="fn"` callouts, custom callouts, per-Topic identifiers, equivalent HTML/Markdown scope, rejected broken references and no requests for excluded-note images.
- `npm run test:browser`: 11 passing Chromium tests. The new workflow verifies model settings counts, HTML preview scope and links, Markdown download contents/name, unchanged editor buffers and rejection of a stale settings snapshot.
- The hosted MQTT demonstration was inspected with M100 selected: three included notes, two excluded notes and one unlabelled note retained.
- Publication filtering reads only each note's explicit `product`. Body content remains intact, inherited profiling conditions are not evaluated and no support is inferred from prose. Grouped product expressions, nested footnotes, cross-file footnote references and unresolved content-reference notes fail explicitly. Full DITA processing remains outside this implementation.

## Publication compatibility checks

- 105 unit/HTTP tests and 12 Chromium tests pass, including the three-model MQTT acceptance workflow and six actual HTML/Markdown downloads.
- GBK saves, unsaved dependency buffers, local conref chains, shared cross-file note identity, inherited Topic note conditions, resource-only Map roles, image rebasing, ordinary links and tables are covered.
- The representative fixture is not a company documentation repository. See [supported cases, test method and remaining boundaries](publication-compatibility.md).

## Workspace foundation regression

- 121 unit/HTTP checks and 22 Chromium checks pass. Existing source/Author conversion, review, undo, Map operations and publication cases remain covered after extracting rendering, diff and UI controllers.
- New browser workflows verify shared note scope/source editing and explicit dependency saves, project model validation/common confirmation, unsaved cross-inline text search, refresh recovery with disk-conflict refusal, relative resource insertion/upload, document create/save-as and UTF-8 XML downloads, cancellation during delayed image IO, snapshot/output hashes and source issue navigation.
- New real HTTP checks cover config conflicts/repair, GBK search offsets, image validation/create-only uploads, workspace/origin checks and symlink containment. Native preview QA also verified hosted layout, model preflight and content search.
- Architecture, API/module boundaries, browser storage limits and remaining DITA/company-document validation limits are documented in [architecture.md](architecture.md).

## PDF and Word delivery

- `npm test`: 122 passing unit/HTTP tests. `npm run test:browser`: 30 passing Chromium checks, with no skipped cases.
- Unit/HTTP regression adds binary Blob/ArrayBuffer/typed-array SHA-256 verification; the existing XML/text cases continue to pass.
- Real Chromium checks download PDF and DOCX for M100 and M300 from a Map with unsaved Topic content, shared references, images and long merged-cell tables. Checks verify PDF signatures/page counts, editable OOXML tables/merges/text, embedded PNGs, one definition for repeated notes, model filtering and hashes of downloaded bytes.
- Browser checks cover the actual PDF preview, restoration of HTML sandboxing, explicitly labelled static printing with no fabricated download record, workspace/origin rejection and blocked remote resources in the PDF renderer.
- Representative multi-page PDF and Word files are rendered and inspected page by page, including Chinese text, images, table continuation/header repetition, merged cells, end notes and page numbering. Word QA uses LibreOffice with installed CJK fonts; pagination in Microsoft Word can vary with fonts.

## Editor and HTTP/Git boundary refactor

- `npm test`: 126 passing checks. Added service-level cases verify independent Git instances, live root selection, committed baselines and dirty/invalid branch rejection. A real HTTP repository-switch case verifies file/Git roots move together, old workspace tokens are rejected and an invalid switch preserves the current root.
- Editor coordination checks verify Map child edits, background edits and review decisions share the correct document's undo history; pending Map refreshes are discarded when workspace change begins.
- `npm run test:browser`: 30 passing Chromium checks. Existing Source/Author input, read-only surfaces, Map editing, review/undo, saves, recovery, model publication and all four export formats remain covered.
- Existing server exports and the browser facade retain their interfaces. This refactor adds no runtime dependencies or DITA behavior changes.

## Author footnotes and writing experience

- `npm test`: 128 passing unit/HTTP checks. New cases exercise exact source/encoding/comment/code preservation, safe plain-text escaping, temporary-ID removal, explicit common scope, ancestor restrictions and invalid/ambiguous insertion rejection.
- `npm run test:browser`: 43 passing Chromium checks, with no skipped cases. Twelve new writing subcases cover caret and selected-text insertion, repeated text, nested inline content, merged CALS cells, Map child ownership, direct marker edit/Enter, cancellation/Esc, keyboard insertion, continuous writing, shared undo/redo, retained Map surfaces/scroll, stale-dialog refusal, pending-only filtering, common scope, repeated insertion, explicit GBK save, registry-free model suggestions/manual names and 390px layout.
- A real Chromium Enter split reproduced duplicate XML IDs; the fix keeps source IDs and removes only browser-created duplicates. Simulated composition key events verify application shortcuts do not interrupt input composition; this is not a native OS IME certification.
- Native preview QA verifies the HTTP preview environment as well as the new form and fixed panel controls. HTTP previews use `crypto.getRandomValues` because `randomUUID` requires a secure context. Publication regression still downloads and verifies all four delivery formats. No company document corpus or non-Chromium browser certification is implied.

## Author formatting, plaintext replacement and block insertion

- `npm test`: 128 passing unit/HTTP checks; existing XML, encoding, review, workspace/Git and publication cases remain green.
- `npm run test:browser`: 56 passing Chromium checks, no skips. Twelve new subcases verify mixed-inline selection formatting, partial removal with ID/product extent retained, keyboard and inline-code toggles, protected/empty selection refusal, immediate typing into inserted paragraphs/lists/tables/sections, rich headings, CALS preservation, body-only cross-inline/entity search, replacement escaping/one-step undo, explicit Map Topic scope, next-match progression when replacement contains the query, readonly search, stale rendered-source refusal, Source search, 390px containment and explicit GBK save.
- Native HTTP preview QA verifies visible formatting controls, current-Topic search scope and real highlights without leaving Author mode. The actual preview screenshot is included in README.
- Validation uses representative temporary Git repositories and the fictional MQTT demonstration, not the company documentation corpus. Single-block selection formatting, single-Topic search/replacement, protected reuse/revision content and best-effort undo caret positions remain explicit boundaries.

## Input grouping, shared note scope and precise resource insertion

- `npm test`: 133 passing checks. Five new store cases cover cursor-contiguous merging and endpoint metadata, pauses/movement/kind boundaries, composition sessions, cancelled composition and save/undo/command boundaries.
- `npm run test:browser`: 64 passing Chromium checks with no skipped cases. Eight added subcases verify whole-word undo and exact Source/Author caret restoration, simulated IME commit/cancellation, inline image placement and continued typing after redo, mixed-inline link wrapping and cancellation, Map note editing with the shared model picker, Map image target ownership, stale picker refusal, and repair of unknown names/inherited-common restrictions. Existing review, draft, encoding, XML, dependency-save and all four delivery-format workflows remain covered.
- Native preview QA verifies that applying a model-chip edit retains `main.ditamap`, moves the writing context to the affected child and can be undone without saving. The shared-picker screenshot is included in README.
- IME validation dispatches composition/input events in real Chromium; it is not certification against every physical Windows/macOS input method. Company documentation and multi-browser certification remain outside the available fixture coverage.

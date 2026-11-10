# Verification

The entries below record validation at each change milestone. Their test counts, fixture descriptions and then-current feature limits are historical; they are not cumulative or current limitations. Current acceptance includes the supplied HTTP manual, with the latest maintenance result recorded at the end. See `publication-compatibility.md` for supported publication boundaries.

## Real HTTP library: DITAVAL, author compatibility and PDF fonts

- Base: remote `f7db02e`, including the uploaded `contentmodule`. Acceptance used an isolated copy of the actual HTTP topics plus all reachable common content and images; the company library was not copied to the hosted demo. Six stale references in the two WebHelp Maps now point to the existing matching common/telecom files.
- Full suites: **175 unit/HTTP checks** and **156 Chromium checks**, zero failures/skips. Added cases cover DITAVAL defaults, value/group logic, excluded dependencies and note definitions, preserved origins, all-excluded refusal, workspace-only profile reads, captured/changed filter buffers, invalid-profile recovery, late selection responses, actual HTML/PDF/DOCX downloads and recorded profile/output hashes. A separate real Chromium job with an empty Fontconfig profile proves that Chinese PDF export fails visibly when fonts are missing.
- All **10 original Map entry points** load and export HTML with the selected existing DITAVAL. Every generated HTML has sequential note numbers, zero duplicate IDs and zero broken internal links. All **263 reachable DITA topics** render and roundtrip without XML changes, including 25 bodyless topics and both Logo declaration pages. All **86 root summaries** display their content, compared with normalized display whitespace.
- Complete Chinese `http_httpsusermanual.ditamap`: 25 topic files, 37 notes, 15 tables and 142 merged cells. `filters/filter_tbd.ditaval` excludes 32 element branches; the previously retained unique TBD statement is absent from output. Actual HTML, PDF and editable Word downloads succeed. The source working copy remains clean after edit/save/undo restoration. Markdown still refuses merged cells explicitly.
- The native Chinese PDF is **24 pages** with embedded Noto CJK glyphs. All pages were rendered for layout review, with enlarged title/table/end-note checks; Chinese text is legible and searchable. Word checks cover OOXML text/tables/merges/images and filtering; pagination in Microsoft Word is not certified by these checks.
- The corpus still uses prose for real model differences: 129 source footnotes have no explicit real-model associations. Filtering does not infer product applicability from that prose. Full DTD/schema validation, custom profiling specializations, flagging and DITA-OT equivalence remain outside this lightweight publisher.

## Consistent footnote presentation

- Full suites: **163 unit/HTTP checks** and **130 Chromium checks**, zero failures/skips. Five new domain cases cover first-use order, repeated/local/cross-file references, identical text/IDs in different files, conref occurrence/source identity, unused definitions, custom callouts and model-specific delivery numbering.
- Six new browser scenarios cover Map/body/list/dialog correspondence, filtered list labels, insertion/deletion and undo/redo across chapters, retained sibling DOM/history/caret, reference-source edits with exact GBK/CRLF XML and xref roundtrips, failed-reference labels, independent manual/Topic scopes, readonly numbers, late snapshot rejection, and directly opening a chapter before any Map tab exists.
- Existing HTML/Markdown/PDF/DOCX, remote Git, Save As, clipboard, formatting, tables, draft and responsive-shell regressions remain green. Hosted browser QA confirms body `[4]`, list `4`, and edit dialog `4` for the same fictional MQTT note. This does not certify an arbitrary DITA corpus or full DTD processing.

## Navigation layout and responsive polish

- Full suites: **158 unit/HTTP checks** and **123 Chromium checks**, zero failures/skips. Four added shell scenarios exercise actual pointer dragging, keyboard bounds/reset, persistence and viewport restoration, unavailable storage, long six-level titles and empty filters, short-window tree/search/workspace reachability, and mobile close/backdrop/focus cycling.
- Existing panel/history checks now verify the auxiliary panel overlays at 1101px while writing commands remain reachable. Source/Author/Map, remote library, protected Save As, drafts and all export-format regressions remain green.
- Browser-local hosted preview was inspected with default and adjusted navigation widths and the notes panel open. Responsive checks use the fictional MQTT fixture, not a real company manual or an assistive-technology certification.

## Document transitions and reference paths

- Full suites: **158 unit/HTTP checks** and **119 Chromium checks**, zero failures/skips. New domain cases verify shared load identity, preservation of newer buffers, closed/workspace invalidation and retry, byte-preserving URI rebasing, explicit self/Map/conref targets, encoded names, workspace escapes and unsupported `xml:base`.
- Browser cases use real temporary Git libraries and delayed HTTP responses. They verify duplicate opens, late navigation, shared Map/tab loading, Save As target edits before overwrite and during acknowledgement, retained undo/redo and a subsequent save, duplicate submission prevention, later navigation, selection reset and stale Map operations, nested Map paths, GBK/CRLF image/link/conref relocation through save/reopen, immediate Map-copy registration, and recovery after an externally removed source file.
- The frontend never treats a successful old write as permission to replace a newer buffer. Supported relocation updates local references; it does not implement arbitrary XML-base rewriting or a full DITA migration engine. Existing workspace/origin guards and four-format publication checks remain active.

## Contextual content settings

- Full suites: **151 unit/HTTP checks** and **106 Chromium checks**, zero failures/skips. Four new browser scenarios cover collapsed advanced fields and compatible sequential edits/undo, contextual table controls and deleting only an image inside a cell, changing note type without losing child markup and delegating footnotes, plus narrow-screen fit and readonly mode.
- Existing image/link dialogs, precise Map edits and filesystem save, stale edit rejection, table history, drafting, remote Git and HTML/MD/PDF/DOCX regressions remain covered. Legacy advanced-attribute regression tests now explicitly expand the advanced disclosure.
- Settings for text within rich links and notes target their owning link/note; nested tables retain their table controls. Raw XML capabilities remain advanced and do not add complete DTD validation.

## Basic authoring improvements

- Full suites: **151 unit/HTTP checks** and **102 Chromium checks**, no failures or skipped cases. Existing HTML/Markdown/PDF/DOCX, Source/Author/Map, IME history, draft, remote Git and workspace regressions remain covered.
- New real-browser cases exercise title Enter through filesystem save and mode changes; paragraph splits with inherited conditions, mixed inline content and unique IDs; code newlines/indentation; empty-list exit and list hierarchy; attribute-aware merging and protected-content deletion; atomic cross-paragraph paste/typing; configurable tables, Tab navigation and undoable last-cell row insertion; paragraph/list/note/code conversions; image/xref editing with preserved children/anchors; stale dialogs, narrow screens, failed-projection recovery and Map isolation through saving/reopening.
- Image delivery checks verify standard child `alt` text in HTML/Markdown, legacy alt compatibility, authored HTML dimensions and rejection of invalid dimension styles.
- Cross-paragraph replacement is limited to compatible sibling paragraphs, and complex CALS tables remain protected from structural changes. Validation uses temporary fictional manuals, not a real company corpus, full DTD validation or physical IME/multi-browser certification.

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


## Audit follow-up: reliable commands, clipboard and business writing

- `npm test`: **136 passing unit/HTTP checks**. Three added cases validate all ten templates, title escaping, valid generated identities, rejected unknown kinds, and regular table header/body structures.
- `npm run test:browser`: **75 passing Chromium checks**, zero failures/skips. Added actual-browser cases cover Map attribute edit/undo/redo/filesystem save; cell XML attributes; stale and invalid commands; deleting the entire selected table; CALS named columns/row IDs/header/width operations; disabled merged-table commands and rendered spans; real OS-facing browser clipboard rich HTML/plain text; script/attribute cleanup; complex-table text fallback; retained applicability; protected/cross-block selection refusal; continued typing after redo; Map search/note navigation and return bookmark; template creation, path validation, existing-file refusal and 390px containment.
- Existing Git/workspace switching, source encoding/GBK saves, draft recovery, review and all four delivery formats pass in the complete browser run. HTML/MD and actual PDF/DOCX downloads, output byte hashes and model filtering remain exercised.
- A synthetic 400-paragraph Topic renders and survives twelve sequential edits with all paragraph identities retained. In the complete concurrent browser run, rendering took about 54 ms and median conversion about 146 ms on this executor. This is a diagnostic fixture measurement, not a product performance guarantee; whole-Topic conversion is still a known limit. No real company corpus or physical IME/multi-browser certification is claimed.


## Explicit application composition and document contracts

- `npm test`: **143 passing unit/HTTP checks**. Added boundary cases verify history-free immutable snapshots with distinct disk/Git bases; declared-only feature contexts and the explicit writable busy flag; lazy service resolution; startup-plan validation before feature construction; independent application results and live compatibility getters; missing factory diagnostics; side-effect-free delivery script loading; and domain independence from application/UI controllers.
- `npm run test:browser`: **82 passing Chromium checks**, zero failures/skips. The complete Source/Author/Map, notes, clipboard, table, draft, Git/workspace, shell/resizing and HTML/MD/PDF/DOCX suite passes through the actual new composition root. Export-flow unit tests construct the delivery controller explicitly and inject image IO.
- JSDoc contracts are interface documentation for editors/review, not a claim of whole-project static type checking. Browser global factory namespaces and the DitaApp integration facade remain compatibility boundaries. At this architecture milestone only fictional/temporary fixtures were available. Later HTTP-manual acceptance is recorded separately below.

## Remote Git document libraries

- Full local suites: **150 unit/HTTP checks** and **88 Chromium checks**, no failures or skipped cases. Existing editing, draft, review and four-format delivery regressions remain covered.
- New tests use real Git repositories and a local bare origin behind an injected test-only transport, with the same validated HTTPS fixture URL. They verify branch discovery/selection, clone collision/symlink refusal, failed-clone cleanup, check-without-document-mutation, fast-forward/no-op updates, dirty/untracked/ignored-file preservation, remote movement after checking, local-ahead/divergent histories, input validation/redaction, API origin/token protection and token rotation.
- Browser cases run the actual app from a missing initial document directory through clone, Map selection, update inspection, unsaved-buffer protection and reloaded Map content. They also cover disk changes, invalid paths, capability-disabled static previews and 390px dialog containment. The production HTTP API exposes no local-file transport option.
- HTTPS/SSH private-provider authentication and company-specific credentials were not available for a live provider test. Existing machine-side Git credentials/SSH configuration are required; these tests do not claim provider SSO/LFS/submodule coverage or Windows runtime certification.


## Contextual authoring and note details

- Domain coverage checks repeated xref use counts without definition inflation, block reuse and one source reused under distinct model conditions.
- Chromium coverage exercises nearby formatting with exact undo, caret insertion/cancellation of footnotes/links/tables, keyboard focus and Escape restoration, IME and protected selection dismissal, single-click note previews, shared source navigation and return, live inherited model intersections, and 390px viewport bounds.
- Shared-source usage counts cover the currently captured functional manual; other manuals/repositories are not scanned. Applicability feedback describes the existing note filtering rules and does not add full DITA profiling support.

本轮完整回归：164 项单元／HTTP 检查和 137 项 Chromium 检查全部通过，包含旧有四种格式交付、远程 Git、编码和保存／草稿流程。


## Keyboard-only contextual tools and help

Browser coverage verifies that clicking, selecting and arrow movement do not open contextual tools; Alt+Z opens/toggles them and Escape restores selection. The Help menu opens a visible shortcut dialog, traps focus, closes with Escape/button, preserves the underlying notes panel and fits a 390px viewport. Document shortcuts do not run behind modal help.

Final regression for the keyboard/help change: 164 unit/HTTP checks and 139 Chromium checks passed, with no skips.


## Contextual actions and existing public note insertion

- Domain checks cover public definition eligibility/identity, escaped relative references, duplicate ID rejection and model delivery with differently scoped calls to one public source.
- Browser checks cover paragraph and list/note/code conversion, table row/column/header commands and merged-table refusal, partial mixed-format clearing with protected content, link editing/unlink, resource-only unused note discovery, insertion without changing source, filtering/cancellation and stale public buffers, exact undo and compact keyboard layouts.
- Public-note discovery is scoped to the current manual/dependencies and explicit resource-only entries; arbitrary repositories and full DTD processing are not included.

Full regression: 167 unit/HTTP checks and 146 Chromium checks passed. An additional focused check verifies format clearing inside a link retains that link and its model condition.


### Technical-manual presentation

`document-rendering.test.js` covers five preformatted block types, nested command/variable markup, CRLF and exact XML roundtrips, all 13 standard note types, custom labels, CALS 3:7 column proportions and HTML/Markdown response formatting. The profiling browser regression switches every note type through the inspector, edits a custom title, undoes to the exact original XML and checks readable selected-code contrast. Office delivery regressions exercise real PDF and DOCX bytes.

Visual acceptance uses the Chinese HTTP manual in an isolated local preview: command/response tables, summaries and multiline responses. Reference screenshots inform the independently implemented styles; vendor bundles are not shipped.


## Independent model-specific footnote rules

- Full regression: **200 unit/HTTP checks** and **166 Chromium checks** pass, with no skipped cases. Existing HTML/Markdown/PDF/DOCX delivery, source encoding, editing, drafts, remote workspaces and recovery remain covered.
- Six new domain cases verify balanced rich-fragment projection, common content, unchanged GBK declaration/CRLF source buffers, repeated references/renumbering, public conref origins, stale note/context/product conditions, source isolation and exact model-token suggestions. All **37 notes in the uploaded HTTP corpus** retain their text/markup when all fragments are kept. This does not automatically confirm their applicability.
- HTTP coverage exercises independent config writes, unchanged original document bytes, optimistic conflicts, simultaneous same-base saves, invalid paths and malformed-config preservation.
- Actual-browser coverage requires review before save, checks per-model HTML/Markdown downloads and rule hashes, keeps unresolved notes, rejects external rule changes before download/save, preserves choices after conflicts, requires fresh confirmation for another manual and blocks rules after unsaved source changes. Follow-up checks verify 390px containment and reachable save controls; wide/compact screenshots were visually inspected.
- Fragment classification is explicit human review. Inline markup and revision spans are atomic; no prose rewriting or automatic removal of shared model labels is claimed. Rules remain a sidecar and original DITA is unchanged.


## Imported-content and local API audit

Full local regression: **204 unit/HTTP checks** and **170 Chromium checks**, zero failures/skips. Follow-up HTTP checks confirm that an explicitly configured reverse-proxy Host still works.

New domain/browser cases verify that imported event handlers, CSS, image src/srcset overrides and editor-reserved attributes do not become active Author HTML. Dispatching click/hover/error events executes no source handlers and causes no source-specified remote resource requests. Unchanged views and adjacent text edits retain the original XML, including those source-only attributes. Markdown href/src and code-language delimiter probes create neither executable links nor event-handler attributes; code remains literal.

HTTP probes reject foreign Host values on workspace bootstrap, source reads and asset reads even when Origin is omitted; loopback and configured proxy access remain available. This is a targeted local-interface check, not a claim of multi-user authentication.

The HTTP note-corpus test now loads the selected manual's dependency closure (37 notes) with encoding-aware reads, rather than recursively counting unrelated manuals (130 notes in the full checkout). Both Node 20/22 and browser CI passed for that correction before PR #24 was merged.


## Model-text delivery and exported note presentation

Full regression: **210 unit/HTTP checks** and **181 Chromium checks**, zero failures/skips. Additional focused checks cover a condition filter removing an entire model label, which must require review rather than treating the remaining description as common.

Domain tests cover exact identifiers and variants, continuation sentences, shared-label compaction with inline XML retained, nested textual scopes, common content, explicit only/unsupported clauses, ambiguous prose, paired/unpaired Oxygen insertions, original-buffer preservation, repeated public calls and HTML/Markdown numbering. All 37 source notes in the real HTTP closure are checked for five target models; 29 have explicit textual scopes before whole-note model/profile exclusions.

The actual browser downloads the real HTTP manual for ML307G, ML307N and MN319-A with the pending-content condition profile. The retained endnote labels contain only the requested model, common explanations remain, semantic numbers and return links agree, and every input file remains byte-identical. Actual HTML output verifies one frame per DITA note with no regex-generated icon or nested duplicate; the SSL explanation and endnote list were visually inspected.

Browser workflows also check Chinese summaries of real filter rules, refusal of unchecked mixed-model text delivery, HTML/MD/PDF/DOCX sharing the selected prefix policy, invalidation of checked output when the policy changes, all-model preservation, and navigation from ambiguous text to independent-rule review. Existing DITAVAL race, editing, save/draft, Git and export regression remains covered.

Prefix interpretation is explicitly enabled and requires preview review. It follows the displayed source-format convention; it does not infer arbitrary technical applicability, rewrite body prose, automatically confirm sidecar rules or change original DITA.


## Workspace composition and UI reliability

Full local regression: **216 unit/HTTP checks** and **191 Chromium checks**, zero failures/skips. The browser suite includes the actual HTTP-manual delivery regression, original-byte preservation, model/profile note filtering and HTML/Markdown/PDF/DOCX workflows. A focused workspace/UI, foundation and document-transition run passed all 34 checks.

New domain checks cover per-instance workspace state, overlapping-switch refusal, active-save/dirty-buffer guards, failed-switch recovery, branch-named default Maps, changed-identity refresh rejection and delayed source navigation. Module-load tests verify that all six new factories register without accessing DOM or the application facade during load.

New browser checks cover menu roles, disabled actions, keyboard/focus behavior and Escape without closing an auxiliary panel; document/navigation tab keys; source-aligned outlines excluding metadata titles and updating through edit/undo; pending-switch interaction locks and retained buffers after failure; partial rule choices across rows and close confirmation; delayed writes freezing fields and delayed reads cancelling without reopening; visible delivery actions and bounded menus at 390 × 520; and handled failed document opens. The compact delivery screenshot was visually inspected.

The entry point now assembles explicit services and view/action ports. Existing editor/history, publication and save services remain responsible for their established workflows; this refactor does not replace them or add AI/multi-user services. Original DITA is unchanged. Browser checks use Chromium and do not certify physical IME, assistive technology or every manual specialization.


## Maintenance cleanup and project-model settings

Full local regression: **216 unit/HTTP checks** and **194 Chromium checks**, zero failures/skips. `npm run lint` passes with zero warnings; a stdin probe containing both an unused variable and an undefined capability fails with the expected two errors. GitHub Actions now runs lint before unit tests on Node 20 and 22. Existing real HTTP-manual delivery, byte preservation, model/profile note filtering, editing/save/draft/Git and HTML/MD/PDF/DOCX workflows remain green.

Three additional browser scenarios verify cancellable project-setting reads with no late dialog reopen; locked fields/close and deduplicated submits during a delayed write, with form retention after failure; and an actual branch switch followed by a configuration-read failure, which must clear the previous model list/comparison base, disable saving and recover on reopening after the API succeeds. These checks exercise the visible controls and actual temporary Git repository.

Cleanup removes an obsolete source-find closer, unused bindings/ports and redundant default assignments, reuses the existing XML parse during Author refresh, and retains original error causes when adding publication source paths. Intentional path-control filters remain unchanged in behavior and have local lint explanations. `.editorconfig` sets basic code conventions without changing manual encoding; original DITA and vendor source are unchanged. Architecture/compatibility descriptions now distinguish current HTTP acceptance from historical MQTT fixture milestones. No new AI service or broader DITA capability is implied.


## Manual domain boundary and stable capture context

Full local regression: **231 unit/HTTP checks** and **201 Chromium checks**, zero failures/skips. Lint passes with zero warnings. The actual HTTP manual, three model deliveries and HTML/Markdown/PDF/DOCX workflows remain covered. The first local browser run stopped PDF output because this resumed environment lacked CJK fonts; after restoring actual Han-character coverage, the full browser suite passed.

`manual-domain.js` runs in a clean Node process without editor/rendering/workspace modules. New cases exercise the shared chapter traversal, resource-only exclusion and duplicate suppression, source-linked notes, real HTTP data-only snapshots for three models, and unchanged inputs. Existing service consumers retain their interfaces while the composition manifest removes the renderer dependency.

Capture regressions change project content/values/errors, repository and branch during an outstanding Map read; every result is rejected. A baseline/current probe confirms that the previous service accepted the new model config into the old capture, while the new service rejects it. Captured model values and file records are copied/frozen; collection compatibility remains explicit. Boundary lint probes reject six ambient/adapter dependencies and allow a shared-domain import.


## Author/source and delivery rendering boundaries

Full local regression: **239 unit/HTTP checks** and **203 Chromium checks**, zero failures/skips; lint passes with zero warnings. The public `DitaVisualCore` API remains unchanged. A baseline comparison produces byte-identical ordinary HTML/Markdown for three scopes (six outputs), plus identical Markdown preview/highlighting projections.

`app-core.js` is now an explicit compatibility facade. XML DOM/source-tree adaptation, Author projection, surface-to-source writes and Oxygen processing live in acyclic modules. Author projection takes an owner document; the facade preserves document defaults. Markdown preview and full HTML layout load independently of DITA conversion. Six negative lint probes verify that the rendering layers cannot import upper/cyclic modules or access the application/ambient document; CommonJS clean-process coverage verifies loading without editor/workspace services or DOM globals.

The browser directly runs the extracted Author modules against all 25 Topics in the actual HTTP closure: unchanged views round-trip exactly, two sequential title edits patch the expected source, and live buffers remain untouched. An additional case covers CRLF, a DTD, UTF-16 offsets, CDATA, entities, processing instructions and quoted angle brackets.

These checks exposed two existing content issues: ordinary CDATA text could disappear from Author/HTML/Markdown, and annotated title edits could move PI markers behind the edited text. Regression probes first failed, then passed after inert CDATA text handling and minimal annotated-text patching. Source writes reuse the canonical validator's ranges instead of a second XML lexer. Edits crossing annotations or ambiguous annotation/whitespace/CDATA combinations are refused with a Source-editing message. The unchanged-output comparison above excludes these deliberate fixes.

## Protected workspace mutations and checked data boundaries

- Base: `master@ebaf4ce`. Workspace identity/directory/Map metadata, document membership, active selection, mode and history target now change through `workspace-session` operations. Nested descriptors and live collection views reject direct controller writes. Transient review and DOM selection state remains UI-owned.
- Document registration retains existing buffer/history identity; closing a child undo target selects the active document. Directory refresh preserves a dirty Map's last valid projection. Invalid adoption is rejected before token replacement or lifecycle invalidation. Normal saves and Save As share validated acknowledgements; copied/frozen requests cannot be altered while queued, and wrong-path/malformed responses leave disk and working values intact.
- `npm run typecheck` passes with strict, no-emit TypeScript on actual document/proposal/save, snapshot capture and delivery-record implementations. Negative fixtures reject snapshot writes, invalid proposal states, missing save comparison content, invalid acknowledgement content and unsupported delivery output/format fields. CI runs type checking before unit tests on Node 20/22.
- Full local validation: **247 unit/HTTP tests**, **203 Chromium tests**, lint with zero warnings and the type check all pass. Browser validation includes independent-rule save/refresh, scoped saves, Save As, undo, branch switching, remote capabilities, responsive navigation and real HTTP manual HTML/Markdown/PDF/Word delivery. Capability and directory test fixtures now use explicit session operations instead of changing protected state directly.
- The original DITA, models, filters and contentmodule sources are unchanged. Snapshots expose detached, read-only iterable collections; rule acknowledgement creates a replacement snapshot. This is incremental boundary checking, not a whole-project TypeScript migration or a new browser build requirement.


## Switchable workbench appearance

- Base: `master@8796c50`. Four restrained palettes (forest, blue, warm paper, dark) and an automatic system mode share semantic shell/document/status tokens. The rail and View menu open one native radio-card dialog; its completion action remains visible while a narrow dialog scrolls. Theme application runs before styles to restore a saved dark preference before first paint.
- Full local validation: **250 unit/HTTP checks**, **210 Chromium checks**, lint with zero warnings and strict boundary type checking pass. New scenarios cover live OS preference changes, browser storage denial, invalid stored IDs, keyboard selection, reload persistence, unchanged unsaved source/undo/source selection/scroll, guarded Author caret restoration and representative foreground/background contrast of at least 4.5:1 in every preset.
- Actual HTTP/HTTPS Author pages were inspected in all four palettes, including command tables, response code and the footnote side panel, plus the chooser at desktop and 390px width. Colors use semantic variables; authored markup/images are not inverted or rewritten. The original manual sources are unchanged.
- An identical captured manual exported through the light and dark interfaces produces exactly the same HTML bytes. Delivery CSS remains independent; UI preferences never enter DITA, project configuration or release output styling.


## Skin detail pass

- Base: `master@d4d50ab`. A rendered-component audit found muted labels that passed on white but fell below 4.5:1 on mode/workspace/chapter surfaces, a dark native placeholder at 3.23:1, and the dark current-search highlight at 4.02:1. Palette adjustments now cover these actual background combinations and explicit placeholder opacity/color.
- Menu/tool hover states use the active preset; outlined controls have a visible hover border; disabled primary actions retain their normal palette. Property, Map-title and review focus indicators use the shared focus ring. Thin, themed scrollbars and restrained link underlines refine long writing/reading surfaces. The chooser shows the resolved style, including automatic system changes, through its existing service.
- Validation: **250 unit/HTTP checks**, **212 Chromium checks**, zero-warning lint and boundary type checking pass. Added real-component contrast and enabled/disabled hover/property-focus checks, plus live system-badge assertions; expanded selected/hovered/search color-pair checks. The caret assertion waits for the actual restored range after native dialog close rather than only observing focus return.
- Visual inspection used the real HTTP manual, including command tables, response blocks and footnotes, plus desktop/390px appearance dialogs. Existing source preservation and light/dark delivery-byte equivalence remain covered; no original manual content changes.


## AI writing first version

- Base: `master@bd80cf3`. Selection editing and pasted-issue lookup use a shared source-range core, explicit candidate selection and immutable request bases. Server-configured compatible models return bounded text patches; both sides validate them before proposal review and shared undo. No automatic filesystem/Git write is introduced.
- Connection settings are editable in the local UI and kept only in server memory, with environment defaults for persistent startup configuration. Keys are never returned to or stored by the browser; blank keys cannot follow a changed endpoint. Demo mode cannot use model credentials. Generation is cancellable and bounded; upstream messages/redirects/truncated output are refused. Long model requests do not block normal saving, and workspace tokens are checked after completion.
- Full local validation: **263 unit/HTTP tests**, **223 Chromium tests**, lint with zero warnings and strict boundary/provider type checks pass. New tests cover source/visual selections, manual candidates, accept/undo/redo, pending questions, hostile/invalid output, cancellation, stale buffers/workspaces, nonblocking saves, secret handling and desktop/390px layouts across all skins.
- The full suite exposed a queued native-dialog close race during appearance reopening. Close/cancel now restore writing state synchronously and ignore an older close event if a new dialog is open. The AI dialog uses the same lifecycle guard. The appearance and AI focused suite and final full browser run pass.
- Real HTTP/HTTPS corpus lookup processed 25 Topic/XML files without parse failures in a local sample (206 candidates, about 59 ms; an observation, not a performance guarantee). The actual SSL note was previewed in an isolated copied workspace with a clearly labeled local simulated model. No manual source changed.
- Real provider credentials/model were not supplied. All automated generation uses a local simulated compatible endpoint; real model output quality and provider compatibility remain to be accepted with the configured model. The SDK knowledge-base plan is recorded separately and remains deferred.


## Conversational writing follow-up

- Base: AI PR head `06ea615`. The original form sent only the latest instruction and required every question to be resolved before any edit. The new checked conversation boundary retains all user requirements and the previous cumulative proposal against one captured source. Clearly supported edits can coexist with missing technical facts; unsupported structural requests have an explicit limitation field.
- A fixed reply composer supports followup and Ctrl/Cmd+Enter. Closing/reopening the same unchanged target retains the task, pending reply and proposal. During generation the user can draft the next message; completion does not clear newly typed content. Failed/cancelled rounds preserve the previous proposal. Applying rebases to the updated source and retains prior requirements/pending questions.
- The Apply action is a single explicit button; exact user phrases such as “应用这版” / “按这个改” invoke the same guarded proposal operation without another model call. Negated/ambiguous phrases cannot trigger that operation, and a missing proposal produces a direct explanation. Source save remains explicit and undo is shared.
- Model configuration moved to its own dialog. The private per-user connection store survives service recreation, uses atomic replacement and restricted POSIX permissions, excludes credentials from responses and never loads them in demo mode. Failed persistence keeps the existing live connection.
- Every model request now includes the repository-owned `ai-writing-rules.md`, separate from protocol formatting and the workspace automation playbook. The rules ask the model to execute clear requests and use already supplied facts.
- Validation: **270 unit/HTTP tests**, **233 Chromium tests**, zero-warning lint and strict boundary/provider/conversation type checks pass. The browser suite covers clarification-to-edit, cumulative refinement, partial work, applying/rebasing, conversational apply, negated apply text, cancellation, retained drafts, reopening and document changes. Store tests cover restart persistence, secret omission, corruption, demo isolation and save failures.
- Real HTTP SSL content was inspected in a temporary copied workspace using a clearly labeled local mock model, at desktop and 390px widths, including the separate connection dialog. Source bytes remain unchanged. Screenshots are local QA only and excluded from publication. Real-model quality remains unverified without a configured approved endpoint.


## Chat-first entry and technical review

- Base: AI PR head `d723dd0`. Opening the assistant now exposes a ready composer and optional scope controls. Current selections are reused; otherwise a bounded document scope automatically gathers editable paragraphs with inherited block/inline conditions. Ambiguous manual matches use an inline chapter choice and continue the same request.
- A user can discuss a plan, correct it and explicitly execute it in chat. A displayed proposal uses the existing guarded apply action. Approving a plan may generate/apply ordinary text changes, while newly generated numeric/unit/command/model/constraint changes show concrete differences before applying. Exact/negated apply command handling remains covered.
- Every changed fragment includes its source line and conditions. Heuristic technical-change flags guide review; they are not proof of technical correctness or complete semantic consistency checking. Rule v2 asks for consistent parameter explanations/examples only when the relationship and evidence are clear. No model confidence percentage is treated as validation.
- Validation: **274 unit/HTTP tests**, **236 Chromium tests**, zero-warning lint and strict type checks pass. Added coverage for automatically scoped multi-paragraph patches, bounded/partial context, reused-content exclusion, inline model conditions, source-preserving edits, chat-to-plan-to-apply, optional manual scope and technical review notices. Desktop/mobile UI was inspected using an isolated real HTTP manual copy and a clearly labeled local mock endpoint; no source document was changed. Screenshots remain local QA.
- Real-model factual accuracy still requires approved endpoint evaluation against real reported issues and development-approved expected revisions. The existing HTTP corpus is real source material; it alone does not establish whether an arbitrary model's proposed technical correction is correct.

## Recovery, manual child views and scan finding identity

- Base: `master@963d376`. Regression checks first reproduced a lost recovery draft after closing a clean reopened Topic, stale Map child content after applying AI edits in reading/review modes, and two distinct technical findings collapsing into one when they cited the same paragraphs.
- Closing a clean buffer now preserves its prior-page draft. A separate confirmed dirty-discard event removes only the explicitly discarded document's backup; close still cancels pending writes. Browser coverage verifies byte-for-byte backup preservation through reload/close/reopen and successful recovery, plus confirmed discard without delayed backup resurrection. Navigation coverage checks cancellation and clean/dirty lifecycle behavior.
- Child edits, undo and redo share the editor's mode-aware refresh. The changed Topic renders in place in Author, reading and review modes; other Topics retain their DOM, reading/review remain read-only, and the review dock and inline deletion/insertion marks follow the current buffer. Redundant review-triggered whole-Map rebuilds were removed. The AI UI tests use a local simulated compatible provider and assert that source files remain unsaved on disk.
- Scan finding identity includes category, problem summary and sorted exact evidence ID/quote pairs. Distinct problems/quotes survive; reordered evidence and revised advice update the same finding on retry. Cached results are revalidated with the same rule. An older report cannot recover suggestions already dropped by the previous rule; rescan to regenerate them.
- Validation: **299 unit/API tests**, **252 Chromium tests**, zero-warning lint, strict boundary type checks and `git diff --check` passed. The full browser run includes Topic/Map review parity, stale review controls, Oxygen revisions, recovery, shared history, model delivery and document rendering.

## Clean-save recovery and changed scan snapshots

- Base: `master@ed71f37`. A second recovery regression reproduced loss of an older draft when a freshly reopened, unchanged disk version was saved. Clean notifications now compare the stored content with the acknowledged content or the exact backup written for the live file instance. The controller keeps this ownership private in a WeakMap. Unit coverage checks successful recovery/save cleanup, undo cleanup, replacement backups written elsewhere and malformed data preservation. The browser check waits for the actual save acknowledgement before checking backup bytes and recovering/undoing them.
- A held scan response reproduced an apparently complete, empty report after the user edited the source during scanning. Reports now show when their progress belongs to an older snapshot and offer **更新扫描结果**. That action recaptures current source/configuration and uses the existing validated progress store; matching completed batches remain reusable. Unchanged evidence can still be reviewed before updating the report. A two-batch manual check edits only the second batch's source and verifies exactly one additional request rather than repeating the first batch.
- Validation: **300 unit/API tests**, **254 Chromium tests**, zero-warning lint, strict boundary type checks and `git diff --check` passed. Focused UI checks inspected the new warning and action in forest/dark palettes and at 390px width without horizontal overflow. Model request/response tests use a local compatible simulator; AI edits remain unsaved on disk and real-model factual accuracy is outside these software checks.

## Real HTTP acceptance preparation and writing JSON wrappers

- Base: `master@207cefa`. No saved model connection or AI endpoint/model/key environment configuration is present in this executor. A live CLI attempt returns an explicit blocked result, exit code `2` and zero requests. **Real-model acceptance remains unrun**; local simulator passes are not model accuracy results.
- Added 13 source-backed acceptance cases for exact text changes, inline commands, model footnotes, numeric ranges, cumulative conversation, missing confirmed facts, structural limitations, Oxygen protection, intentional model exceptions and a same-condition conflict injected only in memory. The default command validates all 13 cases without contacting a model. Configured live runs use the existing private connection store/provider and emit inspectable proposal/evidence reports without credentials. The tool cannot write manual files; paths and ambiguous/missing anchors are checked before generation.
- A real HTTPS note reproduced rejection of complete fenced revision JSON while scanning already accepted it. Writing and scanning now share the existing bounded wrapper parsing. Finish-reason, refusal, source-ID/range, exact-original, XML and response-size guards remain. Negative tests retain rejection of truncation, unclosed fences, prose/multiple JSON objects and stale source text.
- The actual browser opens a disposable copy of the real HTTPS Topic, selects the SSL note with inline AT commands, receives a fenced response from a local compatible simulator, applies the one-word change, displays the exact deleted/inserted characters, accepts review and saves explicitly. Both source-preservation assertions compare complete XML, and the supplied source manual remains unchanged.
- Local read-only corpus inspection found 25 reachable Topic/XML documents, all with eligible editing context; 10 correctly use bounded/partial context. The scan planner produces 27 batches for this closure. These are source/coverage observations with zero model calls, not proof of full-context editing or technical correctness.
- CI also exposed a pre-existing note-rule dialog race: a queued native close event could arrive after reopening and invalidate the new capture, leaving the form empty. The close listener now ignores events while the dialog is open. A fixed-order regression dispatches that delayed event during a new capture; it fails before the guard and passes afterward, including the subsequent different-manual case.
- The same queued-close pattern also affected delivery cancellation and project-form loading. Both now ignore a stale close event after reopen; late shortcut-help close events likewise leave the reopened dialog's focus alone. Fixed-order delivery/project regressions fail before the guards and pass afterward. The affected four browser suites pass all 46 checks, including actual HTTP model export, note-rule return-to-delivery and project save/cancel behavior.
- Validation: **307 unit/API tests**, **258 Chromium tests**, zero-warning lint, strict boundary type checks, fixture preflight and `git diff --check` passed. Acceptance-tool regressions cover simulator transport, cumulative requirements, semantic failures, early termination after repeated request failures, credential omission, unchanged source bytes and missing-connection CLI behavior.

## Scoped AI task recovery and template boundary

- Base: `master@5af9ec2`. AI writing now checkpoints the local task by repository, branch and opened Topic/Map. Reload restores validated conversation, unsent input and a pending proposal without sending requests or writing documents. Manual recovery compares all referenced sources and model/rule configuration, while changed or unreadable sources preserve a read-only prior proposal. Scan-derived tasks require reselecting evidence. Applied/saved edits restore their dialogue without resurrecting an already applied proposal.
- Six unit checks cover whitelisted serialization without credentials, key isolation, invalid patch/corrupt backup preservation, storage-denied/quota fallback, malformed payloads and manual snapshot fingerprints. Seven browser regressions exercise reload with a proposal, unsent draft, applied/save state, changed disk source, interrupted request, Map child scope and a changed related Topic. The existing immediate close/reopen conversation case also passes. Recovery UI was visually checked in forest/dark themes and at 390px width.
- README shortcuts now match Alt+Z. Writing and architecture docs describe task recovery, source checks, local storage and New Task behavior. The enterprise template plan specifies replaceable versioned packages, explicit delivery fields, per-format adapters and frozen snapshot identity; it is a design contract, not a claim that branded PDF/Word export is already implemented. No uploaded reference document or brand assets were added to the repository.
- Validation: **313 unit/API tests**, **265 Chromium tests**, zero-warning lint, strict boundary type checks and `git diff --check` passed. Browser AI requests use a local compatible simulator; real-model accuracy remains for the user's configured-model acceptance.

## Replaceable enterprise PDF templates

- Base: `master@d7ad30a`. PDF delivery now accepts a detached, validated template/metadata capture. Two neutral built-in layouts and local versioned template packages support A4/Letter, optional cover, logo/background, header/footer fields, page numbering and faint text/image watermarks. The UI creates/copies/imports packages, uploads bounded PNG/JPEG assets and shares the exact selected version as self-contained JSON. Word/HTML/Markdown retain their own content pipelines; branded Word is not claimed.
- Seven unit checks cover capture isolation, closed configuration fields/capabilities, decoded image byte/dimension bounds, escaped HTML/CSS fields, repeatable package installation, concurrent same-version conflicts, damaged-file preservation and process-local demo storage. Seven browser subtests plus their parent verify actual PDF/download hashes, captured metadata, check invalidation, Letter/cover/watermark switches, PNG logo/watermark and JPEG cover uploads, custom header/footer slots, package round trips, persisted preferences, API guards, missing versions, dark/narrow controls and separate Word behavior. Office and template suites pass all 16 focused checks after the final renderer/validation changes.
- Read-only real-HTTP validation exported `ML307G` to a 49-page A4 enterprise PDF: 25 included footnotes, 12 excluded, no unsaved buffers, and all copied source/library asset hashes unchanged. Cover, contents, body, long-table continuation, footnotes and final pages were rendered/inspected. Diagonal SVG text initially polluted body copying; only generated watermark backgrounds are now rasterized, and extracted body text remains clean/searchable. Neutral test covers, uploaded image backgrounds and dark 390px dialogs were also visually checked. No uploaded reference PDF, extracted brand assets or generated QA documents were added to the source repository.
- Validation: **320 unit/API tests**, **273 Chromium tests**, zero-warning lint, strict boundary type checks, executable documented-template example and `git diff --check` passed. Core and renderer imports are constrained by lint; delivery-record metadata has a negative type-boundary fixture.

## Watermark identity, page spacing and cover refinement

- Base: `master@00bf0a7`. New 1.1.0 built-ins use `manual-v2`: a quieter cover with original logo, grouped metadata and independent cover ink; sheet-relative, aspect-preserving artwork watermarks; and footer rules/spacing with consistent physical edge clearance. The original `manual-v1` normalized package hashes and renderer output remain pinned in regression fixtures. Legacy imports preserve their original package until an explicit upgrade creates a new version.
- Watermark selection now distinguishes dedicated artwork, corporate logo and explicit text. Automatic selection never substitutes company text for missing artwork. Preview shows the selected source and position; full-sheet images preserve their own layout. Existing faded/transparent artwork can retain its original alpha at 100% package opacity. Uploaded reference material was used only for local comparison and separately delivered sample artifacts; its extracted assets are absent from the code repository.
- Actual PDF review exposed a second cause of the mismatch: Chromium anchors page backgrounds at the content edge. The new renderer compensates both page margins, preventing horizontal/vertical drift and right-edge clipping. A Poppler regression measures a distinct image's physical center, size and ratio on actual A4/Letter output with asymmetric margins, and checks footer text clearance. CI installs this test-only utility; export itself gains no new runtime dependency.
- The real HTTP copy exports 50 A4 pages for `ML307G`, with 25 included footnotes, 12 excluded, zero unsaved buffers and unchanged source hashes. The provided original watermark, cover, contents, long tables and final footer positions were visually checked; repeated footer baselines match across sampled body pages. Final PDF/template examples are separate artifacts rather than repository fixtures.
- Validation: **322 unit/API tests**, **275 Chromium tests**, zero-warning lint, strict boundary type checks, documented JSON normalization and `git diff --check` passed. Focused template checks also cover old package byte preservation, explicit upgrades, opacity precision and artwork identity. Final spacing constraints are checked at the pure configuration boundary.

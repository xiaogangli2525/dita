# Workspace architecture

## Document loading, navigation and relocation

`document-loader.js` owns a single pending load per workspace/path for both tab opens and Map topics. It returns an existing buffer instead of replacing it, invalidates old workspaces and closed-document requests, and creates new document state through `document-store`. The editor owns one loader instance; the application adds a separate navigation revision so a delayed read can be cached without taking focus from a newer open/close action.

Save As captures source content, target identity/buffer/disk and navigation context. It rechecks the target before an overwrite, serializes duplicate submissions, and merges write acknowledgements without discarding subsequent edits or undo history. Closed targets stay closed and later navigation stays active. A newer disk acknowledgement is never rolled back by an older result.

`reference-paths.js` is shared browser/Node domain logic. The server resolves canonical source/destination paths and patches only local URI attribute values before writing a Save As copy; the browser demo uses the same rebaser. XML declaration, encoding, trivia and code remain intact. Nonempty `xml:base` stops unsupported cross-directory relocation. New Map copies return resolved metadata with the saved result, so no second asynchronous directory refresh can overwrite current buffers.

Map structure commands capture their selection/workspace, disable duplicate actions, and ignore results after a manual switch. New Topic references are resolved against the current Map directory while retaining existing workspace and Map-directory containment guards.

## Author input and structural commands

The inspector presents context-specific content settings and collapsed advanced XML attributes. It delegates image/xref editing to the existing resource controller and note applicability to the existing notes panel. It no longer depends on formatting tools or owns duplicate paragraph-insertion commands. A targeted `remove` command removes the selected content; the explicit table-delete path still removes its complete table. Advanced edits reselect the acknowledged source node after commit and retain disclosure state only for that selection.

`author-input.js` owns structural `beforeinput` operations and context-sensitive Tab behavior. It edits detached DOM copies through `author-selection`, then uses `applyAuthorEdit` and the shared document store for one undo transaction. Ordinary text/IME input continues through `input-history` and the source-preserving projection. A rejected projection restores the acknowledged Topic surface rather than leaving unsaved visual-only content in place.

`author-blocks.js` owns the table insertion dialog and paragraph/list/note/code conversions. `editor-tools` delegates visual table creation to it; source snippets remain separate. `author-selection` centralizes source-aware range capture, contiguous-paragraph validation, applicability comparisons, cross-paragraph deletion and duplicate-ID cleanup. Clipboard conversion uses the same range boundary rather than implementing a second cross-paragraph editor.

`resources` uses `author-commands.replace` for existing image/xref edits, retaining the command's source identity and stale-buffer checks. It preserves XML children and inline anchors; `asset-core.imagePresentation` supplies shared alt/dimension interpretation to Author and delivery views. The composition manifest declares all new ports explicitly.

This remains a lightweight source-preserving editor, with bounded structural commands rather than a complete DITA schema editor. It does not implement DTD validation, arbitrary complex-table editing or cross-Topic range mutations.

The application remains a local Node server and buildless browser client. This change extracts domain logic and feature controllers instead of replacing the framework or rewriting the source-preserving editor. New features have explicit boundaries; the existing XML/encoding, conflict checks, review behavior and undo model remain shared.

## Boundaries

| Layer | Modules | Responsibility |
| --- | --- | --- |
| Composition and contracts | `application.js`, `contracts.js` | Validate factory/dependency declarations, provide narrow feature contexts, expose compatibility APIs, document shared data contracts |
| XML and document state | `xml-source.js`, `document-store.js`, `lib/document-files.js` | Source ranges/validation, undo and acknowledgements, encoding, real-path containment and atomic writes |
| Shared domain | `manual-core.js`, `footnotes-core.js`, `publication-core.js`, `publication-resolver.js` | Versioned model configuration, applicability, source edits, reuse resolution and publication preparation |
| Manual service | `manual-service.js` | Freeze buffers, resolve a Map or Topic and its direct local dependencies, check snapshot identity and provide save/note/publication views of that same scope |
| Editor/rendering | `app-core.js`, `delivery-core.js`, `diff-core.js` | Author/source conversion, stateless HTML/Markdown rendering, and pure diff algorithms respectively |
| Editor coordination | `editor-controller.js` | One document history across Source, Topic/Map Author and review; surface/mode updates and pending Map-render lifecycle |
| Workspace presentation | `workspace-shell.js`, `document-label.js`, `delivery-view.js` | Panel visibility, resizing, focus and document labels; presentation of delivery configuration, preflight and export readiness |
| Feature controllers | `save.js`, `drafts.js`, `project.js`, `search.js`, `resources.js`, `export.js`, `map-controller.js`, `documents.js`, `author-notes.js`, `editor-tools.js` | Bind DOM to domain/services; do not implement independent applicability or dependency rules |
| Persistence adapters | `workspace-client.js`, `draft-store.js`, `release-store.js`, `browser-files.js` | Workspace identity on requests, browser-local recovery/history, download and hashing |
| Server tools | `lib/workspace-tools.js` | Model config, bounded plaintext search, source provenance and image IO; receives the current root and existing IO/response helpers from the authenticated router |
| HTTP and Git boundaries | `lib/api-router.js`, `lib/http-utils.js`, `lib/git-service.js` | Shared request guard and API dispatch, bounded JSON/response helpers, and repository/branch/Git baseline operations |

`app.js` creates the compatibility `DitaApp` facade, delegates feature assembly to `application.js` and owns remaining navigation and DOM bindings. `workspace-shell.js` owns panel visibility and resizing; `inspector.js` owns element properties and table controls. `editor-controller.js` owns document history, modes, Topic/Map synchronization and review coordination. `editor-tools.js` owns Author selection formatting, body find/replace, structural insertion and explicit Source find/insertion; `author-selection.js` owns guarded ranges and detached-clone commits. Feature controllers receive declared capability subsets, while integration/browser callers retain the compatibility facade.

## Workspace presentation contract

Footnote presentation is owned by `footnote-presentation.js`, constructed with explicit state/DOM/events/manual ports. `publication-resolver.js` retains visible occurrence locations separately from reusable definition origins; `publication-core.js` creates a first-use sequence with shared numbers for repeated xrefs. `manual-service.js` maps those sites back to exact source XML paths. The presentation controller supplies the Author labels, list and edit-dialog label from one guarded snapshot. A chapter opened from the selected manual retains that manual's scope; an unrelated Topic uses its own scope. Cached dependencies are overlaid with current buffers for local updates; new dependencies trigger a fresh capture. Scope/workspace generations and snapshot checks discard late results. Failed captures clear plausible old labels. `author:rendered` reapplies presentation after partial mounts; label changes preserve original XML, source identity, caret and document history. Named definitions are marked explicitly and protected xref markers serialize their original source, never their display label.

Navigation geometry remains owned by `workspace-shell.js` and `workspace.css`: the desktop default is 296px, adjustable between 260px and the smaller of 400px/42% of the viewport. Only the preferred width is stored in browser storage; temporary viewport constraints do not overwrite it. Missing storage falls back to the default and does not block resizing. Pointer, keyboard and reset gestures share the same bounds. These preferences never enter document buffers or history. At 1280px and below the auxiliary panel overlays the workspace; mobile navigation owns its backdrop, close/focus behavior and defers keyboard handling to open dialogs. Header/footer measurements keep overlays within the actual available height.

The default desktop layout has document navigation, the writing area and an auxiliary tool rail. Properties, model notes and review share one optional, resizable panel. The shell owns the panel name, visibility, active buttons and ARIA state. Feature controllers request `shell.openPanel()` / `closePanel()` instead of toggling layout classes. Review still uses the editor's read-only review mode; closing review returns to writing. Narrow screens use drawers, and the same controls remain reachable. Escape belongs to an open modal first, then to workspace panels; closing a panel restores its opening control's focus.

`footnotes.setVisible()` only controls note content/refresh. Changing manual scope immediately removes previous actionable note cards while the next snapshot loads. This prevents navigating or editing stale cards during the refresh debounce. Element selection continues to be maintained while the properties panel is collapsed.

Document labels use the current buffer's XML title, falling back to the filename for missing/invalid titles. `document-label.js` caches labels by file object and exact source in a WeakMap. Map headers and navigation reuse that presentation function through an injected callback; the editor does not import the shell. Paths remain available as secondary information. The save badge describes the active Topic or active Map's loaded Topic scope; other open tabs retain their own dirty markers.

`delivery-view.js` presents configuration, check results and export readiness. `export.js` remains the sole owner of snapshots, preflight, conversion, cancellation and downloads. A completed check enables the export summary; model, format or version changes invalidate both the compiled output and the displayed check state. Direct preview/export actions still run the same preflight, and no view action bypasses stale-snapshot checks. The view is created lazily so the legacy export adapter has no UI initialization dependency.

Styles are layered explicitly: `tokens.css` defines visual primitives; `styles.css` renders document content; `workspace.css` owns shell geometry and responsive layout; `panels.css` styles feature controls and dialogs. New UI state belongs in controllers, not CSS selectors that infer feature state from unrelated DOM details.

## Assembly and lifecycle

`application.js` is the feature composition root. Its manifest names each factory, the ports it may consume, immediately required services and any public compatibility methods. Every feature receives a frozen context of live getters, rather than the whole application object. The save busy flag is the sole explicitly writable context port. This freezes the dependency surface, not the shared document state; editing controllers still coordinate state through document-store/editor APIs.

Immediate dependencies must be ready before construction. Some relationships are deliberately lazy: the manual service reads project configuration only when capturing; note/inspector callbacks request shell or writing tools only after startup. Live getters preserve these relationships without constructors discovering other controllers or registering services. Do not read a deferred service in a constructor; add it to the manifest's `requires` list and order its factory first when construction needs it.

`export.js` now registers `createExportController` and performs no DOM/event/application access at script load. Explicit construction owns its preview URL, configuration, cancellation, last delivery record and check result. The manual service and image-loading adapter are injected; export cannot silently construct another manual service. Compatibility methods and result getters are forwarded by the composition root. The unused parallel Topic loader/cache and obsolete dropdown-menu state have been removed: all publication reads use the shared manual snapshot service.

`contracts.js` describes document values, workspace IO, manual snapshots and important save/export/manual ports using JSDoc. It is not loaded in the browser and introduces no runtime store. These definitions help editor navigation and review; this project does not yet perform whole-project static type checking. Runtime factory checks and regression tests enforce the current boundaries.

`document-store.createDocument()` is the single production constructor for opened Topics, Map children, new documents and Save As results. It establishes separate current/disk/Git-baseline values. `snapshotDocument()` returns a frozen, history-free value copy and derives dirty state from current versus disk. Manual capture and scoped saves consume these copies; snapshots cannot retain live undo arrays or change when later input/undo occurs.

`createEditorController(A, views)` receives the existing document state, workspace client, source rules and event bus through the application facade. View callbacks (`renderTabs`, `renderOutline`, `renderInspector`, `updateTree`, `refreshChrome`) and optional before/after mode-change hooks are injected by the entry point; the coordinator does not discover or initialize the footnote or export controllers. It creates the Author conversion API and review controller once and returns edit/history/mode operations. The facade's `setFileContent` and `setMode` retain their existing contracts for save, notes, resources and future AI proposals. The coordinator discards pending Map refresh timers and advances its render generation on `workspace:willChange`, before new workspace state is adopted.

`createGitService({getRoot, repositoriesRoot, checkedResolve})` owns Git process execution, encoded HEAD contents, repository discovery and protected branch switching. It obtains the current root through a getter at operation time, so it cannot retain a previous repository after a switch. Multiple service instances can use independent roots. The service does not own HTTP responses or workspace tokens; existing real-path checks and the server's workspace lock still protect calls.

`createApiHandler({workspace, git, documents, maps, ...originOptions})` receives explicit service groups. Its live workspace getters supply the current root/token, and its common identity/origin check runs before all tool and document routes. `server.js` retains workspace construction/switch rollback, Map tree operations, static serving and the read/write lock. Its existing exports remain compatibility entry points for existing consumers/tests. The HTTP layer still uses the same 5 MiB body limit, XML validation, expected-content conflicts, create-only behavior and response shapes.

The browser still loads namespaced factory scripts before the entry point. Factories register definitions without starting UI features; `application.start()` validates the complete feature plan and required initialization order, then constructs controllers. Missing factories, unknown ports, duplicated names/aliases and invalid writable ports fail explicitly. No framework, package, database, endpoint or document syntax is introduced.

The browser uses explicit script order and namespaced factories. Node tests import the same domain modules via CommonJS. No frontend build is required. Office delivery adds pinned `docx` and `playwright-core` runtime dependencies; only Word export lazily loads the browser conversion modules.

## Shared manual contract

`createManualService(A)` exposes:

- `capture(path)`: capture workspace/root/branch, project config, current buffers and the Map/Topic dependency closure before further interaction.
- `current(snapshot)`: reject changes to workspace, relevant buffers, their disk acknowledgements, open-file identity or project configuration.
- `prepare(snapshot, model)`: validate registered model names and create the publication copy without modifying source buffers.
- `listNotes(snapshot, model)`: use the publication note set and its recorded source origins. Source notes stay editable even when a registry typo needs correction.
- `saveCandidates(snapshot)`: return dirty opened files in this explicit scope, including referenced resources and excluding unrelated opened documents.

The note panel lists publishable note definitions/occurrences with the same ancestor conditions as delivery. Repeated references to one definition share one publishing entry. Reused notes navigate/edit the original source; local conditions on including elements still apply. The save controller shows the file list for a Map, requires a user selection and writes frozen snapshots through the existing optimistic save coordinator. Unselected/newer edits stay dirty. A batch is validated before its first write, but is not a filesystem transaction; partial failures report the count saved.

## Office delivery boundary

`export.js` orchestrates snapshots, preflight, cancellation, download and records for all four formats. `office-export.js` receives the same prepared, self-contained HTML as HTML delivery; it owns shared print styles, editable Word conversion and the explicitly labelled browser-print fallback. It contains no DITA applicability or source-loading rules. Word uses native paragraphs/tables/bookmarks and embedded images. Notes remain linked end-of-document definitions to preserve one shared number for repeated references; they are not native page-bottom footnotes. The HTML importer's automatic per-reference footnote conversion is deliberately avoided.

`lib/pdf-export.js` accepts only HTML via authenticated, same-origin `POST /api/export/pdf`, under the existing 5 MiB request limit. It launches a separate Chromium per job, with a 15-second launch timeout, 30-second render limit and one active PDF job. The renderer disables scripts/service workers and blocks all requests; an initial CSP allows only inline styles and data images. It cannot fetch remote or workspace files. Disconnects abort the renderer and cleanup closes Chromium. The route uses the workspace read lock so concurrent reads remain available. Fixed vendor routes serve only the three required `docx` UMD files from the installed package.

`workspace.capabilities.pdf` distinguishes a native PDF backend from the static demonstration. The demo's print dialog produces no unverifiable PDF hash or download record. Binary Word/PDF records hash the actual Blob bytes, not a string representation. Preview blobs are revoked when replaced/closed. A corporate Word template, configurable paper size, native page-bottom footnotes and full DITA-OT processing remain separate future work.

## UI events

`manual-core.createEvents()` supplies a small event boundary. Controllers can subscribe without being called directly from every editor action. An auxiliary listener failure is isolated so it cannot stop other document listeners.

| Event | Emitted for | Consumers |
| --- | --- | --- |
| `document:changed` | Edit, undo/redo, or save acknowledgement | Draft backup, active content-search refresh and current-Topic writing search |
| `file:opened` / `file:closed` | Document lifecycle | Recovery availability and explicit closed-file draft disposal |
| `workspace:willChange` | Before replacing root/branch state | Flush pending recovery drafts under the old identity |
| `workspace:changed` | After adopting workspace/config | Recovery list and stale search clearing |
| `project:changed` | Model config acknowledgement | Refresh note/model information |

## Persistence and integrity

- `.dita-project.json` is optional Git-tracked JSON (`schema: 1`, `models: string[]`). The UI writes it with an exact expected-content check. Empty models mean registry validation is not enabled; populated models make unknown names publication/edit errors. A malformed file can be repaired explicitly without bypassing the baseline check.
- A confirmed common footnote uses the standard DITA metadata attribute `otherprops="applicability(common)"` as an application convention. It is distinct from an unresolved, unlabelled note. Existing unrelated metadata is retained. Conflicting product/ancestor conditions are rejected. This convention is not a full DITAVAL profile.
- Drafts are browser-local copies keyed by repository, branch and path. They retain the disk comparison base. Restore re-reads disk, requires matching disk content and no conflicting current edit, applies through the undo model and never saves automatically. A stale draft remains downloadable. Quota/storage failures are visible and do not block normal editing.
- Delivery history is browser-local, repository-scoped and capped at 50 records. A record describes **download initiation**, not completion or customer receipt. It contains source Git metadata, unsaved paths, project/source/output SHA-256 hashes and the requested version/model/format, not document XML. JSON records can be archived separately. Previews create no release record.
- Compile/preview/download share one snapshot. Busy controls cannot change the requested scope. Cancel invalidates the operation synchronously and aborts pending image requests before a download can start. Image decoding is checked before successful preflight.
- XML browser downloads normalize the declaration to UTF-8 because the browser writes UTF-8 bytes. Editor contents and encoded filesystem saves keep their original declarations/encodings.

The HTTP server still performs workspace-token/origin checks before tool routes, uses real-path containment and serializes mutations through the workspace lock. Uploaded images are create-only, limited to 2 MiB and checked by shared `asset-core.js`; standalone image responses are sandboxed and served with `nosniff`. Existing file writes retain expected-content conflict checks.

## Extension guidance

Add shared rules to a domain module with a versioned contract; do not reproduce them in a controller. Add a UI feature as a controller created at the composition root and consume the manual/document APIs. New delivery formats should consume `prepare()` output and keep IO injected. A future AI adapter can consume a captured manual scope and produce an edit proposal for the existing review/undo boundary; it must not bypass snapshot checks or perform automatic filesystem/Git writes.

The static hosted demonstration is a separate persistence adapter. It reuses the same frontend/domain code and supplies browser-local mock workspace routes. Its capability metadata declares browser persistence and no real Git provenance. It is not a deployed multi-user filesystem/Git server.

## Verified and bounded scope

Unit/HTTP and Chromium checks cover editor/review/export behavior and the model, draft, search, upload, save-scope and delivery workflows. Boundary checks cover independent Git service instances, live repository roots, real repository switches with stale-tab rejection, Map child undo/review identity and disposal of pending Map refreshes. `shell-browser.test.js` additionally verifies panel state, keyboard resizing, document save scope, delivery-check invalidation, modal Escape and narrow-screen navigation. Real company documentation was not accessible; integration uses the fictional MQTT fixture. Existing supported/unsupported DITA boundaries remain documented in `publication-compatibility.md`.

Repository search scans at most 2,000 documents / 10 MiB per request, skips files above 1 MiB and returns at most 100 hits (30 per file), with truncation/warning indicators. It decodes actual XML text and entities, maps hits back to source ranges and overlays unsaved buffers in the client. This is bounded on-demand search, not a persistent large-corpus index. Draft and release storage is limited to the current browser and is not a backup service or server-side release archive.

## Author insertion and writing position

`author-notes.js` consumes the guarded selection and detached-clone operations from `author-selection.js`, including the actual child surface in a Map. A detached clone retains source-path metadata and receives a temporary footnote placeholder; the existing Author serializer captures its exact XML position. No live DOM or buffer changes occur while the form is open. The controller checks workspace, file identity, active path, source and model configuration again on submit. `footnotes-core.completeInsertion` reuses the existing escaping/applicability rules and removes the temporary identifier so the result is an inline occurrence, not an unused reusable definition. Explicit common scope is unavailable inside inherited product conditions.

`editor-controller.applyAuthorEdit` validates and commits through document-store before replacing only the affected surface. Author undo/redo also refreshes the affected Topic, keeping other Map chapters mounted and retaining scroll and a text-position bookmark when its source block is still available. Bookmarks are best-effort caret positions rather than a semantic editing history. Paragraph splits remove only newly cloned duplicate IDs; existing source identities stay intact. Composition key events are excluded from application undo/save shortcuts. Source, review and Map structure histories continue to use their existing paths.

## Writing tools and rendered-source identity

`author-selection.js` records a live range together with its Topic surface, source buffer, workspace and active path. Detached copies retain source-node metadata. Formatting, insertion and replacement serialize with the existing Author converter, validate XML and apply exactly once through `applyAuthorEdit`; they never write files. The rendered surface records its exact source buffer in a JavaScript property, not XML. A buffer/surface mismatch refuses edits rather than serializing stale DOM over a newer buffer. Normal Map buffer updates refresh only that child; live input records its new rendered-source identity without rebuilding the DOM.

Formatting wraps selected text runs rather than extracting mixed XML. Removing partial formatting retains the original attribute extent as `ph`, with emphasis retained on unselected runs. This preserves identifiers, product applicability and links without duplicating attributes. Editable list items and headings now retain source paths, and rich heading content stays editable through render/serialize cycles.

The writing find panel builds a read-only rendered-text index per selected Topic. It joins inline text within a block, stops at protected content/block boundaries and maps matches back to text nodes. CSS Custom Highlights do not add XML nodes; browsers without that API use the active DOM selection. Replace edits only text-node portions on a detached copy, retains surrounding elements/IDs and applies all chosen matches as one undo entry. Source search remains an explicitly labelled alternative in Source mode. Multi-Topic replacement and a full schema-aware rich-text engine remain outside this iteration.

## Input history and shared editing boundaries

`document-store.editDocument` accepts an optional grouping descriptor. Ordinary input merges only with the still-open last entry when the file content, operation key, cursor continuity and 900 ms interval agree. Composition uses a unique per-session key so intermediate text remains one action across longer candidate selection. Undo/redo, explicit commands and save requests close groups; a composition returning to its original text removes its empty entry. History remains bounded to 100 entries per document.

`input-history.js` owns beforeinput/composition events and grouping boundaries. It captures before/after Source or Author selections through injected editor callbacks and does not implement XML conversion, IO or document rules. `editor-controller.js` commits those descriptors through the existing store, restores Source selections or Author bookmarks after history travel, and exposes optional before/after selection metadata to migrated visual edits. `author-selection.js` owns source paths, block text offsets, marker/image boundaries, selection direction and scroll position. Legacy review and structural operations can still fall back to the previous best-effort caret behavior.

`note-scope.js` supplies one model/common/unresolved picker to new and existing note forms, reusing the project registry and core applicability rules. Existing unknown model names are retained as repairable chips rather than silently discarded. Edit forms freeze project identity as well as the note source. Local note list edits use an existing Topic surface in the active Map; shared references retain an explicit source-opening boundary.

Resources and notes now use the same guarded selection adapter as formatting and body replacement. Resource application runs on detached DOM, validates XML and commits once via `applyAuthorEdit`, keeping the active Map and other Topics mounted. Selected links modify text runs without deleting original inline elements/identifiers; images retain selected text and insert after it. Cancelling a picker restores its captured position only when that context is still current. Source-mode resource insertion keeps its explicit XML path. Image upload is a separate create-only IO operation and is not undone by cancelling the reference picker.


## Source commands and writing reliability

`author-commands.js` receives explicit state, DOM, XML core, selection, validation and apply dependencies. It captures the rendered source, file identity, active document and element source path. Attribute commands patch only the opening tag; table commands replace the selected table subtree; surrounding source remains byte-for-byte intact. Stale operations are refused before `applyAuthorEdit`, which remains the shared validated undo/selection boundary. No command mutates the live Author DOM before commit. `inspector.js` owns the property UI and context controls removed from the entry point. It reads actual XML attributes rather than transient HTML attributes or cell metadata.

`table-core.js` owns regular CALS table transformations without IO or application state. It keeps colspec names/positions and tgroup column counts aligned, creates fresh row/cell identities, preserves a body row and a column, and supports header conversion and positive column widths. Spans, nested tables and irregular column layouts are explicitly refused for structure changes. The Author renderer displays widths and span metadata. This remains a bounded CALS editor, not a schema-aware arbitrary table designer.

`clipboard.js` owns the paste/drop boundary. Inert HTML parsing and an element allowlist produce document content; foreign attributes, identifiers, scripts and image URLs are not copied. Basic rectangular HTML tables become CALS tables. Complex tables use a visible plain-text fallback. The selection adapter edits a detached copy, checks protected/single-block selection, validates XML and commits once through the shared history boundary. Applicability metadata propagates to new siblings when a conditioned paragraph is split. Source-mode paste remains explicit XML editing.

`document-templates.js` is a shared, IO-free template catalog. `documents.js` binds one form to create-only requests, validates relative paths and extensions, refuses stale workspace identities and retains errors for correction. Existing files are never replaced by this workflow.

`body-navigation.js` shares rendered source paths between search and footnotes. It reuses a mounted Map child, checks the expected source, highlights the target and retains one preceding writing bookmark. Content not rendered in Author can be located through the explicit Source action in search. This navigation is independent of file persistence.

The current performance check uses a synthetic 400-paragraph Topic and twelve sequential source-preserving edits. Conversion still processes a complete Topic; one redundant XML parse is now removed by passing the existing parsed source into the projection renderer. Large-corpus indexing, Map virtualization and a general incremental document model remain future work to be guided by real company manuals.

## Remote library boundary

`lib/remote-repositories.js` owns URL/name/ref validation, staged cloning, remote branch discovery, update inspection and guarded fast-forward updates. Its live root getter follows workspace changes. The remote transport adapter is injectable for local bare-repository tests and is never selected by HTTP data. Production accepts HTTPS and SSH only. Commands use argument arrays, noninteractive credentials, explicit protocol allowlists, disabled hooks/submodule recursion and 120-second network limits. The Git runner waits for child closure and bounds stdout, with process-group termination on timeout.

Clone runs in a hidden sibling staging directory and cleans failures before publishing a new library; it never selects a workspace by itself. Update checks fetch a tracked origin ref and report ahead/behind counts without modifying documents. Update requires the checked local/remote SHA pair, re-fetches, refuses dirty/divergent/ahead histories and unfinished Git operations, and uses `merge --ff-only --no-overwrite-ignore`. No reset, stash, rebase, force push or automatic commit is performed. Standard Git credentials remain outside HTTP and browser storage.

`api-router.js` places the routes behind the existing workspace identity/origin guard and server mutation lock. Clone returns a local path; the existing repository-selection route adopts it. Actual updates rotate identity before rebuilding workspace state, so old tabs cannot save against the previous checkout. A missing initial document directory yields an empty loadable workspace.

`remote-libraries.js` is a feature with declared state/API/event/status ports and injected workspace-reload/navigation callbacks. It prevents buffer loss on import/update, invalidates checks on workspace change, separates check from update, and offers an explicit Map chooser. Capability metadata disables it in the static browser-local adapter. Public hosting of the local filesystem/Git server is outside the current single-user deployment model.


## Contextual writing and note applicability

`author-context.js` owns a small selection/caret toolbar outside the editable DOM. It delegates commands to `editor-tools`, which already owns validation, detached projections, history and resource dialogs. It checks source/workspace/selection freshness before restoring a selection and executing; input, IME, scrolling, mode changes and document events dismiss the UI. No second editor or command implementation is introduced.

`manual-service.listNotes` attaches deduplicated visible usages grouped by source identity in one pass, retaining inherited conditions per occurrence. Synthetic origin entries and named definitions do not count as uses; block conrefs count even without separately editable fn markers. The source-preserving publication graph remains authoritative. Counts are explicitly scoped to the current manual.

`footnotes` owns single-click detail previews, the shared source/impact view and the existing editor. `note-scope` supplies live applicability feedback from the original ancestor restrictions, current selection and project registry. Mounted public sources edit in place and restore the original call selection on apply/cancel. Other public-source navigation uses `bodyNavigation.remember` to preserve a return location. All popovers stay outside the XML projection and cannot create document/history changes.

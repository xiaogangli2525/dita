# Workspace architecture

## Workspace entry-point decomposition

`app.js` now creates shared state and assembles explicit ports for the editor, workspace services and feature composition. It contains no DOM event installation or workspace HTTP implementation. The existing `DitaApp` facade and proposal/save/editor interfaces remain available. Bootstrap view callbacks resolve services after construction, while factories keep their own per-instance state.

| Module | Responsibility |
| --- | --- |
| `app-dom.js` | DOM handles only; no listeners, network or application state |
| `workspace-controller.js` | Initialization, repository/branch switching, token adoption and safe directory refresh |
| `document-navigation.js` | Last-request-wins document opens, close behavior and guarded source jumps |
| `workspace-view.js` | Header/save status, tabs, outline, filename search and switching feedback |
| `app-actions.js` | Delegate toolbar and global keyboard commands to existing feature/editor controllers |
| `menu-controller.js` | Menu availability, keyboard navigation, focus restoration, bounds and async-action errors |

Workspace switching prevents overlapping requests, rejects switching during an active save, and makes the header/layout inert while a confirmed switch is pending. Failed switches retain current buffers and restore interaction. Directory refresh rejects a different workspace identity before mutating state. Navigation refuses a delayed source jump after a newer document wins. No HTTP/domain work is moved into the view.

UI follow-up includes source-identity outline targets (metadata titles cannot shift headings), keyboard document/navigation tabs, panel-safe menu Escape, outside-click capture, no-file action availability and handled failed opens. Rule review retains partial choices per source during the open session, confirms discarding them on close, freezes editing/selection during writes and allows cancelling slow reads. Delivery content scrolls independently from always-reachable actions; step changes reset content scroll.


## Shared-state mutation ownership

`workspace-session.createSession(state)` installs getter-only views for workspace identity, directory/Map metadata, opened-document membership, active document, editor mode, undo target and Map Author membership. Arrays and nested descriptors are copied/frozen. Live Map/Set views support reads/iteration but expose no mutators or private collections through `forEach`.

Workspace, navigation, loader, Map, editor and creation/Save As controllers receive the session capability explicitly. They call `replaceWorkspace`, `refreshDirectory`, `registerDocument`, `closeDocument`, `activateDocument`, `upsertMap`, selection/mode/history operations instead of writing those state fields. Existing-buffer registration never replaces document identity or undo history. Closing an undo target falls back to the active document. Directory refresh preserves dirty Maps' last valid projections until their guarded source resolver publishes another projection. Invalid workspace payloads are rejected before lifecycle notification and token adoption.

Document content, disk acknowledgement and dirty/Git status mutations belong to `document-store`; `acknowledgeSave` is shared by ordinary saving and Save As. Save requests are copied/frozen before asynchronous sending, and mismatched path/content acknowledgements fail before advancing disk. Newer working edits and the Git comparison base remain independent.

ESLint rejects direct controller assignments to protected state and document fields, and direct mutation of the opened-document collection. The editor still owns transient review decisions, visual-input suppression and selected DOM elements; these UI-only fields are not promoted into the workspace session. Live document handles remain compatible with history operations; their content writes are constrained by the store interface and lint rather than new Proxy objects.

## Explicit prose-model export policy

`model-note-text.js` is an opt-in, source-format projection for footnote text. It recognizes complete model-label lists and limited explicit only/unsupported clauses, carries textual scope through continuation sentences and nested containers, and compacts retained labels through XML text spans. Balanced Oxygen insertion spans remain paired; deletion revisions and ambiguous known-model comparisons require review. It does not change the stored fragment-rule schema or source buffers.

`note-rules-core.project` applies reviewed sidecar rules first, then optionally projects unruled notes. It keeps fn shells for the publication pass, passes confirmed/excluded origins through conref resolution and reports policy counts. Profiling is applied to label fragments before interpretation, with its removed-element count retained. `manual-service` and all output formats consume that one projection. All-model publication bypasses prose projection.

The delivery checkbox is explicitly selected per manual/session. Its value participates in compiled-output caching and delivery records. A specific-model export with unresolved textual scope cannot silently return unchanged mixed-model notes. Model choices are disabled while a new condition snapshot loads, preventing a late capture from replacing a newer visible model selection. Rule-review actions retain the current manual scope.

Condition-file listings add bounded Chinese summaries from the actual validated rules; option values remain source paths. HTML note frames are produced once by the XML renderer, with no regex rewrite of nested `note-body` markup. Endnotes retain semantic ordered lists and anchors with dedicated content/return-link styles.


## Imported-content and local HTTP boundaries

Author attribute copying uses `setAuthorAttribute` before attaching source attributes to HTML. Event handlers, CSS, source resource overrides and editor-reserved attributes stay in inert JSON metadata; conversion restores them only to XML. This preserves original bytes and adjacent text edits without activating source handlers or permitting a source `data-dita-source` to replace editor identity. Generated image dimensions and application markers remain controlled by the renderer. CALS row/cell attributes continue to use their existing inert metadata.

`asset-core.safeLinkHref` rejects executable URL schemes after removing ASCII control/space obfuscation. Author uses it when copying href; the small Markdown HTML renderer tokenizes source once, escapes text and attribute delimiters, and never runs formatting over generated HTML. DITA publication links retain their stricter local-anchor/external-protocol validation.

The API validates Host before workspace bootstrap and asset reads, including same-origin GET requests with no Origin. Trusted hosts come from loopback addresses, an explicit bind address and `PUBLIC_ORIGIN`; wildcard binding alone does not trust arbitrary hosts. Existing Origin, workspace-token, optimistic-write and real-path checks still apply. Disposable demo mode supports the preview proxy; this does not add shared-server user authentication.

## Independent footnote delivery rules

`note-rules-core.js` is a pure shared module: it validates the versioned sidecar, partitions balanced XML fragments, proposes exact known-model mentions and projects confirmed rules into a new source Map. Source buffers are never edited. Rules bind to source path/XML position plus the original note, surrounding text and inherited product conditions. Changes invalidate the binding rather than triggering a fuzzy match. Inline markup stays atomic; block containers are reconstructed only when retained children remain. Revision PI boundaries stay together.

`note-rule-store.js` owns workspace-aware reads, optimistic saves and export-time revalidation of `.dita-note-rules.json`. `/api/note-rules` uses existing workspace/origin/real-path guards and atomic writes; same-path writes are serialized so overlapping saves cannot both accept the same base. Malformed sidecars return an explicit error and retain their bytes. The store refuses responses from replaced workspaces and prevents older reads from replacing newer save state.

`note-rules.js` owns only the review dialog. It obtains unmodified source notes through `manual-service`, deduplicates public origins, requires an explicit decision for every fragment and saves the independent config. Pending suggestions are never export rules. The original authoring/panel view bypasses projection. `manual-service` captures config in the delivery snapshot, applies rules before conref expansion and passes confirmed/excluded origins to `publication-core`; existing product/DITAVAL constraints still apply. Empty definitions remain through resolution so the publication pass can remove their calls and renumber all remaining notes correctly. Every output format consumes that same publication data.

Export re-reads rules before and after conversion, including cached checked output. Delivery records contain both normalized rule-config SHA-256 and the exact sidecar input hash. Rules for other source paths do not affect a captured manual. The implementation performs explicit fragment filtering, not natural-language rewriting; shared labels and inseparable inline/revision fragments are preserved for human review.

## DITAVAL and real-library compatibility

`profiling-core.js` is a pure, shared conditional-processing module. `manual-service` reads an explicitly selected workspace DITAVAL into its own snapshot field, filters Map references before resolution and skips excluded dependency branches. `publication-core` applies the same profile to expanded Topics, preserves original note origins and merges overlapping removal ranges. Whole excluded Topics are omitted from delivery entries; their source buffers remain intact. No DITAVAL is inferred from filenames or imported from an Oxygen project. Branch `ditavalref`, custom profiling specializations and flagging are explicit unsupported boundaries.

The delivery controller guards asynchronous profile changes by operation, workspace and selection generation, invalidates cached previews/checks, and records the captured profile's path/hash with source hashes. Invalid profile settings remain editable in the configuration step. `/api/filters` is a bounded, symlink-skipping workspace listing, and `/api/file` allows read-only DITAVAL access through the existing real-path checks.

Author rendering includes root `shortdesc` and an empty, non-persisted paragraph for bodyless Topics. Writing a first paragraph creates the appropriate body after metadata; title/summary-only edits leave absent bodies absent. Image presentation does not introduce a synthetic empty `alt` into the XML. `pdf-fonts.js` checks actual Han-character coverage on Linux before native export; it uses DOM text rather than layout-dependent `innerText`, which can be empty when all glyphs are missing. `npm run check:pdf` verifies the local renderer/font setup without writing a deliverable.

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
| Composition and contracts | `app.js`, `application.js`, `contracts.js`, `data-contracts.d.ts` | Validate factory/dependency declarations, provide narrow feature contexts, expose compatibility APIs, document shared data contracts |
| XML and document state | `xml-source.js`, `document-store.js`, `workspace-session.js`, `snapshot-data.js`, `lib/document-files.js` | Source ranges/validation, undo and acknowledgements, encoding, real-path containment and atomic writes |
| Shared domain | `manual-core.js`, `manual-domain.js`, `footnotes-core.js`, `publication-core.js`, `publication-resolver.js` | Versioned model configuration, applicability, publication membership, source edits, reuse resolution, publication preparation and note/model/save-selection projections |
| Manual service | `manual-service.js` | Capture workspace/model identities before IO, read a Map or Topic and its dependencies, verify freshness and expose domain operations through the existing service contract |
| Rendering compatibility | `app-core.js` | Explicit compatibility exports and state/DOM binding; assembles Author, source, Oxygen, diff and delivery modules |
| XML/Author adapters | `xml-dom.js`, `author-renderer.js`, `author-source.js`, `oxygen-core.js` | XML validation/DOM/ranges, explicit-document projection, source writes and document-local Oxygen processing |
| Delivery rendering | `delivery-core.js`, `delivery-document.js`, `markdown-preview.js`, `delivery-data.js` | DITA-to-output conversion, data-only HTML layout and standalone Markdown preview/highlighting |
| Diff algorithms | `diff-core.js` | Pure comparison/grouping and review application algorithms |
| Editor coordination | `editor-controller.js` | One document history across Source, Topic/Map Author and review; explicit service ports and surface/mode updates |
| Map authoring | `map-author-controller.js`, `map-source.js` | Instance-local asynchronous Map rendering/refresh jobs; source-range edits for Map/Bookmap titles |
| Workspace presentation | `workspace-view.js`, `workspace-shell.js`, `menu-controller.js`, `app-dom.js`, `document-label.js`, `delivery-view.js` | Panel visibility, resizing, focus and document labels; presentation of delivery configuration, preflight and export readiness |
| Feature controllers | `save.js`, `drafts.js`, `project.js`, `search.js`, `resources.js`, `export.js`, `map-controller.js`, `documents.js`, `author-notes.js`, `editor-tools.js` | Bind DOM to domain/services; do not implement independent applicability or dependency rules |
| Persistence adapters | `workspace-client.js`, `draft-store.js`, `release-store.js`, `browser-files.js` | Workspace identity on requests, browser-local recovery/history, download and hashing |
| Server tools | `lib/workspace-tools.js` | Model config, bounded plaintext search, source provenance and image IO; receives the current root and existing IO/response helpers from the authenticated router |
| HTTP and Git boundaries | `lib/api-router.js`, `lib/http-utils.js`, `lib/git-service.js` | Shared request guard and API dispatch, bounded JSON/response helpers, and repository/branch/Git baseline operations |

`app.js` creates the compatibility `DitaApp` facade and delegates feature assembly to `application.js`. Workspace IO, navigation, presentation and event installation live in the controllers listed above. `workspace-shell.js` owns panel visibility and resizing; `inspector.js` owns element properties and table controls. `editor-controller.js` owns document history, modes, Topic synchronization and review coordination; it receives a frozen set of explicit ports, with a lazy selection service for initialization order. Its Map controller receives named IO/view/history callbacks, and input history receives only state/DOM/events. `editor-tools.js` owns Author selection formatting, body find/replace, structural insertion and explicit Source find/insertion; `author-selection.js` owns guarded ranges and detached-clone commits. Feature controllers receive declared capability subsets, while integration/browser callers retain the compatibility facade.

## Author and output rendering boundaries

`app-core.js` is a compatibility facade with explicit exports; existing `DitaVisualCore`/CommonJS callers retain their public API. It binds editor state/DOM only in compatibility methods, and assembles delivery using explicit parser, Oxygen and asset-path functions. New lower-level code imports its actual owner instead of depending on the facade.

| Module | Input / responsibility | Allowed lower dependencies |
| --- | --- | --- |
| `xml-dom` | Validated XML to DOM plus canonical source tree; serialization and element identity | `xml-source` |
| `oxygen-core` | A provided document or source string; local revision indices and tracked-change offsets | None |
| `author-renderer` | Source, explicit owner document and per-call context to an Author surface | XML DOM, Oxygen, asset and presentation helpers |
| `author-source` | Source string and detached/live surface to candidate XML; no history/save | XML DOM, Author projection, presentation and shared entity decoding |
| `markdown-preview` | Markdown string to preview/highlight HTML; no DITA parser or delivery factory | Asset URL policy |
| `delivery-document` | Already-rendered sections/notes plus escaped metadata to full HTML | None |
| `delivery-core` | Publication data and injected adapters to HTML/Markdown; per-export images/anchors/notes | Shared domain, output layout/preview and asset/presentation helpers |

The graph is acyclic: source conversion can project a baseline through the renderer, while the renderer never imports the writer. XML DOM and Oxygen modules never import Author or the facade. ESLint enforces the declared import lists, prevents application/IO access and disallows ambient `document` in these adapters. Only the XML DOM adapter chooses the platform DOM parser; the Author renderer requires an owner document. The facade retains browser-document defaults for compatibility. Script order in `index.html` follows the same dependency order as CommonJS.

`xml-dom.parseSource` returns `{ document, tree }` from the existing canonical validator. Source writes adapt its UTF-16 element/text ranges; the old separate XML lexer is removed. Unchanged ranges retain their original declaration, DOCTYPE, quote style, CRLF, CDATA, comments and processing instructions. For annotated text, small text edits preserve annotation/entity positions; edits crossing markers or ambiguous whitespace/CDATA-plus-annotation mappings stop with a Source-editing message. Ordinary CDATA nodes render as inert text in Author and HTML/Markdown, including outside preformatted blocks.

Rendering/source modules do not apply edits, own a workspace or record history. Controllers still check the selected file/surface freshness, call the existing document store and restore the surface on rejected conversion. HTML layout accepts trusted, already-rendered section/note bodies and escapes titles/model/version metadata; it does not replace the publication/URL policy. Per-call Author/export context isolation remains unchanged.

## Manual domain and workspace boundary

`manual-domain.js` accepts a captured snapshot and derives publication data, source-linked notes, model discovery and save candidates. Its named helpers separate project checks, rule projection, source indexing and usage mapping. It does not receive application state, DOM handles, network functions or the editor core. A Node batch/AI adapter can reuse these operations with explicit input data; it must still acquire an authorized scope and apply edits through the proposal/history boundary.

`manual-service.js` owns workspace reads, Map resolution, dependency capture, filter listing and freshness checks. The existing service methods delegate to the domain functions, so save, note, search and delivery controllers retain their interfaces. The composition manifest no longer grants the service `ditaCore`. Model config is copied and frozen after project readiness but before document IO; workspace, repository, branch, model-config content/error and actual model values must still match during capture and before use. Edits or configuration replacement during IO stop capture instead of mixing generations.

Captured source records, model settings, Map metadata and external rule metadata are detached/frozen by `snapshot-data.createSnapshot`. Captured Maps expose read-only iterable views over private collections; `Object.freeze(new Map())` is not used as an immutability guarantee. Consumers create derived copies. Rule review replaces its local snapshot through `createSnapshot` after an acknowledged rule save, preserving the original capture.

`manual-core.collectPreviewPaths` is the single shared membership traversal. `publication-core.preparePublication` uses it by default; delivery retains a compatibility alias. Headless callers no longer need to construct an Author/delivery renderer just to enumerate chapters. Existing first-use order, duplicate suppression and resource-only handling are preserved.

ESLint restricts the declared document-rule modules to known shared dependencies and vendored SAX, rejecting application/rendering/IO imports and common ambient DOM/network/storage access. The clean-process regression executes model filtering and note indexing without loading the editor or workspace services; the real HTTP regression prepares three models from data-only snapshots and verifies unchanged sources. These checks protect the boundary without adding a framework or a build step.

## Map title and asynchronous surface ownership

`map-author-controller.js` owns render generations and debounced directory jobs inside each instance. Completions check the workspace, active document identity, source and mode before changing the surface. Workspace changes cancel timers and invalidate pending successes and failures. Current directory failures report an error while retaining buffers; incomplete XML during typing keeps the last valid directory.

`map-source.js` patches only the existing title value, preserving declarations, encoding metadata, comments, processing instructions and unrelated source ranges. It handles Map `title`, Bookmap `booktitle/mainbooktitle`, the Bookmap alternative `title`, legacy title attributes, missing/self-closing titles and plain CDATA. Bookmap insertion keeps `booklibrary` before `mainbooktitle`. Titles containing inline markup, revision annotations or content references are displayed read-only with a Source-editing explanation, rather than flattened by a plain text edit. This is source-safe editing, not full DITA schema validation.

The Map title is a separate plaintext editing host. Native input/paste use the shared beforeinput/history pipeline; title-only undo/redo restores the title and caret without remounting chapters. The real HTTP/HTTPS acceptance library exercises continuous title input, grouped undo, save/reopen and unchanged dependency bytes. A separate GBK Bookmap covers CRLF, library/subtitle and trailing processing instructions. Late load/refresh and controller-isolation regressions live in `tests/map-author-controller.test.js`.

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

`data-contracts.d.ts` is the checked source for document snapshots/history, pending/applied proposals, save request/acknowledgement/results, manual captures and delivery request/compiled-output/record data. `contracts.js` aliases these types and documents remaining UI ports. `npm run typecheck` uses pinned TypeScript with strict checks and no emit; `@ts-check` covers the actual `document-store`, `save`, `snapshot-data`, `manual-service` and `delivery-data` implementations. Compile-time negative fixtures verify rejected fields, mutable snapshots and unsupported output formats. CI runs this check on Node 20 and 22. This is incremental boundary checking, not a claim that the entire JavaScript project is statically checked.

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

Unit/HTTP and Chromium checks cover editor/review/export behavior and the model, draft, search, upload, save-scope and delivery workflows. Boundary checks cover independent Git service instances, live repository roots, real repository switches with stale-tab rejection, Map child undo/review identity and disposal of pending Map refreshes. `shell-browser.test.js` additionally verifies panel state, keyboard resizing, document save scope, delivery-check invalidation, modal Escape and narrow-screen navigation. Integration now includes the supplied Chinese HTTP/HTTPS manual and its reachable shared content, images and DITAVAL, plus synthetic fixtures for race, conflict and unsupported-input cases. Historical MQTT fixtures remain test-only. This verifies software behavior, not the technical truth of product specifications. Existing supported/unsupported DITA boundaries remain documented in `publication-compatibility.md`.

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

The current performance check uses a synthetic 400-paragraph Topic and twelve sequential source-preserving edits. Conversion still processes a complete Topic; one redundant XML parse is now removed by passing the existing parsed source into the projection renderer. The supplied HTTP manual is covered by delivery acceptance; this synthetic timing check does not benchmark its full library. Large-corpus indexing, Map virtualization and a general incremental document model remain future work guided by measured bottlenecks.

## Remote library boundary

`lib/remote-repositories.js` owns URL/name/ref validation, staged cloning, remote branch discovery, update inspection and guarded fast-forward updates. Its live root getter follows workspace changes. The remote transport adapter is injectable for local bare-repository tests and is never selected by HTTP data. Production accepts HTTPS and SSH only. Commands use argument arrays, noninteractive credentials, explicit protocol allowlists, disabled hooks/submodule recursion and 120-second network limits. The Git runner waits for child closure and bounds stdout, with process-group termination on timeout.

Clone runs in a hidden sibling staging directory and cleans failures before publishing a new library; it never selects a workspace by itself. Update checks fetch a tracked origin ref and report ahead/behind counts without modifying documents. Update requires the checked local/remote SHA pair, re-fetches, refuses dirty/divergent/ahead histories and unfinished Git operations, and uses `merge --ff-only --no-overwrite-ignore`. No reset, stash, rebase, force push or automatic commit is performed. Standard Git credentials remain outside HTTP and browser storage.

`api-router.js` places the routes behind the existing workspace identity/origin guard and server mutation lock. Clone returns a local path; the existing repository-selection route adopts it. Actual updates rotate identity before rebuilding workspace state, so old tabs cannot save against the previous checkout. A missing initial document directory yields an empty loadable workspace.

`remote-libraries.js` is a feature with declared state/API/event/status ports and injected workspace-reload/navigation callbacks. It prevents buffer loss on import/update, invalidates checks on workspace change, separates check from update, and offers an explicit Map chooser. Capability metadata disables it in the static browser-local adapter. Public hosting of the local filesystem/Git server is outside the current single-user deployment model.


## Contextual writing and note applicability

`author-context.js` owns a small selection/caret toolbar outside the editable DOM. It opens only through Alt+/, never from pointer or selection movement. It delegates commands to `editor-tools`, which already owns validation, detached projections, history and resource dialogs. It checks source/workspace/selection freshness before restoring a selection and executing; input, IME, scrolling, mode changes and document events dismiss the UI. No second editor or command implementation is introduced.

`manual-service.listNotes` attaches deduplicated visible usages grouped by source identity in one pass, retaining inherited conditions per occurrence. Synthetic origin entries and named definitions do not count as uses; block conrefs count even without separately editable fn markers. The source-preserving publication graph remains authoritative. Counts are explicitly scoped to the current manual.

`footnotes` owns single-click detail previews, the shared source/impact view and the existing editor. `note-scope` supplies live applicability feedback from the original ancestor restrictions, current selection and project registry. Mounted public sources edit in place and restore the original call selection on apply/cancel. Other public-source navigation uses `bodyNavigation.remember` to preserve a return location. All popovers stay outside the XML projection and cannot create document/history changes.

Shortcut help is a native dialog owned by `workspace-shell`; the menu delegates to that controller rather than writing an unobtrusive status line. Dialog focus and Escape stay within the native modal boundary; application-level document shortcuts defer while a dialog is open.


## Expanded contextual commands and reusable notes

The contextual controller routes paragraph insertion/format clearing to `editor-tools`, conversions to `author-blocks`, existing link editing to `resources`, and table/unlink commands to `author-commands`. It owns visibility and keyboard positioning only. Additional actions expand within the same bounded toolbar. Table commands restore the source cell's new XML path after row/column/header movement.

Format clearing changes only b/i/codeph within the selected text. Original attributes stay on neutral ph nodes; unselected emphasis and protected inline nodes retain their formatting. Unlink patches the xref wrapper into a ph while preserving raw inner XML and non-link attributes.

`note-reuse-core` indexes eligible source definitions and builds escaped relative references without UI or IO. `note-reuse` owns the asynchronous picker and stale selection/snapshot guards. Manual capture optionally includes explicitly declared resource-only topics. Reuse validates a detached publication before one source-preserving insertion; public source buffers remain untouched. The publication engine filters each xref occurrence by its inherited model conditions as well as the target definition conditions; usage summaries retain both constraints.

Automatic note presentation captures run only when Author contains note markers; opening a manual without notes does not launch redundant background document reads. Explicit note panels and reuse pickers still capture on demand.


## Document presentation

`document-presentation.js` owns the standard note labels/tones and preformatted block vocabulary shared by Author, inspector, conversions and delivery. `document.css` owns the document typography separately from shell/panel layout. Generated Author labels use projection metadata and CSS, never editable text nodes.

Author renders codeblock, msgblock, screen, pre and lines as preformatted surfaces while retaining inline XML nodes, exact whitespace and source mappings. Delivery preserves response blocks in HTML/Markdown and emits CALS colgroups for proportional column widths. Note types and custom othertype labels flow through the existing source-preserving attribute command and undo history.


## Model discovery and release markers

`model-discovery.js` shares candidate discovery between project setup, footnote filters and delivery. It reads product tokens and explicit CALS applicability tables headed 模组系列 / 模组子型号. Table discovery uses the first column as the series name; it does not split or infer submodels or parse natural-language footnotes. Evidence records retain the source path and declaration kind.

`tbd` is a release marker, omitted from model candidates and registry validation. Rows restricted entirely to that marker remain pending rather than imported as supported models. DITAVAL and source publication behavior are unchanged. Existing registry values are projected without the marker; the stored file stays untouched until explicit Save. Discovery only fills the editable registry form, and unassigned footnotes continue to be retained with an explicit delivery warning.


## Export and recovery failures

Author projections own an explicit context per render, passed through headings, inline nodes, images and footnote markers. Delivery owns a context per export; the public standalone Markdown conversion creates a fresh one. Neither module retains a fallback context across operations. Reentrant Author projections and overlapping exports are regression-tested.

HTML and Markdown share image preparation. When an embedding loader is provided, failed, empty or invalid results stop the export with image-path issues. Calls without a loader retain the existing reference-based API behavior. The controller adds cancellation and UI state; it no longer duplicates image-failure policy. Git provenance failures remain warnings bound to the captured delivery record.

Release history read/format errors propagate so the UI can distinguish unavailable history from an empty list; appending never overwrites corrupted history. Draft listing returns recoverable entries plus warnings, preserves damaged entries, and propagates storage-access failures. Messages and diagnostics do not include document content.


## Maintenance checks and model-settings lifecycle

`npm run lint` checks first-party JavaScript in the browser, backend, scripts and tests. The pinned ESLint configuration separates Node code from browser/evaluated-browser contexts, excludes vendored source and manual inputs, and requires zero warnings. Intentional control-character filters carry local explanatory exceptions. `.editorconfig` applies text conventions to code/configuration/documentation, leaving DITA encoding untouched. These checks complement runtime contracts and regression tests; they do not add a build step or whole-project type checking.

The project-model controller clears configuration and comparison bases on `workspace:willChange`. Settings open immediately in a loading state so reads can be cancelled; request/view generations prevent late responses from reopening or repopulating a closed dialog. A failed read disables mutation until reopening succeeds. While a save is pending, inputs/discovery/close are locked and repeated submits are ignored; failed writes retain the form. Export continues to use captured configuration and existing stale/conflict checks.


## Appearance preferences

`theme-preference.js` owns validated browser-local preference values and the live system-color-scheme subscription. `theme-init.js` applies the resolved root attribute synchronously in the head, before styles/first paint, preventing a saved dark choice from starting with the light palette. Storage denial falls back to a usable in-memory preference; no workspace identity, document or delivery settings enter this service.

`appearance-controller.js` receives only the theme service and the existing Author selection service. It builds native radio-card choices, exposes a dialog to the rail/View menu, and restores a still-current Author caret on close through the existing guarded selection boundary. It never edits buffers or remounts Author surfaces. The system choice is a full-width automatic-mode row below the four visual presets; its value remains distinct from the resolved root theme.

`tokens.css` holds semantic shell, document, selection and status colors and preset overrides. Existing shell/panel/document styles consume these tokens; rich source semantics and warning/success distinctions remain explicit. Preset miniatures in `appearance.css` use private fixed swatch variables so choices remain recognizable inside any active theme. Export rendering owns its separate CSS and does not receive the appearance preference. Browser regression compares complete HTML bytes across light/dark, preserves unsaved XML/history/selection, checks representative text-color contrast, and covers persistence, live OS changes, unavailable storage and narrow keyboard/scroll operation.

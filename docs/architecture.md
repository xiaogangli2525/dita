# Workspace architecture

The application remains a local Node server and buildless browser client. This change extracts domain logic and feature controllers instead of replacing the framework or rewriting the source-preserving editor. New features have explicit boundaries; the existing XML/encoding, conflict checks, review behavior and undo model remain shared.

## Boundaries

| Layer | Modules | Responsibility |
| --- | --- | --- |
| XML and document state | `xml-source.js`, `document-store.js`, `lib/document-files.js` | Source ranges/validation, undo and acknowledgements, encoding, real-path containment and atomic writes |
| Shared domain | `manual-core.js`, `footnotes-core.js`, `publication-core.js`, `publication-resolver.js` | Versioned model configuration, applicability, source edits, reuse resolution and publication preparation |
| Manual service | `manual-service.js` | Freeze buffers, resolve a Map or Topic and its direct local dependencies, check snapshot identity and provide save/note/publication views of that same scope |
| Editor/rendering | `app-core.js`, `delivery-core.js`, `diff-core.js` | Author/source conversion, stateless HTML/Markdown rendering, and pure diff algorithms respectively |
| Editor coordination | `editor-controller.js` | One document history across Source, Topic/Map Author and review; surface/mode updates and pending Map-render lifecycle |
| Feature controllers | `save.js`, `drafts.js`, `project.js`, `search.js`, `resources.js`, `export.js`, `map-controller.js`, `documents.js`, `author-notes.js`, `editor-tools.js` | Bind DOM to domain/services; do not implement independent applicability or dependency rules |
| Persistence adapters | `workspace-client.js`, `draft-store.js`, `release-store.js`, `browser-files.js` | Workspace identity on requests, browser-local recovery/history, download and hashing |
| Server tools | `lib/workspace-tools.js` | Model config, bounded plaintext search, source provenance and image IO; receives the current root and existing IO/response helpers from the authenticated router |
| HTTP and Git boundaries | `lib/api-router.js`, `lib/http-utils.js`, `lib/git-service.js` | Shared request guard and API dispatch, bounded JSON/response helpers, and repository/branch/Git baseline operations |

`app.js` creates the `DitaApp` facade, assembles controllers and owns remaining navigation, inspector/table actions and DOM bindings. `editor-controller.js` owns document history, modes, Topic/Map synchronization and review coordination. `editor-tools.js` owns Author selection formatting, body find/replace, structural insertion and explicit Source find/insertion; `author-selection.js` owns guarded ranges and detached-clone commits. The current entry point is 971 lines, down from 1,233 before this tool extraction; `server.js` remains 389 lines. These counts describe boundaries, not total application complexity. Independent controllers still use the existing facade and domain contracts.

## Assembly and lifecycle

`createEditorController(A, views)` receives the existing document state, workspace client, source rules and event bus through the application facade. View callbacks (`renderTabs`, `renderOutline`, `renderInspector`, `updateTree`, `refreshChrome`) and optional before/after mode-change hooks are injected by the entry point; the coordinator does not discover or initialize the footnote or export controllers. It creates the Author conversion API and review controller once and returns edit/history/mode operations. The facade's `setFileContent` and `setMode` retain their existing contracts for save, notes, resources and future AI proposals. The coordinator discards pending Map refresh timers and advances its render generation on `workspace:willChange`, before new workspace state is adopted.

`createGitService({getRoot, repositoriesRoot, checkedResolve})` owns Git process execution, encoded HEAD contents, repository discovery and protected branch switching. It obtains the current root through a getter at operation time, so it cannot retain a previous repository after a switch. Multiple service instances can use independent roots. The service does not own HTTP responses or workspace tokens; existing real-path checks and the server's workspace lock still protect calls.

`createApiHandler({workspace, git, documents, maps, ...originOptions})` receives explicit service groups. Its live workspace getters supply the current root/token, and its common identity/origin check runs before all tool and document routes. `server.js` retains workspace construction/switch rollback, Map tree operations, static serving and the read/write lock. Its existing exports remain compatibility entry points for existing consumers/tests. The HTTP layer still uses the same 5 MiB body limit, XML validation, expected-content conflicts, create-only behavior and response shapes.

The remaining application facade and explicit browser script order are intentional compatibility boundaries in this round. No framework, package, database, new network endpoint or document syntax is introduced. Future changes can move the remaining inspector/tools and Map domain functions when their own requirements warrant it.

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

133 unit/HTTP checks and 64 Chromium checks cover editor/review/export behavior and the model, draft, search, upload, save-scope and delivery workflows. Added boundary checks cover independent Git service instances, live repository roots, real repository switches with stale-tab rejection, Map child undo/review identity and disposal of pending Map refreshes. Real company documentation was not accessible; integration uses the fictional MQTT fixture. Existing supported/unsupported DITA boundaries remain documented in `publication-compatibility.md`.

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

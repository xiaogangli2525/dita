# Workspace architecture

The application remains a local Node server and buildless browser client. This change extracts domain logic and feature controllers instead of replacing the framework or rewriting the source-preserving editor. New features have explicit boundaries; the existing XML/encoding, conflict checks, review behavior and undo model remain shared.

## Boundaries

| Layer | Modules | Responsibility |
| --- | --- | --- |
| XML and document state | `xml-source.js`, `document-store.js`, `lib/document-files.js` | Source ranges/validation, undo and acknowledgements, encoding, real-path containment and atomic writes |
| Shared domain | `manual-core.js`, `footnotes-core.js`, `publication-core.js`, `publication-resolver.js` | Versioned model configuration, applicability, source edits, reuse resolution and publication preparation |
| Manual service | `manual-service.js` | Freeze buffers, resolve a Map or Topic and its direct local dependencies, check snapshot identity and provide save/note/publication views of that same scope |
| Editor/rendering | `app-core.js`, `delivery-core.js`, `diff-core.js` | Author/source conversion, stateless HTML/Markdown rendering, and pure diff algorithms respectively |
| Feature controllers | `save.js`, `drafts.js`, `project.js`, `search.js`, `resources.js`, `export.js`, `map-controller.js`, `documents.js` | Bind DOM to domain/services; do not implement independent applicability or dependency rules |
| Persistence adapters | `workspace-client.js`, `draft-store.js`, `release-store.js`, `browser-files.js` | Workspace identity on requests, browser-local recovery/history, download and hashing |
| Server tools | `lib/workspace-tools.js` | Model config, bounded plaintext search, source provenance and image IO; receives the current root and existing IO/response helpers from the authenticated router |

`app.js` is the composition root and legacy editor UI coordinator. It creates one `DitaApp` facade, injects it into controllers and connects established editor operations. `app-core.js` fell from 1,800 to 842 lines; `app.js` fell from 1,931 to 1,593. Line counts describe extraction, not an architecture score. The remaining editor-specific UI can be split further when a concrete change requires it.

The browser uses explicit script order and namespaced factories. Node tests import the same domain modules via CommonJS. There are no new runtime package dependencies or build requirements.

## Shared manual contract

`createManualService(A)` exposes:

- `capture(path)`: capture workspace/root/branch, project config, current buffers and the Map/Topic dependency closure before further interaction.
- `current(snapshot)`: reject changes to workspace, relevant buffers, their disk acknowledgements, open-file identity or project configuration.
- `prepare(snapshot, model)`: validate registered model names and create the publication copy without modifying source buffers.
- `listNotes(snapshot, model)`: use the publication note set and its recorded source origins. Source notes stay editable even when a registry typo needs correction.
- `saveCandidates(snapshot)`: return dirty opened files in this explicit scope, including referenced resources and excluding unrelated opened documents.

The note panel lists publishable note definitions/occurrences with the same ancestor conditions as delivery. Repeated references to one definition share one publishing entry. Reused notes navigate/edit the original source; local conditions on including elements still apply. The save controller shows the file list for a Map, requires a user selection and writes frozen snapshots through the existing optimistic save coordinator. Unselected/newer edits stay dirty. A batch is validated before its first write, but is not a filesystem transaction; partial failures report the count saved.

## UI events

`manual-core.createEvents()` supplies a small event boundary. Controllers can subscribe without being called directly from every editor action. An auxiliary listener failure is isolated so it cannot stop other document listeners.

| Event | Emitted for | Consumers |
| --- | --- | --- |
| `document:changed` | Edit, undo/redo, or save acknowledgement | Draft backup and active content-search refresh |
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

121 unit/HTTP checks and 22 Chromium checks cover existing editor/review/export behavior and the new model, draft, search, upload, save-scope and delivery workflows. Real company documentation was not accessible; integration uses the fictional MQTT fixture. Existing supported/unsupported DITA boundaries remain documented in `publication-compatibility.md`.

Repository search scans at most 2,000 documents / 10 MiB per request, skips files above 1 MiB and returns at most 100 hits (30 per file), with truncation/warning indicators. It decodes actual XML text and entities, maps hits back to source ranges and overlays unsaved buffers in the client. This is bounded on-demand search, not a persistent large-corpus index. Draft and release storage is limited to the current browser and is not a backup service or server-side release archive.

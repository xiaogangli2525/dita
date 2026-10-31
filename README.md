# DITA Lite Client

A lightweight local web client for reading, editing, reviewing, and exporting DITA documents.

## Quick Start

```bash
npm install
npm start          # starts on http://127.0.0.1:5050
npm test           # unit and HTTP workflow regression tests
npm run dev        # disposable sample workspace for trying the UI
```

Requires **Node.js 20+** and **Git**. `npm start` edits the repository configured by `DOCS_ROOT`; `npm run dev` uses temporary sample documents and deletes them when the demo stops.

## Dependencies

- **iconv-lite** — used for GBK/GB2312/GB18030 encoding round-trip. DITA files
  with encoding="GBK" are read via TextDecoder and written back via
  iconv-lite.encode() so Chinese text is preserved on save. Without this
  dependency, GBK files would be silently converted to UTF-8 and corrupted.

The browser and server share a vendored copy of **sax 1.6.1** for XML validation. Its source, license and provenance are in `public/vendor/`. External DTDs/entities are not loaded.

## Key Features

- Author mode: visual editing with Oxygen tracked-change support
- Reading mode: read-only Topic and Map surfaces sharing the Author renderer
- Review mode: side-by-side diff with accept/reject per change block
- Map view: edit entire ditamap with all referenced topics
- HTML export: single-file HTML with embedded images, TOC, notes
- Markdown export: DITA to Markdown with syntax-highlighted preview
- Image path resolution: resolves relative hrefs against topic directory
- GBK encoding: preserves declared encoding on save
- Reliability: conflict-aware atomic saves, protected branch switching, stale-tab rejection
- Security: Origin validation, real-path containment, asset whitelist, streaming body limit
- Export includes current working buffers; local images are embedded in HTML and Markdown
- Map structure operations are undoable edits; use Save to write them to disk
- Manual saves show an explicit selection of changed Topics and referenced resources
- Recoverable browser drafts with repository/branch isolation and disk-base conflict checks
- Project model registry, explicit confirmed-common notes, and source editing for reused notes
- Cross-Topic plaintext search including unsaved buffers, plus image/Topic-link pickers
- Unified delivery preflight, version/model selection and downloadable provenance records

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| PORT | 5050 | Server port |
| HOST | 127.0.0.1 | Bind address |
| DOCS_ROOT | ../repo_ml353a | Default DITA repository root |
| REPOSITORIES_ROOT | parent of DOCS_ROOT | Allowed repo switching scope |


![DITA workspace](docs/assets/workspace-preview.jpg)

## Workflow and architecture

The light workspace separates document navigation, editing and the attribute/review panel. Advanced editing tools are grouped in a dropdown; narrow screens use navigation and inspector drawers.

- `public/document-store.js`: shared document mutations, undo/redo, save coordination and edit proposals.
- `public/xml-source.js`: shared browser/server XML validation and source-preserving formatting.
- `public/review.js`: Git/Oxygen review controller, with explicit bulk-operation scope.
- `lib/xml-tree.js`: server XML tree parsing and serialization.
- `public/workspace-client.js`: workspace identity and stale-response handling.
- `public/export.js`: export snapshots, resource loading and preview/download orchestration.
- `public/publication-core.js`: shared source-preserving model-footnote filtering and reference validation for both publication formats.
- `public/publication-resolver.js`: bounded local dependency loading, common conref expansion and unsupported-feature checks.
- `public/app-core.js`: source-preserving Author rendering/conversion.
- `public/delivery-core.js` / `public/diff-core.js`: publication rendering and pure diff algorithms.
- `public/manual-core.js` / `public/manual-service.js`: shared applicability/configuration and immutable manual dependency snapshots.
- `public/save.js`, `drafts.js`, `project.js`, `search.js`, `resources.js`: independent feature controllers.
- `public/map-controller.js` / `public/documents.js`: directory and document lifecycle UI.
- `lib/workspace-tools.js`: authenticated project config, search, provenance and image routes.
- `lib/document-files.js`: encoding, real-path containment and atomic file writes.
- `lib/workspace-lock.js`: concurrent reads with exclusive saves/workspace switches.

Branch switching refuses a dirty Git worktree, including changes already saved by the editor. Commit or stash those changes with Git first. A failed save never intentionally replaces newer working text; download your working copy before reopening a file with a disk conflict.

The HTTP API requires the `workspaceToken` returned by `/api/workspace` in the `x-workspace-token` header for document operations. Updates also require `expectedContent`, the last-read disk content. This is a local single-workspace application, not a shared multi-user server. `PUBLIC_ORIGIN` can explicitly allow a trusted reverse-proxy origin; default access remains localhost.

See [architecture and extension boundaries](docs/architecture.md), [verification](docs/verification.md) and the [AI authoring integration plan](docs/ai-editing.md). AI proposal primitives are implemented; no AI provider or generation UI is connected yet.

## Editing and review behavior

Reading is read-only. Git worktree changes and Oxygen tracked changes have separate bulk-action scopes. Both individual and bulk review actions remain in the editor until explicit Save; neither changes the committed Git comparison baseline. Undo/redo also restores review decisions. Save As and XML Download are available in the File menu.

XML validation is shared by browser and HTTP writes. It checks XML syntax, not full DITA DTD/schema conformance or cross-document references. Custom DTD entity expansion is not supported. Formatting only adjusts whitespace in known structural containers, preserving mixed text, code/pre content, xml:space, declarations, comments, processing instructions and declared encoding.

Run browser regression tests with `npx playwright-core install chromium` followed by `npm run test:browser`. `DITA_CHROMIUM_EXECUTABLE` optionally selects an installed Chromium binary. CI runs unit/API tests on Node 20/22 and browser tests on Node 22.

## Model footnotes

Click **型号注脚** while a Topic or function Map is open. The panel indexes actual `fn` elements, shows their surrounding command/context and supports model/keyword filtering, source navigation and editing. A Map scope stays selected while navigating to its individual Topics.

Explicit model associations are stored in each footnote's standard `product` attribute (space-separated model names). Existing prose is never used to infer support. Unlabelled footnotes remain visible under every panel filter. Publication also evaluates product conditions on Topic ancestors. The panel and delivery use the same applicability and dependency rules. Use **交付…** to select the publication model and format.

Plain notes use a text editor with safe XML escaping; notes with inline markup use an XML-preserving editor. Updates retain identifiers, links, encoding declarations and surrounding source, use the shared undo history and require explicit Save. Outdated edits are refused. Reused footnotes offer **编辑引用源** and keep their including conditions visible. HTML exports include a linked footnote list with return links; Markdown includes complete numbered footnote definitions.

`npm run dev` opens an isolated MQTT demonstration with fictional M100/M200/M300 models. Open `main.ditamap`, click **型号注脚**, choose M100 and try editing or locating a note. All product limits/commands in this demo are illustrative.

### Publish a function manual for a model

Open the function's Map, then choose **交付…**. Select a model and HTML or Markdown, inspect the included/excluded/unlabelled counts, then preview or download. The current Map and Topic buffers are captured without saving or changing the source; changing an opened buffer invalidates the settings and requires reopening them. Each function Map remains a separate delivery. Existing ordinary exports include all models.

```xml
<p>Connection limit<fn product="M100">Up to two connections.</fn></p>
<p>Shared limit<fn product="M100 M200">Check the firmware release notes.</fn></p>
```

Publication evaluates `product` on the footnote and its Topic ancestors. A note must match every applicable ancestor condition; a child cannot restore a note excluded by its parent. Notes with no conditions are retained, and body content is retained. This is footnote-scoped publication, not a complete DITA conditional-processing pipeline. Grouped product expressions and Map-level profiling stop model export explicitly.

An `fn` with an `id` is a reusable definition. Reference it with `xref type="fn"`; unreferenced definitions are omitted, repeated references share one number, and HTML callouts link to one footnote entry and back. The MQTT publishing sample demonstrates repeated references:

```xml
<p>First mention<xref href="#topic-id/note-id" type="fn"/>.</p>
<p>Second mention<xref href="#topic-id/note-id" type="fn"/>.</p>
<fn id="note-id" product="M100">Model-specific detail.</fn>
```

Footnote references may target another local workspace file, including a resource file outside the published Map. Repeated references share one definition and number across chapters. Local same-element `conref` chains are expanded in the publication copy, keeping local attributes/IDs and rebasing relative image paths. Dependency reads include current unsaved buffers and participate in stale-snapshot checks. Resource-only Map references supply reusable content without adding chapters. HTML and Markdown use the same prepared publication snapshot and filtering rules.

Local DITA links are rewritten to explicit document anchors. Missing targets stop export. CALS column/row spans are retained in HTML; Markdown rejects merged cells explicitly instead of flattening them into misleading columns. Simple tables and footnotes in tables/lists use the same publication context. See [compatibility verification and supported boundaries](docs/publication-compatibility.md).

![Model footnotes workspace](docs/assets/model-footnotes-preview.png)

## Workspace foundation

Use **型号清单** to maintain allowed names in the current repository's optional `.dita-project.json`. Confirm a universally applicable footnote explicitly; an empty model field alone remains unresolved and retained. The standard metadata marker `otherprops="applicability(common)"` records confirmation without turning an inline note into an ID-bearing definition.

Saving a Map lists dirty files in its direct local dependency scope. Select the files to persist; unrelated and unselected edits stay in the workspace. Multi-file saves remain non-transactional and report partial failures. Draft recovery preserves the exact disk base, is isolated by repository and branch, and never overwrites a changed disk file automatically. Drafts and delivery records live in the current browser.

The sidebar offers repository/manual plaintext search with exact source navigation; current dirty buffers override disk hits. Insert **image** or **xref** through the resource picker to choose files/sections and generate relative paths. Uploaded images are create-only and limited to 2 MiB.

**交付…** combines model/format/version selection, issue navigation, image/link preflight and preview/download. Cancel stops pending delivery. Downloads are announced as initiated; use browser download history to find them. **交付记录** stores up to 50 local provenance records per repository and can download their JSON for separate archiving. XML source/draft downloads normalize their declarations to the browser's UTF-8 bytes; encoded filesystem saves continue to preserve the declared encoding.

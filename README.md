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
- `public/app-core.js`: Author rendering, source conversion, diff algorithms and HTML/Markdown export.
- `lib/document-files.js`: encoding, real-path containment and atomic file writes.
- `lib/workspace-lock.js`: concurrent reads with exclusive saves/workspace switches.

Branch switching refuses a dirty Git worktree, including changes already saved by the editor. Commit or stash those changes with Git first. A failed save never intentionally replaces newer working text; download your working copy before reopening a file with a disk conflict.

The HTTP API requires the `workspaceToken` returned by `/api/workspace` in the `x-workspace-token` header for document operations. Updates also require `expectedContent`, the last-read disk content. This is a local single-workspace application, not a shared multi-user server. `PUBLIC_ORIGIN` can explicitly allow a trusted reverse-proxy origin; default access remains localhost.

See [verification](docs/verification.md) and the [AI authoring integration plan](docs/ai-editing.md). AI proposal primitives are implemented; no AI provider or generation UI is connected yet.

## Editing and review behavior

Reading is read-only. Git worktree changes and Oxygen tracked changes have separate bulk-action scopes. Both individual and bulk review actions remain in the editor until explicit Save; neither changes the committed Git comparison baseline. Undo/redo also restores review decisions. Save As and XML Download are available in the File menu.

XML validation is shared by browser and HTTP writes. It checks XML syntax, not full DITA DTD/schema conformance or cross-document references. Custom DTD entity expansion is not supported. Formatting only adjusts whitespace in known structural containers, preserving mixed text, code/pre content, xml:space, declarations, comments, processing instructions and declared encoding.

Run browser regression tests with `npx playwright-core install chromium` followed by `npm run test:browser`. `DITA_CHROMIUM_EXECUTABLE` optionally selects an installed Chromium binary. CI runs unit/API tests on Node 20/22 and browser tests on Node 22.

# AI-assisted authoring: integration boundary

This change prepares the document-editing boundary; it does **not** call an AI provider, send document content externally, or store API keys. The current UI remains a local document editor. A provider and model can be selected in a follow-up implementation.

## The workflow to build next

1. The user chooses a task (draft a topic, rewrite a selection, explain or summarize) and explicitly selects the source documents to include.
2. Capture the workspace token, document path and exact working content **before** starting the model request. For drafts, create a new unsaved document model instead of overwriting an existing topic.
3. Call a provider adapter on the server. Credentials come from server environment variables; they never enter browser code or Git. Keep provider configuration separate from the XML/domain logic.
4. Receive a candidate full XML document. Validate XML well-formedness, constrain the intended DITA root/type and required identifiers, and show a diff against the captured source. XML well-formedness alone is not DITA schema validation.
5. Apply only after the user accepts the proposal, and only if the workspace and working document still match its captured base. Reject stale proposals and offer regeneration or a deliberate merge.
6. Apply through `setFileContent`, preserving the existing undo history. The proposal does not save to disk or commit to Git. Explicit Save uses the same optimistic conflict checks as human edits.

## Implemented interfaces

`public/document-store.js` exports:

- `createSaveCoordinator(send)`: deduplicates in-flight saves per document. Advances `disk` to the acknowledged content while preserving newer `current` edits.
- `createProposal({file, workspaceToken, content, instruction}, validate)`: creates an immutable proposal with `before`, `after`, `path`, `workspaceToken`, and `status`.
- `applyProposal(proposal, {file, workspaceToken}, validate, commit)`: checks the workspace/path/base, revalidates the candidate, and delegates an undoable change to the editor.

The browser exposes `DitaApp.prepareProposal(content, instruction)` and `DitaApp.applyProposal(proposal)` for a future review controller. These are integration primitives, not a completed AI panel. A future async provider controller **must capture `file.current` and workspace identity at request start**, construct its proposal against that snapshot, and retain that proposal through review. Calling `prepareProposal` only after a delayed generation would incorrectly use the newest buffer as its base.

Example without a provider dependency:

```js
const fileSnapshot = { path: file.path, current: file.current };
const tokenSnapshot = workspaceClient.token;
const content = await provider.generate({ instruction, xml: fileSnapshot.current });
const proposal = DitaDocumentStore.createProposal({
  file: fileSnapshot,
  workspaceToken: tokenSnapshot,
  content,
  instruction
}, validateXml);
// Display lineDiff(proposal.before, proposal.after), wait for explicit acceptance.
DitaApp.applyProposal(proposal);
```

The next UI should support cancel generation, pending/failed states, a visible scope summary, and accept/reject without auto-saving. Unselected documents and repository secrets should not be collected automatically. Treat instructions embedded in source documents as document content, not provider/system instructions.

## Current boundaries and remaining work

- `baseline` is the committed Git comparison source; `disk` is the last acknowledged disk version; `current` is the working edit. AI review should compare against the captured working source, not against Git HEAD.
- The server remains a **single local workspace**. Multiple tabs share the repository/branch; workspace tokens reject stale-tab requests after a switch. This is not a multi-user collaboration service.
- File saves use same-directory temporary writes and rename, plus a comparison with the caller's last-read content. An external program can still race between comparison and rename; no cross-process filesystem transaction is claimed.
- Map saves validate the batch before writing but are not multi-file transactions. If a later write fails, the UI reports the count already saved and preserves the remaining dirty buffers.
- Real model integration still needs provider credentials/configuration, cancellation, request limits, a review panel, DITA-level validation, and provider-contract tests.

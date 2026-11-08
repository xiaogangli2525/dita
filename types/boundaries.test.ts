import { createDocument, snapshotDocument, createSaveCoordinator, createProposal, applyProposal } from '../public/document-store';
import { createSnapshot } from '../public/snapshot-data';
import { createRecord } from '../public/delivery-data';
import type { ManualSnapshot, CompiledDelivery, WorkspaceState, HistoryMeta } from '../public/data-contracts';
const reviewHistory: HistoryMeta = { reviewDecisionsBefore: new Map<number | string, string>([[1, 'accept'], ['topics/a.dita::1', 'reject']]) };
// @ts-expect-error Review decisions captured in history are read-only.
reviewHistory.reviewDecisionsBefore?.set(2, 'accept');
const file = createDocument({ path: 'a.dita', content: '<topic/>' });
const snapshot = snapshotDocument(file);
// @ts-expect-error Captured buffers cannot be edited.
snapshot.current = '<changed/>';
// @ts-expect-error A save response must contain XML text, not a boolean.
createSaveCoordinator(async () => ({ content: false }));
// @ts-expect-error Optimistic saving requires the exact disk comparison content.
createSaveCoordinator(async request => ({ content: request.content }))(file, { path: file.path, content: file.current });
const proposal = createProposal({ file, workspaceToken: 'w', content: '<next/>' }, () => {});
// @ts-expect-error Proposals are immutable values.
proposal.after = '<changed/>';
// @ts-expect-error A proposal status cannot be invented.
applyProposal({ ...proposal, status: 'accepted' }, { file, workspaceToken: 'w' }, () => {}, () => {});
declare const manual: ManualSnapshot;
createSnapshot(manual);
// @ts-expect-error Dependencies are read-only snapshot data.
manual.files.set('b.dita', { path: 'b.dita', current: '<topic/>' });
// @ts-expect-error Project model lists are detached read-only values.
manual.project.models.push('M100');
// @ts-expect-error A manual capture needs its workspace identity.
createSnapshot({ ...manual, workspace: 123 });
declare const data: CompiledDelivery;
const request = { snapshot: manual, source: {}, data, model: '', version: '', filename: 'manual.html', prefixes: false, unsavedPaths: [] };
createRecord({ ...request, format: 'html' }, async () => 'hash');
// @ts-expect-error Supported delivery formats form a closed contract.
createRecord({ ...request, format: 'word' }, async () => 'hash');
// @ts-expect-error Delivery bytes must be text or a Blob.
createRecord({ ...request, format: 'pdf', data: { ...data, output: 42 } }, async () => 'hash');

declare const workspace: WorkspaceState;
// @ts-expect-error Workspace identity changes through session operations.
workspace.root = '/other';
// @ts-expect-error The document registry is a read-only view.
workspace.filesMap.clear();

import type { DocumentState, HistoryMeta, ReviewDecision, ReviewKey, WorkspaceState } from './data-contracts';
export interface DiffRow { type: 'same' | 'old' | 'new'; text: string; oldIndex?: number; newIndex?: number }
export interface DiffGroup { type: 'same' | 'changed'; rows: DiffRow[]; topicPath?: string }
export interface ReviewSnapshot { baseline: string; current: string; decisions: Map<number, ReviewDecision> }
export interface StoredReview { schema: 1; baseline: string; current: string; decisions: [number, ReviewDecision][] }
export interface ReviewScope { readonly root: string; readonly currentBranch: string }
export interface ReviewUIState {
  reviewGroups: Map<ReviewKey, DiffGroup>; reviewDecisions: Map<ReviewKey, ReviewDecision>;
  reviewPath: string; reviewBaseline: string; reviewCurrent: string;
}
export type ReviewState = ReviewUIState & Pick<WorkspaceState, 'root' | 'currentBranch' | 'activePath' | 'filesMap'>;
export interface ReviewFrame {
  readonly file: DocumentState; readonly inManual: boolean; readonly rootPath: string;
  readonly root: string; readonly branch: string; readonly baseline: string; readonly current: string;
  readonly keyFor: (index: number) => ReviewKey;
}
export interface ReviewStorage {
  getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void;
}
export interface ReviewProgress {
  restore(scope: ReviewScope, file: Pick<DocumentState, 'path' | 'baseline' | 'current'>): ReviewSnapshot;
  save(scope: ReviewScope, file: Pick<DocumentState, 'path'>, baseline: string, current: string, decisions: ReadonlyMap<number, ReviewDecision>): void;
  readonly warning: string;
}
export type ReviewWriter = (file: DocumentState, content: string, options: { historyMeta: HistoryMeta }) => boolean;

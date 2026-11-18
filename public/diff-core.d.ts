import type { ReviewDecision } from './data-contracts';
import type { DiffRow, DiffGroup } from './review-contracts';
export function lineDiff(baseline: string, current: string): DiffRow[];
export function inlineDiff(baseline: string, current: string): { type: 'same' | 'old' | 'new'; text: string }[];
export function groupDiffRows(rows: readonly DiffRow[], contextSize?: number): DiffGroup[];
export function applyDiffGroups(baseline: string, current: string, decisions: ReadonlyMap<number, ReviewDecision>, contextSize?: number, unreviewed?: ReviewDecision): string;

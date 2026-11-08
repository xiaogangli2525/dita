import type { AiTarget, AiResult, AiAppliedResult } from './ai-contracts';
export const LIMITS: Readonly<{ source: number; text: number; instruction: number; edits: number }>;
export function target(source: string, start: number, end: number): AiTarget;
export function documentTarget(source: string, query?: string): AiTarget;
export function inspect(source: string): { start: number; end: number; xmlPath: string; kind: string; conditions: string[]; node: unknown }[];
export function candidates(source: string, query?: string): { start: number; end: number; xmlPath: string; text: string; kind: string; score: number }[];
export function applyResult(scope: AiTarget, result: AiResult): AiAppliedResult;

export interface AiTextPart {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly kind: 'text' | 'cdata';
}
export interface AiTarget {
  readonly source: string;
  readonly start: number;
  readonly end: number;
  readonly xmlPath: string;
  readonly kind: string;
  readonly conditions: readonly string[];
  readonly text: string;
  readonly parts: readonly AiTextPart[];
}
export interface AiEdit { id: string; before: string; after: string }
export interface AiResult { summary: string; questions: string[]; edits: AiEdit[] }
export interface AiRequest { source: string; start: number; end: number; instruction: string; targetModel?: string }
export interface AiConfiguration { available: boolean; model: string; destination: string; message: string; baseUrl: string; keyConfigured: boolean }
export interface AiAppliedResult {
  content: string;
  summary: string;
  questions: string[];
  changes: (AiTextPart & { after: string })[];
}

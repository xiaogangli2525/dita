export interface AiTextPart {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly kind: 'text' | 'cdata';
  readonly conditions?: readonly string[];
  readonly blockKind?: string;
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
  readonly query?: string;
  readonly truncated?: boolean;
}
export interface AiEdit { id: string; before: string; after: string }
export interface AiResult { readonly summary: string; readonly questions: readonly string[]; readonly edits: readonly AiEdit[]; readonly blockedReason?: string }
export interface AiConversation { readonly instructions: readonly string[]; readonly previousResult?: AiResult }
export interface AiTurn { readonly instruction: string; readonly result: AiResult }
export interface AiRequest { source: string; start: number; end: number; instruction: string; targetModel?: string; conversation?: AiConversation; targetKind?: 'document' | 'range'; query?: string }
export interface AiConfiguration { available: boolean; model: string; destination: string; message: string; baseUrl: string; keyConfigured: boolean; rulesVersion: string }
export interface AiAppliedResult {
  content: string;
  summary: string;
  questions: string[];
  blockedReason: string;
  changes: (AiTextPart & { after: string; reviewFlags: string[] })[];
}

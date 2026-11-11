import type { DeliveryReport } from './data-contracts';
export interface KnowledgeEntry { readonly anchor: string; readonly title: string; readonly text: string }
export interface SearchRecord { readonly title: string; readonly text: string; readonly manualId: string; readonly manualTitle?: string }
export interface SearchIndex { readonly schema: 1; readonly postings: Record<string, number[]> }
export interface KnowledgeSource {
  readonly repository: string; readonly branch: string; readonly commit: string | null; readonly dirty: boolean | null;
  readonly manualPath: string; readonly documents: readonly { readonly path: string; readonly sha256: string }[];
  readonly filterPath: string; readonly filterSha256: string | null; readonly projectSha256: string | null;
  readonly noteRulesSha256: string | null; readonly modelNotePolicy: 'explicit-prefix-v1' | 'sidecar-only';
}
export interface KnowledgeManual {
  readonly id: string; readonly model: string; readonly title: string; readonly version: string; readonly capturedAt: string;
  readonly html: string; readonly htmlSha256: string; readonly body: string;
  readonly toc: readonly { readonly anchor: string; readonly title: string }[]; readonly entries: readonly KnowledgeEntry[];
  readonly source: KnowledgeSource; readonly report: DeliveryReport & { readonly oxygenRevisions?: number };
}
export type KnowledgeBookManual = Pick<KnowledgeManual, 'id' | 'title' | 'version' | 'body' | 'toc' | 'entries'> & {
  readonly source: Pick<KnowledgeSource, 'repository' | 'commit' | 'dirty'>;
};
export interface KnowledgeBook {
  readonly schema: 1; readonly title: string; readonly model: string; readonly sdkVersion: string; readonly generatedAt: string;
  readonly manuals: readonly KnowledgeBookManual[];
  index: SearchIndex;
}
export interface KnowledgeRequest { readonly title: string; readonly model: string; readonly sdkVersion: string;
  readonly manuals: readonly KnowledgeManual[]; readonly generatedAt?: string }
export interface ArchiveFile { readonly name: string; readonly content: string | Uint8Array<ArrayBuffer> }

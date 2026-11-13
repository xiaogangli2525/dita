import type { DeliveryReport } from './data-contracts';
export interface KnowledgeEntry { readonly anchor: string; readonly title: string; readonly text: string;
  readonly sourcePath?: string; readonly fingerprint?: string; readonly kind?: string; readonly aliases?: readonly string[];
  readonly symbols?: readonly string[]; readonly definedSymbols?: readonly string[] }
export interface SearchRecord { readonly title: string; readonly text: string; readonly manualId: string; readonly manualTitle?: string;
  readonly anchor?: string; readonly kind?: string; readonly mode?: string; readonly module?: string;
  readonly aliases?: readonly string[]; readonly symbols?: readonly string[]; readonly definedSymbols?: readonly string[] }
export interface SearchIndex { readonly schema: 2; readonly compiled: object }
export interface EntryOverride { readonly fingerprint: string; readonly kind: string; readonly aliases: readonly string[]; readonly definedSymbols: readonly string[] }
export interface KnowledgeRecipe {
  readonly revision?: string; readonly repositoryRoot: string; readonly repository: string; readonly branch: string; readonly path: string; readonly title: string;
  readonly version: string; readonly filterPath: string; readonly prefixes: boolean; readonly mode: 'OC'|'AT'|'other'; readonly module: string;
  readonly overrides: Readonly<Record<string, EntryOverride>>; readonly previous?: { readonly htmlSha256: string; readonly capturedAt: string };
}
export interface KnowledgePlan { readonly schema: 1; readonly id: string; readonly title: string; readonly model: string;
  readonly sdkVersion: string; readonly sources: readonly KnowledgeRecipe[] }
export interface KnowledgeSource {
  readonly revision?: string; readonly assets?: readonly {readonly path:string; readonly sha256:string|null}[]; readonly repository: string; readonly branch: string; readonly commit: string | null; readonly dirty: boolean | null;
  readonly manualPath: string; readonly documents: readonly { readonly path: string; readonly sha256: string }[];
  readonly filterPath: string; readonly filterSha256: string | null; readonly projectSha256: string | null;
  readonly noteRulesSha256: string | null; readonly modelNotePolicy: 'explicit-prefix-v1' | 'sidecar-only';
}
export interface KnowledgeManual {
  readonly id: string; readonly model: string; readonly title: string; readonly version: string; readonly capturedAt: string;
  readonly mode?: string; readonly module?: string; readonly staleMetadata?: readonly string[];
  readonly html: string; readonly htmlSha256: string; readonly body: string;
  readonly toc: readonly { readonly anchor: string; readonly title: string }[]; readonly entries: readonly KnowledgeEntry[];
  readonly source: KnowledgeSource; readonly report: DeliveryReport & { readonly oxygenRevisions?: number };
}
export type KnowledgeBookManual = Pick<KnowledgeManual, 'id' | 'title' | 'version' | 'body' | 'toc' | 'entries' | 'mode' | 'module'> & {
  readonly source: Pick<KnowledgeSource, 'repository' | 'commit' | 'dirty'>;
};
export interface KnowledgeBook {
  readonly schema: 1; readonly title: string; readonly model: string; readonly sdkVersion: string; readonly generatedAt: string;
  readonly manuals: readonly KnowledgeBookManual[];
  index: SearchIndex;
}
export interface KnowledgeRequest { readonly title: string; readonly model: string; readonly sdkVersion: string;
  readonly manuals: readonly KnowledgeManual[]; readonly generatedAt?: string; readonly semantic?: import('./knowledge-semantic').SemanticIndex }
export interface ArchiveFile { readonly name: string; readonly content: string | Uint8Array<ArrayBuffer> }

export interface KnowledgeReceipt { readonly repositoryRoot: string; readonly branch: string; readonly revision: string; readonly commit: string;
  readonly files: readonly {readonly path: string; readonly sha256: string|null}[] }
export interface KnowledgeBundle { readonly schema: 1;
  readonly snapshot: Omit<import('./data-contracts').ManualSnapshot,'files'|'buffers'> & {readonly files: readonly (readonly [string,import('./data-contracts').FileContent])[];readonly buffers:readonly []};
  readonly texts: readonly (readonly [string,string])[]; readonly assets: readonly (readonly [string,string])[];
  readonly provenance: {readonly commit:string;readonly branch:string;readonly dirty:boolean};readonly receipt:KnowledgeReceipt }

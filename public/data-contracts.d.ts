/** Checked data exchanged by editing, capture, save and delivery boundaries. */
export type EditorMode = 'editor' | 'visual' | 'preview' | 'review';
export type ReviewDecision = 'accept' | 'reject';
export type ReviewKey = number | string;
export interface DocumentState {
  path: string; current: string; disk: string; baseline: string; gitStatus: string; dirty: boolean;
  history?: DocumentHistory;
}
export type DocumentSnapshot = Readonly<Omit<DocumentState, 'history'>>;
export interface HistoryGroup { key: string; time?: number; composition?: boolean; beforeCursor?: string; afterCursor?: string }
export interface HistoryMeta {
  selectionBefore?: unknown; selectionAfter?: unknown; mapTitle?: boolean;
  reviewDecisionsBefore?: ReadonlyMap<ReviewKey, ReviewDecision>; reviewDecisionsAfter?: ReadonlyMap<ReviewKey, ReviewDecision>;
  reviewInManual?: boolean;
}
export interface HistoryEntry extends HistoryMeta { before: string; after: string; group?: HistoryGroup }
export interface DocumentHistory { undo: HistoryEntry[]; redo: HistoryEntry[]; openGroup?: HistoryEntry | null }
export interface SaveRequest { readonly path: string; readonly content: string; readonly expectedContent: string }
export interface SaveAcknowledgement { content: string; path?: string; created?: boolean }
export interface SaveResult extends SaveAcknowledgement { clean: boolean }
export interface Proposal { readonly path: string; readonly workspaceToken: string; readonly before: string;
  readonly after: string; readonly instruction: string; readonly status: 'pending' | 'applied' }
export type PendingProposal = Proposal & { readonly status: 'pending' };
export type AppliedProposal = Proposal & { readonly status: 'applied' };
export interface FileContent { readonly path: string; readonly current: string }
export interface MapEntry { readonly path: string; readonly type?: string; readonly title?: string; readonly name?: string;
  readonly source?: string; readonly sourcePath?: string; readonly href?: string; readonly processingRole?: string; readonly children?: readonly MapEntry[] }
export interface ProjectConfig { readonly schema: 1; readonly models: readonly string[] }
export interface NoteDecision { readonly scope: 'common' | 'models'; readonly models: readonly string[] }
export interface NoteRule { readonly path: string; readonly xmlPath: string; readonly expectedNote: string;
  readonly expectedContext: string; readonly expectedConditions: readonly string[]; readonly confirmed: true; readonly decisions: readonly NoteDecision[] }
export interface NoteRulesSnapshot { readonly config: { readonly schema: 1; readonly rules: readonly NoteRule[] };
  readonly expectedContent: string | null; readonly supported: boolean; readonly error?: string }
export interface ManualSnapshot {
  readonly workspace: string; readonly root: string; readonly branch: string;
  readonly path: string; readonly content: string; readonly capturedAt: string; readonly map: MapEntry;
  readonly files: ReadonlyMap<string, FileContent>; readonly buffers: ReadonlyMap<string, DocumentSnapshot>;
  readonly project: ProjectConfig; readonly projectContent: string | null | undefined; readonly projectError?: string;
  readonly noteRules: NoteRulesSnapshot | null; readonly filter: FileContent | null;
}
/** Domain fields are getter-only at runtime. UI-only transient state stays controller-owned. */
export interface WorkspaceState {
  readonly root: string; readonly currentBranch: string; readonly activePath: string; readonly mode: EditorMode;
  readonly selectedMap: string; readonly selectedMapSourcePath: string; readonly historyTargetPath: string;
  readonly files: readonly MapEntry[]; readonly maps: readonly MapEntry[];
  readonly repositories: readonly { readonly path: string; readonly name: string }[];
  readonly branches: readonly { readonly name: string; readonly commit?: string }[];
  readonly filesMap: ReadonlyMap<string, DocumentState>; readonly mapAuthorPaths: ReadonlySet<string>;
  readonly capabilities: { readonly persistence: string; readonly git: boolean; readonly pdf?: boolean; readonly remoteGit?: boolean };
}
export interface CaptureContext { workspace: string; root: string; branch: string; project: ProjectConfig;
  projectContent: string | null | undefined; projectError?: string; buffers: ReadonlyMap<string, DocumentSnapshot> }
export interface CapturePorts {
  state: Pick<WorkspaceState, 'root' | 'currentBranch' | 'activePath' | 'selectedMap' | 'filesMap'> & { readonly maps?: readonly MapEntry[] };
  api: { readonly token: string; request(url: string, options?: RequestInit): Promise<Response>; error(response: Response): Promise<string> };
  project?: { readonly value: ProjectConfig; readonly error?: string; readonly expectedContent: string | null; ready?(): Promise<void> };
  noteRuleStore?: { current(rules: NoteRulesSnapshot | null): boolean; read(): Promise<NoteRulesSnapshot>; verify(rules: NoteRulesSnapshot | null): Promise<void> };
}
export type DeliveryFormat = 'html' | 'md' | 'pdf' | 'docx';
export interface DeliveryReport { model: string; included: number; excluded: number; unmarked: number; unused: number;
  filteredElements?: number; ruleApplied?: number; ruleFilteredParts?: number; prefixCandidates?: number;
  prefixApplied?: number; prefixExcluded?: number }
export interface DeliveryTemplateRecord { id: string; name: string; version: string; renderer: string; sha256: string; fields: Readonly<Record<string, string>> }
export interface CompiledDelivery { output: string | Blob; previewHtml: string; report: DeliveryReport; template?: DeliveryTemplateRecord | null }
export interface DeliverySource { commit?: string | null; branch?: string | null; dirty?: boolean | null; warning?: string }
export interface DeliveryRequest { snapshot: ManualSnapshot; source: DeliverySource; data: CompiledDelivery;
  model: string; format: DeliveryFormat; version: string; filename: string; prefixes: boolean; unsavedPaths: readonly string[] }
export interface DeliveryRecord { schema: 1; createdAt: string; state: 'download-initiated'; manualPath: string;
  model: string; format: DeliveryFormat; version: string; filename: string; source: DeliverySource; capturedAt: string;
  filterPath: string; modelNotePrefixPolicy: 'explicit-prefix-v1' | 'confirmed-rules-only'; unsavedPaths: readonly string[];
  report: DeliveryReport; documents: { path: string; sha256: string }[];
  projectSha256: string; noteRulesSha256: string | null; outputSha256: string; template: DeliveryTemplateRecord | null }
export interface SavePorts {
  state: CapturePorts['state'] & { readonly capabilities: { readonly persistence: string; readonly git: boolean } };
  api: CapturePorts['api'];
  manual: { capture(path: string): Promise<ManualSnapshot>; current(snapshot: ManualSnapshot): boolean;
    saveCandidates(snapshot: ManualSnapshot): readonly DocumentSnapshot[] };
  events: { emit(name: string, payload?: unknown): void }; saving: boolean;
  validateXml(xml: string): unknown; refreshChrome(): void; refreshFiles(): void;
  setStatus(message: string, error?: boolean): void; toast(message: string, level?: string): void;
}
export interface SaveElements {
  saveScopeDialog: HTMLDialogElement; saveScopeTitle: HTMLElement; saveScopeList: HTMLElement;
  saveScopeError: HTMLElement; saveScopeCancel: HTMLButtonElement; saveScopeForm: HTMLFormElement;
}

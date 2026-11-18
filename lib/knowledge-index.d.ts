import type { KnowledgeBookManual, SearchRecord, SemanticEstimate } from '../public/knowledge-contracts';
import type { SemanticIndex } from '../public/knowledge-semantic';
export type IndexManual = Pick<KnowledgeBookManual, 'id'|'title'|'entries'>;
export interface IndexBook { readonly model:string; readonly manuals:readonly IndexManual[]; readonly semantic?:SemanticIndex }
export interface IndexProgress { readonly stage?:'estimate'|'vectors'; readonly manual?:string; readonly position?:number; readonly totalManuals?:number; readonly done?:number; readonly total?:number; readonly source?:'generated'|'cache'|'embedded' }
export interface IndexOptions { readonly model?:string; readonly legacy?:boolean; readonly force?:boolean; readonly compact?:boolean; readonly signal?:AbortSignal; readonly seed?:SemanticIndex; readonly seeds?:readonly IndexBook[]; readonly onProgress?:(value:IndexProgress)=>void }
export interface IndexStats { readonly reusedManuals:number; readonly rebuiltManuals:number; readonly totalManuals:number; readonly totalChunks:number }
export interface IndexResult { readonly index:SemanticIndex; readonly stats:IndexStats; readonly warnings:readonly string[] }
export type IndexEstimate = SemanticEstimate;
export interface PublishOptions extends Pick<IndexOptions,'force'|'signal'|'onProgress'|'compact'> {
  readonly archiveOverhead:number;
  readonly onEstimate?:(estimate:IndexEstimate)=>void|Promise<void>;
  readonly onManual:(manual:{readonly manualId:string;readonly index:SemanticIndex;readonly source:'cache'|'generated'})=>void|Promise<void>;
}
export interface IndexBuilder {
  manual(manual:IndexManual, options?:IndexOptions):Promise<{readonly index:SemanticIndex;readonly source:'generated'|'cache'|'embedded';readonly warnings:readonly string[]}>;
  book(book:IndexBook, options?:IndexOptions):Promise<IndexResult>;
  estimate(book:IndexBook, options?:IndexOptions):Promise<IndexEstimate>;
  publish(book:IndexBook, options:PublishOptions):Promise<Omit<IndexResult,'index'>>;
  recordsFor(manual:IndexManual):SearchRecord[];
}
export function createIndexBuilder(options?:object):IndexBuilder;
export function defaultBuilder():IndexBuilder;

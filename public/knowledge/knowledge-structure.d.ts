import type { SearchRecord } from './knowledge-contracts';
export interface StructureNote { readonly id:string; readonly text:string }
export interface StructureUnit { readonly id:string; readonly kind:string; readonly section:readonly string[]; readonly context:readonly string[];
  readonly text:string; readonly notes:readonly StructureNote[]; readonly sourceAnchor:string; readonly fingerprint:string }
export interface KnowledgeStructure { readonly schema:1; readonly source:string; readonly units:readonly StructureUnit[]; readonly warnings:readonly string[] }
export interface StructureTree {
  readonly name:string; readonly value?:string|null; readonly attrs?:Readonly<Record<string,string>>;
  readonly children?:readonly StructureTree[]; readonly origin?:Node;
}
export const SCHEMA:1;
export function prose(value:unknown):string;
export function fingerprint(value:unknown):string;
export function tree(node:Node):StructureTree;
export function definitions(node:StructureTree):Map<string,string>;
export function extract(fragment:StructureTree, noteMap?:ReadonlyMap<string,string>, chapterAnchor?:string):{units:StructureUnit[];warnings:string[]};
export function seal(title:string, value:string, units:readonly StructureUnit[], warnings?:readonly string[]):KnowledgeStructure;
export function validate(record:SearchRecord):KnowledgeStructure|null;

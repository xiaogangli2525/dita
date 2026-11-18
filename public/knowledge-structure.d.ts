import type { SearchRecord } from './knowledge-contracts';
export interface StructureNote { readonly id:string; readonly text:string }
export interface StructureUnit { readonly id:string; readonly kind:string; readonly section:readonly string[]; readonly context:readonly string[];
  readonly text:string; readonly notes:readonly StructureNote[]; readonly sourceAnchor:string; readonly fingerprint:string }
export interface KnowledgeStructure { readonly schema:1; readonly source:string; readonly units:readonly StructureUnit[]; readonly warnings:readonly string[] }
export const SCHEMA:1;
export function prose(value:unknown):string;
export function fingerprint(value:unknown):string;
export function validate(record:SearchRecord):KnowledgeStructure|null;

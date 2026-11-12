export interface SdkRecord { id: string; url: string; title: string; text: string; manualId: string; docTitle: string;
  mode: string; module: string; kind: string; aliases: readonly string[]; symbols: readonly string[]; definedSymbols: readonly string[] }
export interface SdkHit { record: SdkRecord; score: number; reason: string; matchedTerms: string[] }
export interface SdkEngine { search(query: string, settings?: { limit?: number; module?: string; mode?: string; manualId?: string }): SdkHit[];
  suggest(query: string, limit?: number, settings?: {manualId?: string; mode?: string; module?: string}): string[]; readonly indexStatus: string }
export function createSdkSearch(): { normalize(value: string): string; compile(records: readonly SdkRecord[], options?: object): object;
  create(records: readonly SdkRecord[], options?: object): SdkEngine };

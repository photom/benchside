/** What one cross-reference section yields, shared by tables and streams. */
import type { Reader } from '@benchside/core';
import { indexOf, toHex } from './bytes.ts';
import { Lexer } from './lexer.ts';
import { asInteger, dictGet, type PdfValue } from './parser.ts';
import type { Ref, Region, Trailer } from './types.ts';

export type Entry =
  | { readonly type: 'free'; readonly generation: number; readonly next: number }
  | { readonly type: 'in-use'; readonly offset: number; readonly generation: number }
  | { readonly type: 'compressed'; readonly container: number; readonly index: number };

export interface Section {
  readonly offset: number;
  readonly kind: 'table' | 'stream';
  /** Object number to entry; the first entry in the section wins (XREF-4). */
  readonly entries: Map<number, Entry>;
  readonly trailer: Trailer;
  readonly regions: Region[];
}

const ref = (v: PdfValue | undefined): Ref | null =>
  v?.kind === 'ref' ? { number: v.number, generation: v.generation } : null;

/** TRL-2 */
export function trailerFrom(dict: PdfValue | null): Trailer {
  const id = dictGet(dict, 'ID');
  const ids =
    id?.kind === 'array' && id.items.every((x) => x.kind === 'string')
      ? id.items.map((x) => toHex((x as { bytes: Uint8Array }).bytes))
      : null;
  const encrypt = dictGet(dict, 'Encrypt');
  return {
    size: asInteger(dictGet(dict, 'Size')),
    prev: asInteger(dictGet(dict, 'Prev')),
    root: ref(dictGet(dict, 'Root')),
    info: ref(dictGet(dict, 'Info')),
    encrypt: encrypt !== undefined && encrypt.kind !== 'null',
    id: ids,
    xrefStm: asInteger(dictGet(dict, 'XRefStm')),
  };
}

export const EMPTY_TRAILER = trailerFrom(null);

/** MAP-1: `startxref`, its offset, and `%%EOF` right after a section; null when absent. */
export async function tailAfter(reader: Reader, at: number): Promise<Region | null> {
  const bytes = await reader.bytes(at, Math.min(256, reader.byteLength - at));
  if (!bytes) return null;
  const lexer = new Lexer(bytes, at);
  const kw = lexer.next();
  if (kw.kind !== 'keyword' || kw.text !== 'startxref') return null;
  const n = lexer.next();
  if (n.kind !== 'number') return null;
  const eof = indexOf(bytes, '%%EOF', n.end - at);
  const end = eof < 0 ? n.end : at + eof + 5;
  return { kind: 'startxref', offset: kw.start, byteLength: end - kw.start };
}

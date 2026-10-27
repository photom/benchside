/** startxref and %%EOF (structure.md: EOF-1..3). */
import type { Reader } from '@benchside/core';
import { indexOf, isWhiteOnly, lastIndexOf, skipEol } from './bytes.ts';
import type { FindingList } from './findings.ts';
import { Lexer } from './lexer.ts';
import type { Region } from './types.ts';

/** README.md#limits */
const TAIL = 1024;

export interface Tail {
  /** EOF-1: the offset of the last section, or null (EOF-2). */
  readonly startxref: number | null;
  readonly regions: readonly Region[];
}

export async function readTail(reader: Reader, findings: FindingList): Promise<Tail> {
  const size = reader.byteLength;
  const base = Math.max(0, size - TAIL);
  const bytes = (await reader.bytes(base, size - base)) ?? new Uint8Array();
  const at = lastIndexOf(bytes, 'startxref');
  const missing = () => {
    findings.add(
      'pdf.startxref.missing',
      `No "startxref" with an offset in the last ${TAIL} bytes.`,
    );
    return { startxref: null, regions: [] };
  };
  if (at < 0) return missing();
  const lexer = new Lexer(bytes.subarray(at + 'startxref'.length), base + at + 'startxref'.length);
  const t = lexer.next();
  if (t.kind !== 'number' || !t.integer || t.value < 0) return missing();
  const afterNumber = t.end - base;
  const eof = indexOf(bytes, '%%EOF', afterNumber);
  if (eof < 0) {
    findings.add('pdf.eof.missing', 'No "%%EOF" after the startxref offset.', {
      offset: base + at,
    });
    return {
      startxref: t.value,
      regions: [{ kind: 'startxref', offset: base + at, byteLength: afterNumber - at }],
    };
  }
  const regions: Region[] = [{ kind: 'startxref', offset: base + at, byteLength: eof + 5 - at }];
  // EOF-3: anything after the end-of-line that follows %%EOF, other than white space; comments count.
  const after = skipEol(bytes, eof + 5);
  if (after < bytes.length && !isWhiteOnly(bytes.subarray(after))) {
    regions.push({ kind: 'trailing', offset: base + after, byteLength: bytes.length - after });
    findings.add('pdf.eof.trailing', `${bytes.length - after} bytes follow the last "%%EOF".`, {
      offset: base + after,
    });
  }
  return { startxref: t.value, regions };
}

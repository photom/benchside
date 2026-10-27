/** Cross-reference tables and their trailers (structure.md: XREF-2..4, TRL-1, TRL-2). */
import type { Reader } from '@benchside/core';
import type { FindingList } from './findings.ts';
import { Lexer, type Token } from './lexer.ts';
import { Parser } from './parser.ts';
import { EMPTY_TRAILER, type Entry, type Section, tailAfter, trailerFrom } from './section.ts';
import type { Region } from './types.ts';

const ENTRY = 20;
const HEADER = 256;
const TRAILER_WINDOW = 64 * 1024;

/** Reads the table at `offset`, which starts with `xref` (XREF-1 checked that). */
export async function readTable(
  reader: Reader,
  offset: number,
  findings: FindingList,
  maxEntries: number,
): Promise<Section> {
  const size = reader.byteLength;
  const entries = new Map<number, Entry>();
  const regions: Region[] = [];
  let lexer = await lexerAt(reader, offset, HEADER);
  lexer.next(); // xref
  let badFormat = false;
  let duplicate = false;
  let total = 0;
  let tableEnd = offset;
  let next: Token = lexer.next();
  // XREF-2: subsections until something that is not "first count".
  while (next.kind === 'number' && next.integer) {
    const first = next.value;
    const countToken = lexer.next();
    if (countToken.kind !== 'number' || !countToken.integer || countToken.value < 0) {
      next = countToken;
      break;
    }
    const count = Math.min(countToken.value, Math.max(0, maxEntries - total));
    // Enough bytes for every entry, even with longer end-of-lines.
    lexer = await lexerAt(reader, countToken.end, count * (ENTRY + 2) + HEADER);
    for (let k = 0; k < count; k++) {
      const o = lexer.next();
      const g = lexer.next();
      const kind = lexer.next();
      if (
        o.kind !== 'number' ||
        g.kind !== 'number' ||
        kind.kind !== 'keyword' ||
        (kind.text !== 'n' && kind.text !== 'f')
      ) {
        findings.add(
          'pdf.syntax.error',
          'A cross-reference entry is not "offset generation n|f".',
          {
            offset: o.start,
          },
        );
        break;
      }
      // XREF-3: 20 bytes, counting the two-byte end-of-line after the keyword.
      if (entryLength(lexer, o.start, kind.end) !== ENTRY) badFormat = true;
      const number = first + k;
      const entry: Entry =
        kind.text === 'n'
          ? { type: 'in-use', offset: o.value, generation: g.value }
          : { type: 'free', generation: g.value, next: o.value };
      if (entries.has(number)) duplicate = true;
      else entries.set(number, entry);
      tableEnd = kind.end;
    }
    total += count;
    if (tableEnd < countToken.end) tableEnd = countToken.end;
    next = lexer.next();
  }
  if (badFormat) {
    findings.add(
      'pdf.xref.entry-format',
      'Some cross-reference entries are not exactly 20 bytes with a two-byte end-of-line.',
      { offset },
    );
  }
  if (duplicate) {
    findings.add(
      'pdf.xref.duplicate-entry',
      'An object number appears in more than one subsection; the first entry is used.',
      { offset },
    );
  }
  const tableEndAt = next.kind === 'keyword' && next.text === 'trailer' ? next.start : tableEnd;
  regions.push({ kind: 'xref-table', offset, byteLength: tableEndAt - offset });
  if (!(next.kind === 'keyword' && next.text === 'trailer')) {
    findings.add('pdf.trailer.missing', 'No "trailer" dictionary follows the table.', {
      offset: tableEnd,
    });
    return { offset, kind: 'table', entries, trailer: EMPTY_TRAILER, regions };
  }
  // TRL-2
  const trailerLexer = await lexerAt(reader, next.end, Math.min(TRAILER_WINDOW, size - next.end));
  const parser = new Parser(trailerLexer, findings);
  const dict = parser.parseValue();
  const dictEnd = parser.end;
  regions.push({ kind: 'trailer', offset: next.start, byteLength: dictEnd - next.start });
  const tail = await tailAfter(reader, dictEnd);
  if (tail) regions.push(tail);
  return { offset, kind: 'table', entries, trailer: trailerFrom(dict), regions };
}

async function lexerAt(reader: Reader, at: number, length: number): Promise<Lexer> {
  const n = Math.max(0, Math.min(length, reader.byteLength - at));
  return new Lexer((await reader.bytes(at, n)) ?? new Uint8Array(), at);
}

/** XREF-3: the entry's length from its first digit to past its end-of-line. */
function entryLength(lexer: Lexer, start: number, kindEnd: number): number {
  const b = lexer.bytes;
  const i = kindEnd - lexer.base;
  const c0 = b[i];
  const c1 = b[i + 1];
  const twoByte = (c0 === 0x0d && c1 === 0x0a) || (c0 === 0x20 && (c1 === 0x0d || c1 === 0x0a));
  const oneByte = c0 === 0x0d || c0 === 0x0a;
  return kindEnd - start + (twoByte ? 2 : oneByte ? 1 : 0);
}

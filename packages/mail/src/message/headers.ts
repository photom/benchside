import type { ByteRange } from '../shared/bytes.ts';
import type { Finding } from '../shared/findings.ts';

export interface HeaderField {
  readonly index: number;
  /** Field name as written, without trailing whitespace. Empty for malformed lines. */
  readonly name: string;
  /** Lowercase name for lookups. Empty for malformed lines, so no check matches them. */
  readonly lname: string;
  /** The whole field including folding and the final CRLF, in normalized offsets (IN-7). */
  readonly raw: ByteRange;
  /** Text after the colon, unfolded, decoded as UTF-8. */
  readonly value: string;
}

export interface HeaderBlock {
  readonly headers: readonly HeaderField[];
  /** In normalized offsets. Null when the input has no empty line (header-only input, IN-2). */
  readonly body: ByteRange | null;
  readonly findings: readonly Finding[];
}

const CR = 0x0d;
const LF = 0x0a;
const SP = 0x20;
const HTAB = 0x09;
const COLON = 0x3a;

const utf8 = new TextDecoder('utf-8', { fatal: false });

/**
 * Splits a CRLF-normalized message into header fields and body (IN-5, IN-6).
 * Ranges are offsets into the normalized bytes; map them with `toOriginal` for the report (IN-8).
 */
export function splitHeaders(input: Uint8Array): HeaderBlock {
  const fieldRanges: ByteRange[] = [];
  let body: ByteRange | null = null;
  let pos = 0;
  let fieldStart = -1;

  while (pos < input.length) {
    const lineEnd = endOfLine(input, pos);
    const isEmptyLine = lineEnd === pos + 2 && input[pos] === CR;
    const isContinuation = input[pos] === SP || input[pos] === HTAB;

    if (isEmptyLine) {
      body = { start: lineEnd, end: input.length };
      break;
    }
    if (!isContinuation || fieldStart < 0) {
      if (fieldStart >= 0) fieldRanges.push({ start: fieldStart, end: pos });
      fieldStart = pos;
    }
    pos = lineEnd;
  }
  if (fieldStart >= 0)
    fieldRanges.push({ start: fieldStart, end: body ? body.start - 2 : input.length });

  const findings: Finding[] = [];
  const headers = fieldRanges.map((raw, index) => {
    const field = parseField(input, raw, index);
    if (field.lname === '') {
      findings.push({
        id: 'input.malformed-header',
        severity: 'warning',
        message: 'A header line has no colon or starts with whitespace before any field.',
        evidence: [{ kind: 'header', index }],
      });
    }
    return field;
  });

  return { headers, body, findings };
}

/** Returns the offset just after the next CRLF, or the end of input. */
function endOfLine(input: Uint8Array, from: number): number {
  for (let i = from; i < input.length - 1; i++) {
    if (input[i] === CR && input[i + 1] === LF) return i + 2;
  }
  return input.length;
}

function parseField(input: Uint8Array, raw: ByteRange, index: number): HeaderField {
  const first = input[raw.start];
  const colon = first === SP || first === HTAB ? -1 : input.indexOf(COLON, raw.start);
  if (colon < 0 || colon >= raw.end) {
    return { index, name: '', lname: '', raw, value: unfold(input, raw.start, raw.end) };
  }
  let nameEnd = colon;
  while (nameEnd > raw.start && (input[nameEnd - 1] === SP || input[nameEnd - 1] === HTAB))
    nameEnd--;
  const name = utf8.decode(input.subarray(raw.start, nameEnd));
  return { index, name, lname: name.toLowerCase(), raw, value: unfold(input, colon + 1, raw.end) };
}

/** Removes every CRLF (folding and the final line break) and decodes as UTF-8. */
function unfold(input: Uint8Array, start: number, end: number): string {
  const out = new Uint8Array(end - start);
  let n = 0;
  for (let i = start; i < end; i++) {
    if (input[i] === CR && input[i + 1] === LF && i + 1 < end) {
      i++;
      continue;
    }
    out[n++] = input[i] as number;
  }
  return utf8.decode(out.subarray(0, n));
}

/** Stream filters (streams.md: FLT-1..10). */
import { inflate } from '@benchside/core';
import { hexValue, isWhite } from './lexer.ts';
import { asInteger, asName, dictGet, type PdfValue } from './parser.ts';
import { pngDecode } from './predictor.ts';

export type FilterResult =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'exceeded' };

export type DecodeResult =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'unsupported'; readonly filter: string }
  | { readonly kind: 'error'; readonly filter: string; readonly message: string }
  | { readonly kind: 'limit' };

/** FLT-9: one decoded stream may reach this. */
export const MAX_DECODED = 32 * 1024 * 1024;
/** FLT-9: all decoding in one analysis may reach this. */
export const DECODE_BUDGET = 256 * 1024 * 1024;

/** Collects output bytes without growing past `limit`. */
class Output {
  private buffer: Uint8Array;
  length = 0;
  readonly limit: number;

  constructor(limit: number, hint: number) {
    this.limit = limit;
    this.buffer = new Uint8Array(Math.max(16, Math.min(limit, hint)));
  }

  /** False when the limit would be passed. */
  push(bytes: ArrayLike<number>): boolean {
    if (this.length + bytes.length > this.limit) return false;
    if (this.length + bytes.length > this.buffer.length) {
      const grown = new Uint8Array(
        Math.min(this.limit, Math.max(this.buffer.length * 2, this.length + bytes.length)),
      );
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
    return true;
  }

  bytes(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

const GREATER = 0x3e;
const TILDE = 0x7e;

/** FLT-2 */
export function asciiHex(data: Uint8Array): FilterResult {
  const out = new Uint8Array(Math.ceil(data.length / 2));
  let n = 0;
  let high = -1;
  for (const c of data) {
    if (c === GREATER) break;
    if (isWhite(c)) continue;
    const v = hexValue(c);
    if (v < 0) return { kind: 'error', message: `byte 0x${c.toString(16)} is not a hex digit` };
    if (high < 0) high = v;
    else {
      out[n++] = high * 16 + v;
      high = -1;
    }
  }
  if (high >= 0) out[n++] = high * 16;
  return { kind: 'ok', bytes: out.slice(0, n) };
}

/** FLT-3 */
export function ascii85(data: Uint8Array, limit = MAX_DECODED): FilterResult {
  const out = new Output(limit, data.length);
  const group: number[] = [];
  const word = new Uint8Array(4);
  const flush = (count: number) => {
    let value = 0;
    for (let i = 0; i < 5; i++) value = value * 85 + (group[i] ?? 84);
    if (value > 0xffffffff) return 'error';
    for (let i = 0; i < 4; i++) word[i] = (value >>> (24 - 8 * i)) & 0xff;
    return out.push(word.subarray(0, count - 1)) ? 'ok' : 'exceeded';
  };
  const ZERO = new Uint8Array(4);
  for (let i = 0; i < data.length; i++) {
    const c = data[i] as number;
    if (isWhite(c)) continue;
    if (c === TILDE) break;
    if (c === 0x7a) {
      if (group.length > 0) return { kind: 'error', message: '"z" inside a group' };
      if (!out.push(ZERO)) return { kind: 'exceeded' };
      continue;
    }
    if (c < 0x21 || c > 0x75) {
      return { kind: 'error', message: `byte 0x${c.toString(16)} is not base-85` };
    }
    group.push(c - 0x21);
    if (group.length === 5) {
      const r = flush(5);
      if (r === 'error') return { kind: 'error', message: 'a group is above 2^32 - 1' };
      if (r === 'exceeded') return { kind: 'exceeded' };
      group.length = 0;
    }
  }
  if (group.length === 1) return { kind: 'error', message: 'the final group has one character' };
  if (group.length > 1) {
    const r = flush(group.length);
    if (r === 'error') return { kind: 'error', message: 'a group is above 2^32 - 1' };
    if (r === 'exceeded') return { kind: 'exceeded' };
  }
  return { kind: 'ok', bytes: out.bytes() };
}

/** FLT-4: 9- to 12-bit codes, high-order bit first. */
export function lzw(data: Uint8Array, earlyChange: number, limit: number): FilterResult {
  const out = new Output(limit, data.length * 3);
  let table: Uint8Array[] = [];
  const reset = () => {
    table = Array.from({ length: 258 }, (_, i) => Uint8Array.of(i));
  };
  reset();
  let width = 9;
  let bits = 0;
  let buffered = 0;
  let previous: Uint8Array | null = null;
  for (const byte of data) {
    buffered = ((buffered << 8) | byte) >>> 0;
    bits += 8;
    while (bits >= width) {
      const code = (buffered >>> (bits - width)) & ((1 << width) - 1);
      bits -= width;
      buffered &= (1 << bits) - 1;
      if (code === 256) {
        reset();
        width = 9;
        previous = null;
        continue;
      }
      if (code === 257) return { kind: 'ok', bytes: out.bytes() };
      let entry = table[code];
      if (!entry) {
        if (code !== table.length || !previous) {
          return { kind: 'error', message: `code ${code} is not in the table` };
        }
        // The code being defined: the previous sequence and its own first byte.
        entry = new Uint8Array(previous.length + 1);
        entry.set(previous);
        entry[previous.length] = previous[0] as number;
      }
      if (!out.push(entry)) return { kind: 'exceeded' };
      if (previous && table.length < 4096) {
        const added = new Uint8Array(previous.length + 1);
        added.set(previous);
        added[previous.length] = entry[0] as number;
        table.push(added);
      }
      previous = entry;
      const next = table.length + earlyChange;
      if (next >= 4096) width = 12;
      else if (next >= 2048) width = Math.max(width, 12);
      else if (next >= 1024) width = Math.max(width, 11);
      else if (next >= 512) width = Math.max(width, 10);
    }
  }
  return { kind: 'ok', bytes: out.bytes() };
}

/** FLT-6 */
export function runLength(data: Uint8Array, limit: number): FilterResult {
  const out = new Output(limit, data.length * 2);
  let i = 0;
  while (i < data.length) {
    const length = data[i++] as number;
    if (length === 128) break;
    if (length < 128) {
      if (!out.push(data.subarray(i, i + length + 1))) return { kind: 'exceeded' };
      i += length + 1;
    } else {
      const run = new Uint8Array(257 - length).fill(data[i++] ?? 0);
      if (!out.push(run)) return { kind: 'exceeded' };
    }
  }
  return { kind: 'ok', bytes: out.bytes() };
}

/** FLT-1: the filter names and their parameters, in order. */
function pipeline(dict: PdfValue | null): { name: string; parms: PdfValue | undefined }[] {
  const filter = dictGet(dict, 'Filter');
  const parms = dictGet(dict, 'DecodeParms');
  const names = filter?.kind === 'array' ? filter.items : filter ? [filter] : [];
  return names.map((f, i) => ({
    name: asName(f) ?? '',
    parms: parms?.kind === 'array' ? parms.items[i] : i === 0 ? parms : undefined,
  }));
}

/**
 * FLT-1..9: decodes `data` with the stream dictionary's filters.
 * `budget.left` is the decoding left for the whole analysis; it shrinks by the output length.
 */
export async function decodeStream(
  data: Uint8Array,
  dict: PdfValue | null,
  budget: { left: number },
  maxStream = MAX_DECODED,
): Promise<DecodeResult> {
  let bytes = data;
  for (const { name, parms } of pipeline(dict)) {
    // FLT-9: every stage's output counts, also when a later stage fails.
    const limit = Math.min(maxStream, budget.left);
    let result: FilterResult;
    switch (name) {
      case 'ASCIIHexDecode':
        result = asciiHex(bytes);
        break;
      case 'ASCII85Decode':
        result = ascii85(bytes, limit);
        break;
      case 'RunLengthDecode':
        result = runLength(bytes, limit);
        break;
      case 'LZWDecode':
        result = lzw(bytes, asInteger(dictGet(parms, 'EarlyChange')) ?? 1, limit);
        break;
      case 'FlateDecode': {
        const out = await inflate(bytes, limit, 'deflate');
        result =
          out.kind === 'ok'
            ? out
            : out.kind === 'exceeded'
              ? out
              : { kind: 'error', message: 'the data does not inflate' };
        break;
      }
      default:
        return { kind: 'unsupported', filter: name };
    }
    if (result.kind === 'exceeded') return { kind: 'limit' };
    if (result.kind === 'error') return { kind: 'error', filter: name, message: result.message };
    if (result.bytes.length > limit) return { kind: 'limit' };
    budget.left -= result.bytes.length;
    bytes = result.bytes;
    if (name === 'LZWDecode' || name === 'FlateDecode') {
      const predicted = predict(bytes, parms);
      if (predicted.kind !== 'ok') {
        return predicted.kind === 'unsupported'
          ? predicted
          : { kind: 'error', filter: name, message: predicted.message };
      }
      bytes = predicted.bytes;
    }
  }
  if (bytes === data) {
    // No filter: the stream's own bytes are its output.
    if (bytes.length > Math.min(maxStream, budget.left)) return { kind: 'limit' };
    budget.left -= bytes.length;
  }
  return { kind: 'ok', bytes };
}

/** FLT-7 */
export function predict(
  bytes: Uint8Array,
  parms: PdfValue | undefined,
):
  | { kind: 'ok'; bytes: Uint8Array }
  | { kind: 'unsupported'; filter: string }
  | { kind: 'error'; message: string } {
  const predictor = asInteger(dictGet(parms, 'Predictor')) ?? 1;
  if (predictor === 1) return { kind: 'ok', bytes };
  if (predictor === 2) return { kind: 'unsupported', filter: 'Predictor 2' };
  if (predictor < 10 || predictor > 15) {
    return { kind: 'error', message: `Predictor ${predictor} is not defined` };
  }
  const result = pngDecode(bytes, {
    columns: asInteger(dictGet(parms, 'Columns')) ?? 1,
    colors: asInteger(dictGet(parms, 'Colors')) ?? 1,
    bitsPerComponent: asInteger(dictGet(parms, 'BitsPerComponent')) ?? 8,
  });
  return result.kind === 'ok' ? result : { kind: 'error', message: result.message };
}

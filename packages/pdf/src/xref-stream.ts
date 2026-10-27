/** Cross-reference streams (structure.md: XST-1, XST-2, XST-4, XST-5). */
import { inflate, type Reader } from '@benchside/core';
import type { FindingList } from './findings.ts';
import { readObject, standalone } from './objects.ts';
import { asInteger, asName, dictGet, type PdfValue } from './parser.ts';
import { pngDecode } from './predictor.ts';
import { EMPTY_TRAILER, type Entry, type Section, tailAfter, trailerFrom } from './section.ts';
import type { Region } from './types.ts';

/** README.md#limits */
export const MAX_XREF_STREAM = 32 * 1024 * 1024;

/** Reads the cross-reference stream object at `offset` (XREF-1 saw `n g obj` there). */
export async function readStreamSection(
  reader: Reader,
  offset: number,
  findings: FindingList,
  maxEntries: number,
): Promise<Section> {
  const entries = new Map<number, Entry>();
  const empty = (regions: Region[]): Section => ({
    offset,
    kind: 'stream',
    entries,
    trailer: EMPTY_TRAILER,
    regions,
  });
  // 7.5.8.2: Length shall be direct, so an indirect one is not followed.
  const outcome = await readObject(reader, offset, findings, null, standalone());
  if (outcome.kind !== 'read' || !outcome.object.stream) {
    findings.add('pdf.xref-stream.dict', 'The cross-reference stream object could not be read.', {
      offset,
    });
    return empty([]);
  }
  const { indirect, stream, end } = outcome.object;
  const dict = indirect.value;
  const regions: Region[] = [
    { kind: 'xref-stream', offset, byteLength: end - offset, object: indirect.number },
  ];
  const tail = await tailAfter(reader, end);
  if (tail) regions.push(tail);
  const at = { offset, object: indirect.number };

  // XST-1
  const size = asInteger(dictGet(dict, 'Size'));
  const w = numbers(dictGet(dict, 'W'));
  const index = numbers(dictGet(dict, 'Index')) ?? (size === null ? null : [0, size]);
  if (
    asName(dictGet(dict, 'Type')) !== 'XRef' ||
    size === null ||
    size < 0 ||
    w === null ||
    w.length !== 3 ||
    w.some((x) => x < 0 || x > 8) ||
    index === null ||
    index.length % 2 !== 0
  ) {
    findings.add(
      'pdf.xref-stream.dict',
      'The cross-reference stream dictionary lacks a usable Type /XRef, Size, W, or Index.',
      at,
    );
    return { ...empty(regions), trailer: trailerFrom(dict) };
  }

  const data = await decode(reader, dict, stream.dataOffset, stream.byteLength, findings, at);
  if (!data) return { ...empty(regions), trailer: trailerFrom(dict) };

  // XST-4, XST-5
  const [w0, w1, w2] = w as [number, number, number];
  const rowSize = w0 + w1 + w2;
  let pos = 0;
  let short = false;
  let read = 0;
  outer: for (let p = 0; p < index.length; p += 2) {
    const first = index[p] as number;
    const count = index[p + 1] as number;
    for (let k = 0; k < count; k++) {
      if (read >= maxEntries) break outer;
      if (rowSize === 0 || pos + rowSize > data.length) {
        short = true;
        break outer;
      }
      const type = w0 === 0 ? 1 : field(data, pos, w0);
      const a = field(data, pos + w0, w1);
      const b = field(data, pos + w0 + w1, w2);
      pos += rowSize;
      read++;
      const number = first + k;
      if (entries.has(number)) continue;
      if (type === 0) entries.set(number, { type: 'free', next: a, generation: b });
      else if (type === 1) entries.set(number, { type: 'in-use', offset: a, generation: b });
      else if (type === 2) entries.set(number, { type: 'compressed', container: a, index: b });
      // Other types are references to null (7.5.8.3).
    }
  }
  if (short) {
    findings.add(
      'pdf.xref-stream.short',
      `The decoded data holds fewer entries than Index declares; ${read} entries were read.`,
      at,
    );
  }
  return { offset, kind: 'stream', entries, trailer: trailerFrom(dict), regions };
}

/** XST-2, XST-3 */
async function decode(
  reader: Reader,
  dict: PdfValue | null,
  dataOffset: number,
  byteLength: number,
  findings: FindingList,
  at: { offset: number; object: number },
): Promise<Uint8Array | null> {
  const raw = await reader.bytes(dataOffset, Math.min(byteLength, MAX_XREF_STREAM));
  if (!raw) return null;
  const filter = dictGet(dict, 'Filter');
  const filters =
    filter === undefined
      ? []
      : filter.kind === 'array'
        ? filter.items.map((x) => asName(x))
        : [asName(filter)];
  if (filters.length > 1 || (filters.length === 1 && filters[0] !== 'FlateDecode')) {
    findings.add(
      'pdf.xref-stream.filter',
      `The cross-reference stream uses ${filters.join(', ') || 'an unknown filter'}; only FlateDecode is supported.`,
      at,
    );
    return null;
  }
  let data = raw;
  if (filters.length === 1) {
    const out = await inflate(raw, MAX_XREF_STREAM, 'deflate');
    if (out.kind !== 'ok') {
      findings.add(
        'pdf.xref-stream.decode',
        out.kind === 'exceeded'
          ? 'The decoded cross-reference stream passes 32 MiB.'
          : 'The cross-reference stream data does not decode with FlateDecode.',
        at,
      );
      return null;
    }
    data = out.bytes;
  }
  const parmsValue = dictGet(dict, 'DecodeParms');
  const parms = parmsValue?.kind === 'array' ? parmsValue.items[0] : parmsValue;
  const predictor = asInteger(dictGet(parms, 'Predictor')) ?? 1;
  if (predictor === 1) return data;
  if (predictor < 10 || predictor > 15) {
    findings.add(
      'pdf.xref-stream.filter',
      `Predictor ${predictor} is not supported for cross-reference streams.`,
      at,
    );
    return null;
  }
  const result = pngDecode(data, {
    columns: asInteger(dictGet(parms, 'Columns')) ?? 1,
    colors: asInteger(dictGet(parms, 'Colors')) ?? 1,
    bitsPerComponent: asInteger(dictGet(parms, 'BitsPerComponent')) ?? 8,
  });
  if (result.kind === 'error') {
    findings.add('pdf.xref-stream.decode', `The PNG predictor failed: ${result.message}`, at);
    return null;
  }
  return result.bytes;
}

function numbers(v: PdfValue | undefined): number[] | null {
  if (v?.kind !== 'array') return null;
  const out: number[] = [];
  for (const x of v.items) {
    const n = asInteger(x);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/** XST-4: a big-endian field; width 0 gives 0. */
function field(data: Uint8Array, at: number, width: number): number {
  let v = 0;
  for (let i = 0; i < width; i++) v = v * 256 + (data[at + i] as number);
  return v;
}

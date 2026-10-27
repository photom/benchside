/** Reading one indirect object at an offset (structure.md: OBX-1, OBX-2; syntax.md: IND-2..5). */
import type { Reader } from '@benchside/core';
import { indexOf } from './bytes.ts';
import { FindingList } from './findings.ts';
import { isWhite, Lexer } from './lexer.ts';
import { asInteger, asName, dictGet, type Indirect, Parser, type PdfValue } from './parser.ts';
import type { Ref, StreamInfo } from './types.ts';

/** README.md#limits */
export const OBJECT_WINDOW = 64 * 1024;
/** Most objects fit in this; a bigger one is read again with OBJECT_WINDOW. */
const FIRST_TRY = 4 * 1024;
const ENDSTREAM_SEARCH = 1024 * 1024;
const PEEK = 64;

export interface ReadObject {
  readonly indirect: Indirect;
  /** From `n g obj` to after `endobj` (or after the value or `endstream` when it is missing). */
  readonly end: number;
  readonly stream: StreamInfo | null;
}

export type ObjectOutcome =
  | { readonly kind: 'read'; readonly object: ReadObject }
  | { readonly kind: 'out-of-range' }
  | { readonly kind: 'mismatch' }
  | { readonly kind: 'too-large' };

/** IND-3: resolves an indirect `Length`; null when it cannot be resolved. */
export type LengthResolver = (ref: Ref) => Promise<number | null>;

/** IND-4: the endstream search budget left for the whole file. */
export const SEARCH_BUDGET = 16 * 1024 * 1024;

export interface ReadContext {
  readonly resolveLength: LengthResolver;
  readonly search: { left: number };
}

/** A context that resolves nothing, with its own search budget. */
export const standalone = (): ReadContext => ({
  resolveLength: async () => null,
  search: { left: SEARCH_BUDGET },
});

/** Reads the object at `offset`. When `expect` is given, its number and generation must match (OBX-1). */
export async function readObject(
  reader: Reader,
  offset: number,
  findings: FindingList,
  expect: Ref | null,
  context: ReadContext,
): Promise<ObjectOutcome> {
  const size = reader.byteLength;
  if (offset < 0 || offset >= size) return { kind: 'out-of-range' };
  let parsed = await parseAt(reader, offset, FIRST_TRY);
  if (parsed.cutShort && parsed.indirect && !parsed.indirect.endobj && !parsed.indirect.stream) {
    parsed = await parseAt(reader, offset, OBJECT_WINDOW);
  }
  const { indirect, local, cutShort } = parsed;
  if (
    !indirect ||
    (expect && (indirect.number !== expect.number || indirect.generation !== expect.generation))
  ) {
    return { kind: 'mismatch' };
  }
  if (cutShort && !indirect.endobj && !indirect.stream) return { kind: 'too-large' };
  for (const f of local.list) {
    findings.add(f.id, f.message, {
      ...(f.offset === undefined ? {} : { offset: f.offset }),
      object: indirect.number,
    });
  }
  const at = { offset, object: indirect.number };
  if (!indirect.stream) {
    if (!indirect.endobj) {
      findings.add('pdf.object.endobj-missing', 'The object has no "endobj".', at);
    }
    return { kind: 'read', object: { indirect, end: indirect.end, stream: null } };
  }
  if (!indirect.stream.eolOk) {
    findings.add('pdf.stream.eol', 'The "stream" keyword is not followed by CR LF or LF.', {
      offset: indirect.end,
      object: indirect.number,
    });
  }
  const extent = await streamExtent(reader, indirect, findings, context);
  const end = await afterEndobj(reader, extent.end, indirect.number, findings);
  return {
    kind: 'read',
    object: {
      indirect,
      end,
      stream: {
        dataOffset: indirect.stream.dataStart,
        byteLength: extent.byteLength,
        filters: filterNames(indirect.value),
      },
    },
  };
}

/** Parses `n g obj ...` from a window of `window` bytes; findings wait until the object fits. */
async function parseAt(reader: Reader, offset: number, window: number) {
  const n = Math.min(window, reader.byteLength - offset);
  const bytes = (await reader.bytes(offset, n)) as Uint8Array;
  const local = new FindingList(Number.POSITIVE_INFINITY);
  const indirect = new Parser(new Lexer(bytes, offset), local).parseIndirect();
  return { indirect, local, cutShort: offset + n < reader.byteLength };
}

/** IND-3, IND-4: the data length, and where `endstream` ends. */
async function streamExtent(
  reader: Reader,
  indirect: Indirect,
  findings: FindingList,
  context: ReadContext,
): Promise<{ byteLength: number; end: number }> {
  const start = (indirect.stream as { dataStart: number }).dataStart;
  const size = reader.byteLength;
  const at = { offset: start, object: indirect.number };
  const lengthValue = dictGet(indirect.value, 'Length');
  let declared = asInteger(lengthValue);
  if (lengthValue?.kind === 'ref') {
    declared = await context.resolveLength({
      number: lengthValue.number,
      generation: lengthValue.generation,
    });
  }
  const usable = declared !== null && declared >= 0 && start + declared <= size ? declared : null;
  if (usable !== null) {
    const end = await endstreamAt(reader, start + usable);
    if (end !== null) return { byteLength: usable, end };
  }
  // IND-4: search forward for endstream.
  const span = Math.max(0, Math.min(ENDSTREAM_SEARCH, size - start, context.search.left));
  context.search.left -= span;
  const bytes = (await reader.bytes(start, span)) ?? new Uint8Array();
  const found = indexOf(bytes, 'endstream');
  const said = declared === null ? 'no usable Length' : `Length ${declared}`;
  if (found >= 0) {
    let dataEnd = found;
    if (bytes[dataEnd - 1] === 0x0a) dataEnd--;
    if (bytes[dataEnd - 1] === 0x0d) dataEnd--;
    findings.add(
      'pdf.stream.length',
      `The stream has ${said}, but "endstream" follows ${dataEnd} bytes of data.`,
      at,
    );
    return { byteLength: dataEnd, end: start + found + 'endstream'.length };
  }
  const byteLength = usable ?? span;
  findings.add(
    'pdf.stream.length',
    span === 0
      ? `The stream has ${said}, and the search for "endstream" is used up for this file.`
      : `The stream has ${said}, and no "endstream" was found in the next ${span} bytes.`,
    at,
  );
  return { byteLength, end: start + byteLength };
}

/** IND-3: after optional white space, `endstream` at `at`; returns where it ends, or null. */
async function endstreamAt(reader: Reader, at: number): Promise<number | null> {
  const bytes = await reader.bytes(at, Math.min(PEEK, reader.byteLength - at));
  if (!bytes) return null;
  let i = 0;
  while (i < bytes.length && isWhite(bytes[i] as number)) i++;
  return indexOf(bytes, 'endstream', i) === i ? at + i + 'endstream'.length : null;
}

/** IND-5: after `endstream`, white space and `endobj`; the object ends after it, or here. */
async function afterEndobj(
  reader: Reader,
  at: number,
  object: number,
  findings: FindingList,
): Promise<number> {
  const bytes =
    (await reader.bytes(at, Math.min(PEEK, reader.byteLength - at))) ?? new Uint8Array();
  let i = 0;
  while (i < bytes.length && isWhite(bytes[i] as number)) i++;
  if (indexOf(bytes, 'endobj', i) === i) return at + i + 'endobj'.length;
  findings.add('pdf.object.endobj-missing', 'The object has no "endobj".', { offset: at, object });
  return at;
}

/** OBX-2: the stream's filter names. */
export function filterNames(dict: PdfValue | null): string[] {
  const f = dictGet(dict, 'Filter');
  if (f?.kind === 'name') return [f.text];
  if (f?.kind === 'array') return f.items.flatMap((x) => (x.kind === 'name' ? [x.text] : []));
  return [];
}

/** OBX-2: a dictionary's Type and Subtype names. */
export function typeOf(value: PdfValue | null): { type?: string; subtype?: string } {
  const type = asName(dictGet(value, 'Type'));
  const subtype = asName(dictGet(value, 'Subtype'));
  return { ...(type === null ? {} : { type }), ...(subtype === null ? {} : { subtype }) };
}

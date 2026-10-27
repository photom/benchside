/** Objects from tokens (syntax.md: OBJ-1, OBJ-6..9, IND-1, IND-2, IND-5). */
import { toHex } from './bytes.ts';
import type { FindingList } from './findings.ts';
import type { Lexer, Token } from './lexer.ts';

export type PdfValue =
  | { readonly kind: 'null' }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly value: number; readonly integer: boolean }
  | { readonly kind: 'string'; readonly bytes: Uint8Array; readonly hex: boolean }
  | {
      readonly kind: 'name';
      readonly bytes: Uint8Array;
      /** OBJ-5: UTF-8 when valid, otherwise the bytes in hex. */
      readonly text: string;
      /** The bytes as Latin-1: a binary-safe key. */
      readonly key: string;
    }
  | { readonly kind: 'array'; readonly items: readonly PdfValue[] }
  | { readonly kind: 'dict'; readonly entries: ReadonlyMap<string, PdfValue> }
  | { readonly kind: 'ref'; readonly number: number; readonly generation: number };

export interface Indirect {
  readonly number: number;
  readonly generation: number;
  /** Offset of the object number. */
  readonly start: number;
  readonly value: PdfValue | null;
  /** IND-2: where stream data starts, and whether `stream` had a proper end-of-line. */
  readonly stream: { readonly dataStart: number; readonly eolOk: boolean } | null;
  /** IND-5: after `endobj`, or after the value (or `stream`) when it is missing. */
  readonly end: number;
  readonly endobj: boolean;
}

const MAX_DEPTH = 64;
const NULL: PdfValue = { kind: 'null' };
// Keywords that end an object; inside an array or dictionary they mean it was never closed.
const STRUCTURAL = new Set([
  'obj',
  'endobj',
  'stream',
  'endstream',
  'xref',
  'trailer',
  'startxref',
]);
const utf8 = new TextDecoder('utf-8', { fatal: true });

class DepthError extends Error {}

export const latin1 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
};

function nameValue(bytes: Uint8Array): PdfValue {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    text = toHex(bytes);
  }
  return { kind: 'name', bytes, text, key: latin1(bytes) };
}

/** OBJ-7: an entry of a dictionary value, or undefined. */
export function dictGet(v: PdfValue | null | undefined, key: string): PdfValue | undefined {
  return v?.kind === 'dict' ? v.entries.get(key) : undefined;
}

/** An integer value, or null. */
export const asInteger = (v: PdfValue | null | undefined): number | null =>
  v?.kind === 'number' && v.integer ? v.value : null;

/** A name's key text, or null. */
export const asName = (v: PdfValue | null | undefined): string | null =>
  v?.kind === 'name' ? v.key : null;

export class Parser {
  private readonly lexer: Lexer;
  private readonly findings: FindingList;
  private readonly pending: Token[] = [];
  /** End offset of the last token taken. */
  private lastEnd: number;
  /** OBJ-9: set after a depth error; the rest of the window is not trusted. */
  aborted = false;

  constructor(lexer: Lexer, findings: FindingList) {
    this.lexer = lexer;
    this.findings = findings;
    this.lastEnd = lexer.base + lexer.pos;
    lexer.report = (id, message, offset) => findings.add(id, message, { offset });
  }

  private take(): Token {
    const t = this.pending.pop() ?? this.lexer.next();
    this.lastEnd = t.end;
    return t;
  }

  private peek(n: number): Token {
    while (this.pending.length < n) this.pending.unshift(this.lexer.next());
    return this.pending[this.pending.length - n] as Token;
  }

  private putBack(t: Token) {
    this.pending.push(t);
  }

  /** End offset of the last token used; tokens peeked beyond it do not count. */
  get end(): number {
    return this.lastEnd;
  }

  /** One object, or null when the window ends first. */
  parseValue(): PdfValue | null {
    try {
      const t = this.take();
      return this.value(t, 0);
    } catch (error) {
      if (!(error instanceof DepthError)) throw error;
      this.aborted = true;
      this.findings.add(
        'pdf.syntax.depth',
        `Arrays and dictionaries are nested deeper than ${MAX_DEPTH}; the object is read as null.`,
        { offset: this.lastEnd },
      );
      return NULL;
    }
  }

  private value(first: Token, depth: number): PdfValue | null {
    if (depth > MAX_DEPTH) throw new DepthError();
    // A loop, not recursion: skipped tokens can repeat thousands of times (REQ-PDF-003).
    for (let t = first; ; t = this.take()) {
      switch (t.kind) {
        case 'eof':
          return null;
        case 'number':
          return this.numberOrRef(t);
        case 'string':
          return { kind: 'string', bytes: t.bytes, hex: t.hex };
        case 'name':
          return nameValue(t.bytes);
        case 'open-array':
          return this.array(t, depth);
        case 'open-dict':
          return this.dict(t, depth);
        case 'close-dict':
        case 'close-array':
        case 'close-brace':
          // OBJ-7: a closing token ends what it closes; it is never a value.
          this.putBack(t);
          return null;
        case 'keyword':
          if (t.text === 'true' || t.text === 'false') {
            return { kind: 'boolean', value: t.text === 'true' };
          }
          if (t.text === 'null') return NULL;
          if (STRUCTURAL.has(t.text)) {
            this.putBack(t);
            return null;
          }
          this.unexpected(t);
          break;
        default:
          this.unexpected(t);
      }
    }
  }

  /** OBJ-8 */
  private numberOrRef(t: Token & { kind: 'number' }): PdfValue {
    if (t.integer && t.value >= 0) {
      const g = this.peek(1);
      const r = this.peek(2);
      if (
        g.kind === 'number' &&
        g.integer &&
        g.value >= 0 &&
        r.kind === 'keyword' &&
        r.text === 'R'
      ) {
        this.take();
        this.take();
        return { kind: 'ref', number: t.value, generation: g.value };
      }
    }
    return { kind: 'number', value: t.value, integer: t.integer };
  }

  /** OBJ-6, OBJ-9 */
  private array(open: Token, depth: number): PdfValue {
    const items: PdfValue[] = [];
    for (;;) {
      const t = this.take();
      if (t.kind === 'close-array') return { kind: 'array', items };
      if (
        t.kind === 'eof' ||
        t.kind === 'close-dict' ||
        t.kind === 'close-brace' ||
        (t.kind === 'keyword' && STRUCTURAL.has(t.text))
      ) {
        if (t.kind !== 'eof') this.putBack(t);
        this.findings.add('pdf.syntax.error', 'An array is not closed.', { offset: open.start });
        return { kind: 'array', items };
      }
      if (t.kind === 'keyword' && !['true', 'false', 'null'].includes(t.text)) {
        this.unexpected(t);
        continue;
      }
      const v = this.value(t, depth + 1);
      if (v) items.push(v);
    }
  }

  /** OBJ-7, OBJ-9 */
  private dict(open: Token, depth: number): PdfValue {
    const entries = new Map<string, PdfValue>();
    for (;;) {
      const t = this.take();
      if (t.kind === 'close-dict') return { kind: 'dict', entries };
      if (
        t.kind === 'eof' ||
        t.kind === 'close-array' ||
        t.kind === 'close-brace' ||
        (t.kind === 'keyword' && STRUCTURAL.has(t.text))
      ) {
        if (t.kind !== 'eof') this.putBack(t);
        this.findings.add('pdf.syntax.error', 'A dictionary is not closed.', {
          offset: open.start,
        });
        return { kind: 'dict', entries };
      }
      const value = this.value(this.take(), depth + 1);
      if (t.kind !== 'name') {
        this.findings.add('pdf.dict.key', 'A dictionary key is not a name; the pair is skipped.', {
          offset: t.start,
        });
        continue;
      }
      if (!value) {
        const after = this.peek(1);
        if (after.kind === 'close-dict') {
          this.findings.add('pdf.syntax.error', `The key /${latin1(t.bytes)} has no value.`, {
            offset: t.start,
          });
        }
        continue;
      }
      const key = latin1(t.bytes);
      if (entries.has(key)) {
        this.findings.add(
          'pdf.dict.duplicate-key',
          `The key /${key} appears more than once; the later value is used.`,
          { offset: t.start },
        );
      }
      entries.set(key, value);
    }
  }

  /** LEX-4 */
  private unexpected(t: Token) {
    const what = t.kind === 'keyword' ? `"${t.text}"` : `"${t.kind}"`;
    this.findings.add('pdf.syntax.error', `Unexpected ${what}; it is skipped.`, {
      offset: t.start,
    });
  }

  /** IND-1, IND-2, IND-5: `n g obj`, a value, then `endobj` or `stream`; null when not `n g obj`. */
  parseIndirect(): Indirect | null {
    const n = this.take();
    const g = this.take();
    const obj = this.take();
    if (
      n.kind !== 'number' ||
      !n.integer ||
      g.kind !== 'number' ||
      !g.integer ||
      obj.kind !== 'keyword' ||
      obj.text !== 'obj'
    ) {
      return null;
    }
    const value = this.parseValue();
    const base = { number: n.value, generation: g.value, start: n.start, value };
    const valueEnd = this.lastEnd;
    if (this.aborted) return { ...base, stream: null, end: valueEnd, endobj: false };
    const t = this.take();
    if (t.kind === 'keyword' && t.text === 'endobj') {
      return { ...base, stream: null, end: t.end, endobj: true };
    }
    if (t.kind === 'keyword' && t.text === 'stream') {
      return { ...base, stream: this.streamStart(t.end), end: t.end, endobj: false };
    }
    this.putBack(t);
    return { ...base, stream: null, end: valueEnd, endobj: false };
  }

  /** IND-2: CR LF or LF after `stream`; CR alone or nothing is reported by the caller. */
  private streamStart(afterKeyword: number) {
    const b = this.lexer.bytes;
    const i = afterKeyword - this.lexer.base;
    if (b[i] === 0x0d && b[i + 1] === 0x0a) return { dataStart: afterKeyword + 2, eolOk: true };
    if (b[i] === 0x0a) return { dataStart: afterKeyword + 1, eolOk: true };
    if (b[i] === 0x0d) return { dataStart: afterKeyword + 1, eolOk: false };
    return { dataStart: afterKeyword, eolOk: false };
  }
}

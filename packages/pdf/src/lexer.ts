/** Tokens from a window of the file (syntax.md: LEX-*, OBJ-2..5). */

export type Token =
  | {
      readonly kind: 'number';
      readonly value: number;
      readonly integer: boolean;
      start: number;
      end: number;
    }
  | {
      readonly kind: 'string';
      readonly bytes: Uint8Array;
      readonly hex: boolean;
      start: number;
      end: number;
    }
  | { readonly kind: 'name'; readonly bytes: Uint8Array; start: number; end: number }
  | { readonly kind: 'keyword'; readonly text: string; start: number; end: number }
  | {
      readonly kind:
        | 'open-array'
        | 'close-array'
        | 'open-dict'
        | 'close-dict'
        | 'open-brace'
        | 'close-brace';
      start: number;
      end: number;
    }
  | { readonly kind: 'eof'; start: number; end: number };

export type LexerProblem = 'pdf.syntax.error' | 'pdf.value-too-large';

// Byte codes (7.2.2, Tables 1 and 2).
const NUL = 0x00;
const HT = 0x09;
const LF = 0x0a;
const FF = 0x0c;
const CR = 0x0d;
const SPACE = 0x20;
const PERCENT = 0x25;
const LPAREN = 0x28;
const RPAREN = 0x29;
const PLUS = 0x2b;
const MINUS = 0x2d;
const PERIOD = 0x2e;
const SOLIDUS = 0x2f;
const LESS = 0x3c;
const GREATER = 0x3e;
const LBRACKET = 0x5b;
const BACKSLASH = 0x5c;
const RBRACKET = 0x5d;
const LBRACE = 0x7b;
const RBRACE = 0x7d;
const NUMBER_SIGN = 0x23;

/** LEX-1 */
export const isWhite = (c: number) =>
  c === NUL || c === HT || c === LF || c === FF || c === CR || c === SPACE;

/** LEX-2 */
export const isDelimiter = (c: number) =>
  c === LPAREN ||
  c === RPAREN ||
  c === LESS ||
  c === GREATER ||
  c === LBRACKET ||
  c === RBRACKET ||
  c === LBRACE ||
  c === RBRACE ||
  c === SOLIDUS ||
  c === PERCENT;

const isRegular = (c: number) => !isWhite(c) && !isDelimiter(c);
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

/** The value of a hex digit, or -1. */
export function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

/** Reads tokens from `bytes`; offsets are reported as `base` + index. */
export class Lexer {
  readonly bytes: Uint8Array;
  readonly base: number;
  pos = 0;
  /** Problems found while reading tokens; set by the parser. */
  report: (id: LexerProblem, message: string, offset: number) => void = () => {};

  constructor(bytes: Uint8Array, base = 0) {
    this.bytes = bytes;
    this.base = base;
  }

  /** LEX-1, LEX-3: skips white space and comments. */
  skipWhite() {
    const b = this.bytes;
    while (this.pos < b.length) {
      const c = b[this.pos] as number;
      if (isWhite(c)) this.pos++;
      else if (c === PERCENT) {
        while (this.pos < b.length && b[this.pos] !== CR && b[this.pos] !== LF) this.pos++;
      } else break;
    }
  }

  next(): Token {
    // A loop, not recursion: stray bytes can repeat thousands of times (REQ-PDF-003).
    for (;;) {
      const t = this.token();
      if (t) return t;
    }
  }

  /** One token, or null after skipping a stray ">" or ")". */
  private token(): Token | null {
    this.skipWhite();
    const b = this.bytes;
    const start = this.pos;
    const at = (end: number) => ({ start: this.base + start, end: this.base + end });
    if (start >= b.length) return { kind: 'eof', ...at(start) };
    const c = b[start] as number;
    switch (c) {
      case LPAREN:
        return this.literal();
      case LESS:
        if (b[start + 1] === LESS) {
          this.pos += 2;
          return { kind: 'open-dict', ...at(this.pos) };
        }
        return this.hexString();
      case GREATER:
        if (b[start + 1] === GREATER) {
          this.pos += 2;
          return { kind: 'close-dict', ...at(this.pos) };
        }
        this.pos++;
        this.report('pdf.syntax.error', 'A lone ">" is not a token.', this.base + start);
        return null;
      case RPAREN:
        this.pos++;
        this.report('pdf.syntax.error', 'A ")" with no "(" before it.', this.base + start);
        return null;
      case LBRACKET:
        this.pos++;
        return { kind: 'open-array', ...at(this.pos) };
      case RBRACKET:
        this.pos++;
        return { kind: 'close-array', ...at(this.pos) };
      case LBRACE:
        this.pos++;
        return { kind: 'open-brace', ...at(this.pos) };
      case RBRACE:
        this.pos++;
        return { kind: 'close-brace', ...at(this.pos) };
      case SOLIDUS:
        return this.name();
      default:
        return this.regular();
    }
  }

  /** OBJ-2, LEX-4: a run of regular characters is a number or a keyword. */
  private regular(): Token {
    const b = this.bytes;
    const start = this.pos;
    while (this.pos < b.length && isRegular(b[this.pos] as number)) this.pos++;
    const at = { start: this.base + start, end: this.base + this.pos };
    const run = b.subarray(start, this.pos);
    const text = String.fromCharCode(...run.subarray(0, 64));
    const number = parseNumber(run);
    if (number === null) return { kind: 'keyword', text, ...at };
    if (run.length > MAX_NUMBER || (number.integer && !Number.isSafeInteger(number.value))) {
      this.report('pdf.value-too-large', `The number ${text} is too large to use.`, at.start);
      return { kind: 'keyword', text: 'null', ...at };
    }
    return { kind: 'number', ...number, ...at };
  }

  /** OBJ-3 */
  private literal(): Token {
    const b = this.bytes;
    const start = this.pos;
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const c = b[this.pos++] as number;
      if (c === BACKSLASH) {
        if (this.pos >= b.length) break;
        const e = b[this.pos++] as number;
        const simple = ESCAPES.get(e);
        if (simple !== undefined) out.push(simple);
        else if (e >= 0x30 && e <= 0x37) {
          let value = e - 0x30;
          for (let i = 0; i < 2 && this.pos < b.length; i++) {
            const d = b[this.pos] as number;
            if (d < 0x30 || d > 0x37) break;
            value = value * 8 + (d - 0x30);
            this.pos++;
          }
          // High-order overflow is ignored.
          out.push(value & 0xff);
        } else if (e === CR) {
          if (b[this.pos] === LF) this.pos++;
        } else if (e !== LF) {
          // Any other escaped byte: the backslash is dropped.
          out.push(e);
        }
      } else if (c === LPAREN) {
        depth++;
        out.push(c);
      } else if (c === RPAREN) {
        depth--;
        if (depth === 0) {
          return this.stringToken(out, false, start);
        }
        out.push(c);
      } else if (c === CR) {
        out.push(LF);
        if (b[this.pos] === LF) this.pos++;
      } else out.push(c);
    }
    this.report('pdf.syntax.error', 'A literal string has no closing ")".', this.base + start);
    return this.stringToken(out, false, start);
  }

  /** OBJ-4 */
  private hexString(): Token {
    const b = this.bytes;
    const start = this.pos;
    this.pos++;
    const out: number[] = [];
    let high = -1;
    let bad = false;
    let closed = false;
    while (this.pos < b.length) {
      const c = b[this.pos++] as number;
      if (c === GREATER) {
        closed = true;
        break;
      }
      if (isWhite(c)) continue;
      const v = hexValue(c);
      if (v < 0) {
        bad = true;
        continue;
      }
      if (high < 0) high = v;
      else {
        out.push(high * 16 + v);
        high = -1;
      }
    }
    if (high >= 0) out.push(high * 16);
    if (bad)
      this.report(
        'pdf.syntax.error',
        'A hex string holds bytes that are not hex digits.',
        this.base + start,
      );
    if (!closed)
      this.report('pdf.syntax.error', 'A hex string has no closing ">".', this.base + start);
    return this.stringToken(out, true, start);
  }

  private stringToken(out: number[], hex: boolean, start: number): Token {
    return {
      kind: 'string',
      bytes: Uint8Array.from(out),
      hex,
      start: this.base + start,
      end: this.base + this.pos,
    };
  }

  /** OBJ-5 */
  private name(): Token {
    const b = this.bytes;
    const start = this.pos;
    this.pos++;
    const out: number[] = [];
    let bad = false;
    while (this.pos < b.length && isRegular(b[this.pos] as number)) {
      const c = b[this.pos++] as number;
      if (c === NUMBER_SIGN) {
        const h = hexValue(b[this.pos] ?? -1);
        const l = hexValue(b[this.pos + 1] ?? -1);
        if (h >= 0 && l >= 0) {
          out.push(h * 16 + l);
          this.pos += 2;
          continue;
        }
        bad = true;
      }
      out.push(c);
    }
    if (bad)
      this.report(
        'pdf.syntax.error',
        'A "#" in a name is not followed by two hex digits.',
        this.base + start,
      );
    return {
      kind: 'name',
      bytes: Uint8Array.from(out),
      start: this.base + start,
      end: this.base + this.pos,
    };
  }
}

// Table 3
const ESCAPES = new Map<number, number>([
  [0x6e, LF], // n
  [0x72, CR], // r
  [0x74, HT], // t
  [0x62, 0x08], // b
  [0x66, FF], // f
  [LPAREN, LPAREN],
  [RPAREN, RPAREN],
  [BACKSLASH, BACKSLASH],
]);

/** OBJ-2: number tokens longer than this give pdf.value-too-large. */
const MAX_NUMBER = 32;

/** OBJ-2: digits with an optional sign and at most one period, with at least one digit. */
function parseNumber(run: Uint8Array): { value: number; integer: boolean } | null {
  let i = 0;
  if (run[0] === PLUS || run[0] === MINUS) i++;
  let digits = 0;
  let periods = 0;
  for (; i < run.length; i++) {
    const c = run[i] as number;
    if (isDigit(c)) digits++;
    else if (c === PERIOD) periods++;
    else return null;
  }
  if (digits === 0 || periods > 1) return null;
  // OBJ-2: a longer token is too large; it is never turned into a string.
  if (run.length > MAX_NUMBER) return { value: Number.POSITIVE_INFINITY, integer: true };
  const text = String.fromCharCode(...run);
  return periods === 0
    ? { value: Number.parseInt(text, 10), integer: true }
    : { value: Number.parseFloat(text), integer: false };
}

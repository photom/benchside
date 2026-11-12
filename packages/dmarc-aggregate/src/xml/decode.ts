/** Encodings for the XML reader (XML-1, XML-2, XML-10; design: dmarc-aggregate-design/xml.md). */

/** The encoding chosen for an input: a `TextDecoder` name; UTF-16 is transcoded to UTF-8. */
export interface Encoding {
  /** `TextDecoder` encoding name, such as `utf-8`, `windows-1252`, `utf-16le`. */
  readonly name: string;
  readonly utf16: 'le' | 'be' | null;
}

export type Detected =
  | { readonly kind: 'more' }
  | { readonly kind: 'ok'; readonly encoding: Encoding; readonly skip: number }
  | { readonly kind: 'unknown'; readonly label: string }
  /** Not ASCII-compatible, so markup bytes can occur inside characters (XML-1). */
  | { readonly kind: 'incompatible'; readonly label: string };

/** Encodings `TextDecoder` knows whose characters can contain ASCII markup bytes. */
const INCOMPATIBLE = new Set(['iso-2022-jp', 'replacement']);

const UTF8: Encoding = { name: 'utf-8', utf16: null };

/** XML-1: BOM first, then the declared `encoding`, else UTF-8. Needs the bytes up to `?>`. */
export function detect(head: Uint8Array, final: boolean): Detected {
  const bom = bomAt(head, 0);
  if (bom === 'utf-8') return { kind: 'ok', encoding: UTF8, skip: 3 };
  if (bom === 'utf-16le')
    return { kind: 'ok', encoding: { name: 'utf-16le', utf16: 'le' }, skip: 2 };
  if (bom === 'utf-16be')
    return { kind: 'ok', encoding: { name: 'utf-16be', utf16: 'be' }, skip: 2 };
  // Wait while the bytes so far could still be the start of a BOM.
  const h0 = head[0];
  if (!final && head.length === 1 && (h0 === 0xef || h0 === 0xfe || h0 === 0xff))
    return { kind: 'more' };
  if (!final && head.length === 2 && h0 === 0xef && head[1] === 0xbb) return { kind: 'more' };
  if (head.length < 2 && !final) return { kind: 'more' };
  const decl = declaration(head, 0, final);
  if (decl === 'more') return { kind: 'more' };
  if (decl === null || decl === 'long' || decl.encoding === null) {
    return { kind: 'ok', encoding: UTF8, skip: 0 };
  }
  const name = resolve(decl.encoding);
  if (name === null) return { kind: 'unknown', label: decl.encoding };
  if (INCOMPATIBLE.has(name)) return { kind: 'incompatible', label: decl.encoding };
  // The declaration was just read as ASCII, so a label naming UTF-16 without a BOM is wrong:
  // the bytes are ASCII-compatible, and UTF-8 reads them.
  if (name.startsWith('utf-16')) return { kind: 'ok', encoding: UTF8, skip: 0 };
  return { kind: 'ok', encoding: { name, utf16: null }, skip: 0 };
}

/** The `TextDecoder` name for a label, or null when it does not know the label. */
export function resolve(label: string): string | null {
  try {
    return new TextDecoder(label.trim()).encoding;
  } catch {
    return null;
  }
}

export function bomAt(b: Uint8Array, at: number): 'utf-8' | 'utf-16le' | 'utf-16be' | null {
  if (b[at] === 0xef && b[at + 1] === 0xbb && b[at + 2] === 0xbf) return 'utf-8';
  if (b[at] === 0xff && b[at + 1] === 0xfe) return 'utf-16le';
  if (b[at] === 0xfe && b[at + 1] === 0xff) return 'utf-16be';
  return null;
}

const ASCII = new TextDecoder('latin1');

/**
 * The XML declaration at `at`, read as ASCII: null when there is none, `more` when it may be cut.
 * `encoding` is null when the declaration has no `encoding`; `long` when it has no `?>` within
 * 1024 bytes, which the reader reports as malformed.
 */
export function declaration(
  b: Uint8Array,
  at: number,
  final: boolean,
): { encoding: string | null; end: number } | null | 'more' | 'long' {
  const want = '<?xml';
  for (let i = 0; i < want.length; i++) {
    if (at + i >= b.length) return final ? null : 'more';
    if (b[at + i] !== want.charCodeAt(i)) return null;
  }
  const after = b[at + 5];
  if (after === undefined) return final ? null : 'more';
  if (after !== 0x20 && after !== 0x09 && after !== 0x0a && after !== 0x0d) return null;
  let end = -1;
  for (let i = at + 5; i + 1 < b.length && i < at + 1024; i++) {
    if (b[i] === 0x3f && b[i + 1] === 0x3e) {
      end = i + 2;
      break;
    }
  }
  if (end < 0) {
    if (b.length - at >= 1024) return 'long';
    return final ? null : 'more';
  }
  const text = ASCII.decode(b.subarray(at, end));
  const m = /\sencoding\s*=\s*(["'])([^"']*)\1/.exec(text);
  return { encoding: m ? (m[2] as string) : null, end };
}

/**
 * UTF-16 to UTF-8, chunk by chunk. A lone surrogate becomes U+FFFD; the reader then reports it
 * when it decodes the value (XML-2).
 */
export class Utf16ToUtf8 {
  private carry: number | null = null;
  private high: number | null = null;

  constructor(private readonly order: 'le' | 'be') {}

  push(bytes: Uint8Array, final: boolean): Uint8Array {
    // Each 2-byte unit gives at most 3 UTF-8 bytes; a pair from the last call adds at most 4.
    const out = new Uint8Array(Math.ceil((bytes.length + 1) / 2) * 3 + 8);
    let n = 0;
    const put = (cp: number) => {
      if (cp < 0x80) out[n++] = cp;
      else if (cp < 0x800) {
        out[n++] = 0xc0 | (cp >> 6);
        out[n++] = 0x80 | (cp & 63);
      } else if (cp < 0x10000) {
        out[n++] = 0xe0 | (cp >> 12);
        out[n++] = 0x80 | ((cp >> 6) & 63);
        out[n++] = 0x80 | (cp & 63);
      } else {
        out[n++] = 0xf0 | (cp >> 18);
        out[n++] = 0x80 | ((cp >> 12) & 63);
        out[n++] = 0x80 | ((cp >> 6) & 63);
        out[n++] = 0x80 | (cp & 63);
      }
    };
    const unit = (u: number) => {
      if (this.high !== null) {
        if (u >= 0xdc00 && u <= 0xdfff) {
          put(0x10000 + ((this.high - 0xd800) << 10) + (u - 0xdc00));
          this.high = null;
          return;
        }
        this.high = null;
        put(0xfffd);
      }
      if (u >= 0xd800 && u <= 0xdbff) this.high = u;
      else if (u >= 0xdc00 && u <= 0xdfff) put(0xfffd);
      else put(u);
    };
    const le = this.order === 'le';
    let i = 0;
    if (this.carry !== null && bytes.length > 0) {
      const b0 = bytes[0] as number;
      unit(le ? this.carry | (b0 << 8) : (this.carry << 8) | b0);
      this.carry = null;
      i = 1;
    }
    for (; i + 1 < bytes.length; i += 2) {
      const a = bytes[i] as number;
      const b = bytes[i + 1] as number;
      unit(le ? a | (b << 8) : (a << 8) | b);
    }
    if (i < bytes.length) this.carry = bytes[i] as number;
    if (final) {
      if (this.high !== null) {
        this.high = null;
        put(0xfffd);
      }
      if (this.carry !== null) {
        this.carry = null;
        put(0xfffd);
      }
    }
    return out.subarray(0, n);
  }
}

/** Decodes one value; reports whether invalid bytes were replaced with U+FFFD (XML-2). */
export class ValueDecoder {
  private readonly fatal: TextDecoder;
  private readonly lenient: TextDecoder;

  constructor(name: string) {
    // A value may start with U+FEFF; only the document's BOM is skipped (XML-1).
    this.fatal = new TextDecoder(name, { fatal: true, ignoreBOM: true });
    this.lenient = new TextDecoder(name, { ignoreBOM: true });
  }

  decode(b: Uint8Array): { text: string; replaced: boolean } {
    try {
      return { text: this.fatal.decode(b), replaced: false };
    } catch {
      return { text: this.lenient.decode(b), replaced: true };
    }
  }
}

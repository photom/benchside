/** The XML reader: tokens, names, tree, several documents, digests (XML-1 to XML-11). */

import { Sha256 } from '../sha256.ts';
import {
  bomAt,
  declaration,
  detect,
  type Encoding,
  resolve,
  Utf16ToUtf8,
  ValueDecoder,
} from './decode.ts';
export interface XmlFinding {
  readonly id:
    | 'aggregate.xml.encoding'
    | 'aggregate.xml.doctype'
    | 'aggregate.xml.malformed'
    | 'aggregate.input.too-large';
  readonly severity: 'error' | 'warning';
  /** 1-based line and column (in bytes) where the problem starts. */
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface XmlElement {
  readonly ns: string | null;
  readonly prefix: string | null;
  readonly local: string;
  readonly lang: string | null;
  /** Character data and CDATA, joined and trimmed (XML-8, XML-9); empty when there are children. */
  readonly text: string;
  readonly line: number;
  readonly children: readonly XmlElement[];
}

export interface XmlDocument {
  readonly root: XmlElement;
  /** Warnings about this document (XML-2). */
  readonly findings: readonly XmlFinding[];
  /** SHA-256 of the bytes read for this document, as lowercase hex (XML-11). */
  readonly digest: string;
}

export interface XmlOutput {
  /** Documents completed by this call, in order. */
  readonly documents: readonly XmlDocument[];
  /** An error that ends reading of this input; later calls do nothing (XML-4, XML-6, XML-10). */
  readonly stop: XmlFinding | null;
}

const MAX_DEPTH = 32;
const REPLACEMENT = String.fromCharCode(0xfffd);
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

class Stop {
  constructor(readonly finding: XmlFinding) {}
}
/** Thrown when a token runs past the bytes received so far. */
const MORE = Symbol('more');

interface Frame {
  readonly qname: string;
  readonly ns: string | null;
  readonly prefix: string | null;
  readonly local: string;
  readonly lang: string | null;
  readonly line: number;
  readonly scope: ReadonlyMap<string, string | null>;
  readonly children: XmlElement[];
  readonly parts: string[];
}

/** Reads one input, chunk by chunk (design: dmarc-aggregate-design/xml.md). */
export class XmlReader {
  private head: Uint8Array = new Uint8Array(0);
  /** Bytes to scan: `data[lo..hi)`, grown geometrically so long tokens stay linear. */
  private data: Uint8Array = new Uint8Array(0);
  private lo = 0;
  private hi = 0;
  /** Bytes of the pending token already searched, so a token over many chunks is not rescanned. */
  private hint = 0;
  /** Scan bytes consumed so far, and since the current document began (INP-6). */
  private streamPos = 0;
  private docBytes = 0;
  /** Digest of the current document's bytes so far (XML-11). */
  private hash = new Sha256();
  /** The current document's declaration or root start tag was read; its digest runs from there. */
  private begun = false;
  private readonly maxDocument: number;
  private encoding: Encoding | null = null;
  private utf16: Utf16ToUtf8 | null = null;
  private values: ValueDecoder | null = null;
  private stopped = false;
  private line = 1;
  private column = 1;
  private lastCR = false;
  private stack: Frame[] = [];
  private docs = 0;
  private replaced = false;
  private sawBom = false;
  private sawDeclaration = false;

  constructor(o: { readonly maxDocument?: number } = {}) {
    this.maxDocument = o.maxDocument ?? 32 * 1024 * 1024;
  }

  push(bytes: Uint8Array): XmlOutput {
    return this.feed(bytes, false);
  }

  end(): XmlOutput {
    return this.feed(new Uint8Array(0), true);
  }

  private feed(bytes: Uint8Array, final: boolean): XmlOutput {
    const documents: XmlDocument[] = [];
    if (this.stopped) return { documents, stop: null };
    try {
      let scan = bytes;
      if (this.encoding === null) {
        this.head = join(this.head, bytes);
        const d = detect(this.head, final);
        if (d.kind === 'more') return { documents, stop: null };
        if (d.kind === 'incompatible') {
          throw this.stop(
            'aggregate.xml.encoding',
            `The encoding "${d.label}" is not ASCII-compatible and cannot be read`,
          );
        }
        if (d.kind === 'unknown') {
          throw this.stop(
            'aggregate.xml.encoding',
            `TextDecoder does not know the encoding "${d.label}"`,
          );
        }
        this.encoding = d.encoding;
        this.values = new ValueDecoder(d.encoding.utf16 ? 'utf-8' : d.encoding.name);
        if (d.encoding.utf16) this.utf16 = new Utf16ToUtf8(d.encoding.utf16);
        scan = this.head.subarray(d.skip);
        this.head = new Uint8Array(0);
      }
      if (this.utf16) scan = this.utf16.push(scan, final);
      this.append(scan);
      this.scan(final, documents);
      return { documents, stop: null };
    } catch (e) {
      if (!(e instanceof Stop)) throw e;
      this.stopped = true;
      return { documents, stop: e.finding };
    }
  }

  private append(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    const pending = this.hi - this.lo;
    if (this.hi + bytes.length > this.data.length) {
      const need = pending + bytes.length;
      if (need <= this.data.length) {
        this.data.copyWithin(0, this.lo, this.hi);
      } else {
        const next = new Uint8Array(Math.max(need, this.data.length * 2, 65536));
        next.set(this.data.subarray(this.lo, this.hi));
        this.data = next;
      }
      this.lo = 0;
      this.hi = pending;
    }
    this.data.set(bytes, this.hi);
    this.hi += bytes.length;
  }

  private scan(final: boolean, documents: XmlDocument[]): void {
    const b = this.data.subarray(this.lo, this.hi);
    let p = 0;
    /** Start of the bytes of `b` not yet hashed. */
    let hashed = 0;
    for (;;) {
      if (p >= b.length) {
        this.hint = 0;
        break;
      }
      let next: number;
      const kept = documents.length;
      const docs = this.docs;
      const begun = this.begun;
      try {
        next = this.token(b, p, final, documents);
      } catch (e) {
        if (e !== MORE) throw e;
        if (final) throw this.stop('aggregate.xml.malformed', 'The input ends inside markup');
        // Markers are at most 9 bytes long, so searching again from 16 bytes back is enough.
        this.hint = Math.max(0, b.length - p - 16);
        break;
      }
      this.hint = 0;
      this.advance(b, p, next);
      // Bytes count toward the document they belong to; a finished document starts the count again.
      if (this.docBytes > this.maxDocument) {
        // A document that ended in the token that crossed the limit is too large too.
        documents.length = kept;
        throw this.tooLarge();
      }
      if (!begun) {
        // White space, comments, PIs, and a BOM before the document are not part of its digest.
        if (this.begun || this.stack.length > 0 || this.docs !== docs) {
          this.begun = true;
          hashed = p;
        } else {
          hashed = next;
        }
      }
      if (this.docs !== docs) {
        this.begun = false;
        this.docBytes = 0;
        this.hash.update(b.subarray(hashed, next));
        (documents[documents.length - 1] as { digest: string }).digest = this.hash.digest();
        this.hash = new Sha256();
        hashed = next;
      }
      p = next;
    }
    this.hash.update(b.subarray(hashed, p));
    this.lo += p;
    if (this.docBytes + (b.length - p) > this.maxDocument) throw this.tooLarge();
    if (final && this.stack.length > 0) {
      throw this.stop('aggregate.xml.malformed', `Element <${this.top().qname}> is left open`);
    }
    if (final && this.docs === 0) throw this.stop('aggregate.xml.malformed', 'No root element');
  }

  /** Reads one token at `p` and returns where the next one starts. */
  private token(b: Uint8Array, p: number, final: boolean, documents: XmlDocument[]): number {
    const c = b[p] as number;
    if (c !== 0x3c) {
      if (this.stack.length === 0) return this.outside(b, p, final);
      const lt = b.indexOf(0x3c, p + (p === 0 ? this.hint : 0));
      if (lt < 0 && !final) throw MORE;
      const end = lt < 0 ? b.length : lt;
      this.top().parts.push(this.text(b.subarray(p, end)));
      return end;
    }
    if (startsWith(b, p, '<!--', final)) {
      const end = find(b, p + Math.max(4, p === 0 ? this.hint : 0), '-->');
      return end + 3;
    }
    if (startsWith(b, p, '<![CDATA[', final)) {
      if (this.stack.length === 0)
        throw this.stop('aggregate.xml.malformed', 'CDATA outside the root');
      const end = find(b, p + Math.max(9, p === 0 ? this.hint : 0), ']]>');
      this.top().parts.push(this.decode(b.subarray(p + 9, end)).replace(/\r\n?/g, '\n'));
      return end + 3;
    }
    if (startsWith(b, p, '<!DOCTYPE', final)) {
      throw this.stop('aggregate.xml.doctype', 'A document type declaration is refused (§8.1)');
    }
    if (b[p + 1] === undefined) throw MORE;
    if (b[p + 1] === 0x3f) return this.instruction(b, p, final);
    if (b[p + 1] === 0x21) throw this.stop('aggregate.xml.malformed', 'Unknown markup after <!');
    if (b[p + 1] === 0x2f) return this.endTag(b, p, documents);
    return this.startTag(b, p, documents);
  }

  /** White space between documents and around the root; a BOM may start the next document. */
  private outside(b: Uint8Array, p: number, final: boolean): number {
    let q = p;
    while (q < b.length && isSpace(b[q] as number)) q++;
    if (q > p) return q;
    if (this.docs > 0 && (b[p] === 0xef || b[p] === 0xfe || b[p] === 0xff)) {
      if (b.length - p < 3 && !final) throw MORE;
      return this.laterBom(b, p);
    }
    throw this.stop('aggregate.xml.malformed', 'Text outside the root element');
  }

  /** XML-10: a BOM before a later document must name the first document's encoding. */
  private laterBom(b: Uint8Array, p: number): number {
    const enc = this.encoding as Encoding;
    if (this.sawBom || this.sawDeclaration) {
      throw this.stop('aggregate.xml.malformed', 'A BOM may only open a document, once');
    }
    if (this.utf16) {
      // Transcoded: U+FEFF (EF BB BF) is the same byte order; U+FFFE (EF BF BE) is the other one.
      if (b[p] === 0xef && b[p + 1] === 0xbb && b[p + 2] === 0xbf) {
        this.sawBom = true;
        return p + 3;
      }
      throw this.stop('aggregate.xml.encoding', `A later document's BOM does not name ${enc.name}`);
    }
    const bom = bomAt(b, p);
    if (bom === 'utf-8' && enc.name === 'utf-8') {
      this.sawBom = true;
      return p + 3;
    }
    if (bom === null) throw this.stop('aggregate.xml.malformed', 'Text outside the root element');
    throw this.stop(
      'aggregate.xml.encoding',
      `A later document's BOM names ${bom}, not ${enc.name}`,
    );
  }

  /** The XML declaration (checked for later documents, XML-10) or a processing instruction. */
  private instruction(b: Uint8Array, p: number, final: boolean): number {
    const decl = declaration(b, p, final);
    if (decl === 'more') throw MORE;
    if (decl === 'long') {
      throw this.stop('aggregate.xml.malformed', 'An XML declaration runs past 1024 bytes');
    }
    if (decl !== null) {
      if (this.stack.length > 0)
        throw this.stop('aggregate.xml.malformed', 'XML declaration inside an element');
      this.begun = true;
      // XML 1.0: the declaration opens a document. The first one must be at the very start;
      // a later one may follow white space, comments, and PIs, once (XML-10).
      const misplaced = this.docs === 0 ? this.streamPos !== 0 : this.sawDeclaration;
      if (misplaced) {
        throw this.stop(
          'aggregate.xml.malformed',
          'An XML declaration is not at the start of a document',
        );
      }
      if (this.docs > 0) {
        this.sawDeclaration = true;
        // With a BOM, the BOM named the encoding and the declaration is not checked (XML-10).
        if (!this.sawBom) this.checkLater(decl.encoding);
      }
      return decl.end;
    }
    return find(b, p + Math.max(2, p === 0 ? this.hint : 0), '?>') + 2;
  }

  /** XML-10: a later document's declared encoding, or UTF-8 when none, must be the first one's. */
  private checkLater(label: string | null): void {
    const enc = this.encoding as Encoding;
    let name = label === null ? 'utf-8' : resolve(label);
    // As in XML-1: a declaration read as ASCII that names UTF-16 means UTF-8.
    if (name !== null && !this.utf16 && name.startsWith('utf-16')) name = 'utf-8';
    if (name === null)
      throw this.stop(
        'aggregate.xml.encoding',
        `TextDecoder does not know the encoding "${label}"`,
      );
    const same = this.utf16 ? name.startsWith('utf-16') : name === enc.name;
    if (!same)
      throw this.stop('aggregate.xml.encoding', `A later document is ${name}, not ${enc.name}`);
  }

  private startTag(b: Uint8Array, p: number, documents: XmlDocument[]): number {
    let q = p + 1;
    const [qname, afterName] = this.name(b, q);
    q = afterName;
    const attrs = new Map<string, string>();
    let selfClosing = false;
    for (;;) {
      const before = q;
      while (q < b.length && isSpace(b[q] as number)) q++;
      if (q >= b.length) throw MORE;
      if (b[q] === 0x3e) {
        q++;
        break;
      }
      if (b[q] === 0x2f) {
        if (q + 1 >= b.length) throw MORE;
        if (b[q + 1] !== 0x3e)
          throw this.stop('aggregate.xml.malformed', 'Expected /> to close the tag');
        selfClosing = true;
        q += 2;
        break;
      }
      if (q === before)
        throw this.stop('aggregate.xml.malformed', 'Attributes must be separated by white space');
      const [attr, afterAttr] = this.name(b, q);
      q = afterAttr;
      while (q < b.length && isSpace(b[q] as number)) q++;
      if (q >= b.length) throw MORE;
      if (b[q] !== 0x3d)
        throw this.stop('aggregate.xml.malformed', `Attribute ${attr} has no value`);
      q++;
      while (q < b.length && isSpace(b[q] as number)) q++;
      if (q >= b.length) throw MORE;
      const quote = b[q] as number;
      if (quote !== 0x22 && quote !== 0x27) {
        throw this.stop('aggregate.xml.malformed', `Attribute ${attr} is not quoted`);
      }
      const close = b.indexOf(quote, Math.max(q + 1, p === 0 ? this.hint : 0));
      if (close < 0) throw MORE;
      const raw = b.subarray(q + 1, close);
      if (raw.includes(0x3c))
        throw this.stop('aggregate.xml.malformed', `Attribute ${attr} contains <`);
      if (attrs.has(attr))
        throw this.stop('aggregate.xml.malformed', `Attribute ${attr} is repeated`);
      attrs.set(attr, this.text(raw));
      q = close + 1;
    }
    this.open(qname, attrs);
    if (selfClosing) this.close(qname, documents);
    return q;
  }

  private endTag(b: Uint8Array, p: number, documents: XmlDocument[]): number {
    const [qname, afterName] = this.name(b, p + 2);
    let q = afterName;
    while (q < b.length && isSpace(b[q] as number)) q++;
    if (q >= b.length) throw MORE;
    if (b[q] !== 0x3e) throw this.stop('aggregate.xml.malformed', `Malformed end tag </${qname}`);
    this.close(qname, documents);
    return q + 1;
  }

  private open(qname: string, attrs: Map<string, string>): void {
    if (this.stack.length === 0 && this.docs > 0 && !this.sawBom && !this.sawDeclaration) {
      this.checkLater(null);
    }
    if (this.stack.length >= MAX_DEPTH) {
      throw this.stop('aggregate.xml.malformed', `Elements nest deeper than ${MAX_DEPTH}`);
    }
    const parent = this.stack.at(-1);
    let scope: ReadonlyMap<string, string | null> = parent?.scope ?? new Map([['xml', XML_NS]]);
    for (const [name, value] of attrs) {
      if (name !== 'xmlns' && !name.startsWith('xmlns:')) continue;
      const copy = new Map(scope);
      copy.set(name === 'xmlns' ? '' : name.slice(6), value === '' ? null : value);
      scope = copy;
    }
    const colon = qname.indexOf(':');
    const prefix = colon < 0 ? null : qname.slice(0, colon);
    const local = colon < 0 ? qname : qname.slice(colon + 1);
    const ns = scope.get(prefix ?? '');
    if (prefix !== null && (ns === undefined || ns === null)) {
      throw this.stop('aggregate.xml.malformed', `Prefix ${prefix} is not bound to a namespace`);
    }
    this.stack.push({
      qname,
      ns: ns ?? null,
      prefix,
      local,
      lang: attrs.get('lang') ?? null,
      line: this.line,
      scope,
      children: [],
      parts: [],
    });
  }

  private close(qname: string, documents: XmlDocument[]): void {
    const frame = this.stack.pop();
    if (frame === undefined)
      throw this.stop('aggregate.xml.malformed', `End tag </${qname}> without a start tag`);
    if (frame.qname !== qname) {
      throw this.stop(
        'aggregate.xml.malformed',
        `End tag </${qname}> does not match <${frame.qname}>`,
      );
    }
    const element: XmlElement = {
      ns: frame.ns,
      prefix: frame.prefix,
      local: frame.local,
      lang: frame.lang,
      text: frame.children.length > 0 ? '' : trim(frame.parts.join('')),
      line: frame.line,
      children: frame.children,
    };
    const parent = this.stack.at(-1);
    if (parent) {
      parent.children.push(element);
      return;
    }
    const findings: XmlFinding[] = [];
    if (this.replaced) {
      findings.push({
        id: 'aggregate.xml.encoding',
        severity: 'warning',
        line: element.line,
        column: 1,
        message: 'Bytes invalid in the encoding were replaced with U+FFFD',
      });
    }
    documents.push({ root: element, findings, digest: '' });
    this.docs++;
    this.replaced = false;
    this.sawBom = false;
    this.sawDeclaration = false;
  }

  /** A name at `q`: bytes up to white space or `/ > = < ? !` quotes. */
  private name(b: Uint8Array, q: number): [string, number] {
    let e = q;
    while (e < b.length && !isNameEnd(b[e] as number)) e++;
    if (e >= b.length) throw MORE;
    if (e === q) throw this.stop('aggregate.xml.malformed', 'A name is missing');
    return [this.decode(b.subarray(q, e)), e];
  }

  /** Character data or an attribute value: references replaced (XML-5), line ends as LF (XML-2). */
  private text(raw: Uint8Array): string {
    let out = '';
    let from = 0;
    for (let amp = raw.indexOf(0x26); amp >= 0; amp = raw.indexOf(0x26, from)) {
      // Line ends are normalized in the input, before references: &#13; stays CR (XML-2).
      out += this.decode(raw.subarray(from, amp)).replace(/\r\n?/g, '\n');
      const semi = raw.indexOf(0x3b, amp);
      if (semi < 0 || semi - amp > 12)
        throw this.stop('aggregate.xml.malformed', 'A reference has no ;');
      out += this.reference(String.fromCharCode(...raw.subarray(amp + 1, semi)));
      from = semi + 1;
    }
    return out + this.decode(raw.subarray(from)).replace(/\r\n?/g, '\n');
  }

  private reference(name: string): string {
    const predefined: Record<string, string> = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' };
    const known = predefined[name];
    if (known !== undefined) return known;
    const m = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(name);
    if (!m)
      throw this.stop(
        'aggregate.xml.malformed',
        `Entity &${name}; is not one of the five predefined ones`,
      );
    const cp = m[1] !== undefined ? Number.parseInt(m[1], 16) : Number(m[2]);
    const allowed =
      cp === 0x9 ||
      cp === 0xa ||
      cp === 0xd ||
      (cp >= 0x20 && cp <= 0xd7ff) ||
      (cp >= 0xe000 && cp <= 0xfffd) ||
      (cp >= 0x10000 && cp <= 0x10ffff);
    if (!allowed)
      throw this.stop('aggregate.xml.malformed', `&${name}; is a code point XML does not allow`);
    return String.fromCodePoint(cp);
  }

  private decode(raw: Uint8Array): string {
    const r = (this.values as ValueDecoder).decode(raw);
    // In UTF-16 input a lone surrogate was transcoded to U+FFFD before this value was decoded.
    if (r.replaced || (this.utf16 && r.text.includes(REPLACEMENT))) this.replaced = true;
    return r.text;
  }

  private top(): Frame {
    return this.stack.at(-1) as Frame;
  }

  private tooLarge(): Stop {
    return this.stop(
      'aggregate.input.too-large',
      `A document passes ${this.maxDocument} bytes (INP-6)`,
    );
  }

  private stop(id: XmlFinding['id'], message: string): Stop {
    return new Stop({ id, severity: 'error', line: this.line, column: this.column, message });
  }

  /** XML-2 line ends: LF, CR LF, and a lone CR each end a line. */
  private advance(b: Uint8Array, from: number, to: number): void {
    this.streamPos += to - from;
    this.docBytes += to - from;
    for (let i = from; i < to; i++) {
      const c = b[i] as number;
      if (c === 0x0d) {
        this.line++;
        this.column = 1;
        this.lastCR = true;
      } else if (c === 0x0a) {
        if (!this.lastCR) {
          this.line++;
          this.column = 1;
        }
        this.lastCR = false;
      } else {
        this.column++;
        this.lastCR = false;
      }
    }
  }
}

function join(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Whether `text` starts at `p`; throws MORE when the bytes so far are a prefix of it. */
function startsWith(b: Uint8Array, p: number, text: string, final: boolean): boolean {
  for (let i = 0; i < text.length; i++) {
    if (p + i >= b.length) {
      if (final) return false;
      throw MORE;
    }
    if (b[p + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** The index of `text` at or after `from`; throws MORE when it is not there yet. */
function find(b: Uint8Array, from: number, text: string): number {
  const first = text.charCodeAt(0);
  for (let i = b.indexOf(first, from); i >= 0; i = b.indexOf(first, i + 1)) {
    let ok = true;
    for (let k = 1; k < text.length; k++) {
      if (b[i + k] !== text.charCodeAt(k)) {
        ok = false;
        break;
      }
    }
    if (ok && i + text.length <= b.length) return i;
  }
  throw MORE;
}

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function isNameEnd(c: number): boolean {
  return (
    isSpace(c) ||
    c === 0x2f ||
    c === 0x3e ||
    c === 0x3d ||
    c === 0x3c ||
    c === 0x3f ||
    c === 0x21 ||
    c === 0x22 ||
    c === 0x27
  );
}

/** XML-9: space, tab, and LF (line ends are LF by then). */
function trim(s: string): string {
  return s.replace(/^[ \t\n]+|[ \t\n]+$/g, '');
}

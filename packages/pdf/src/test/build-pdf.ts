/** Builds PDF bytes for tests, recording where each part lands. */
import { deflateSync } from 'node:zlib';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
export const EOL = { CRLF: CR + LF, LF, CR, SPACE_LF: ` ${LF}` } as const;

export const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const toBytes = (d: string | Uint8Array) => (typeof d === 'string' ? latin1(d) : d);

export interface BuilderOptions {
  /** Default 1.7; null writes no header. */
  readonly version?: string | null;
  /** HDR-3: a comment with four bytes of 0x80 or more after the header. */
  readonly binary?: boolean;
  /** Bytes before the header. */
  readonly prepend?: string | Uint8Array;
}

export interface TableOptions {
  /** Extra trailer entries, e.g. "/Root 1 0 R". */
  readonly trailer?: string;
  /** Overrides /Size. */
  readonly size?: number;
  /** The entry end-of-line; 20-byte entries use CRLF or SPACE_LF. */
  readonly eol?: string;
  /** Overrides the startxref offset. */
  readonly startxref?: number;
  /** Writes no trailer keyword and dictionary. */
  readonly noTrailer?: boolean;
  /** Writes no startxref and %%EOF. */
  readonly noTail?: boolean;
  /** Writes this /Prev instead of the previous section's offset. */
  readonly prev?: number | null;
}

export interface StreamSectionOptions {
  readonly trailer?: string;
  readonly w?: readonly [number, number, number];
  /** PNG predictor 12 (Up) with Columns = sum(W). */
  readonly predictor?: boolean;
  /** Flate-encodes the data. Default true. */
  readonly compress?: boolean;
  readonly size?: number;
  readonly prev?: number | null;
  /** Writes no startxref and %%EOF. */
  readonly noTail?: boolean;
}

type Entry =
  | { readonly type: 1; readonly offset: number; readonly generation: number }
  | { readonly type: 2; readonly container: number; readonly index: number };

export class PdfBuilder {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  /** Latest offset of each object. */
  readonly offsets = new Map<number, number>();
  /** Offsets of the sections, in the order written. */
  readonly sections: number[] = [];
  /** Where the header starts. */
  headerOffset = 0;
  private pending = new Map<number, Entry>();
  private maxNumber = 0;

  constructor(options: BuilderOptions = {}) {
    if (options.prepend !== undefined) this.raw(options.prepend);
    this.headerOffset = this.length;
    if (options.version !== null) this.raw(`%PDF-${options.version ?? '1.7'}${LF}`);
    if (options.binary) this.raw(Uint8Array.of(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a));
  }

  get offset() {
    return this.length;
  }

  raw(data: string | Uint8Array): this {
    const bytes = toBytes(data);
    this.parts.push(bytes);
    this.length += bytes.length;
    return this;
  }

  private record(num: number, generation: number) {
    this.offsets.set(num, this.length);
    this.pending.set(num, { type: 1, offset: this.length, generation });
    this.maxNumber = Math.max(this.maxNumber, num);
  }

  /** `num gen obj`, the body, `endobj`. */
  object(num: number, body: string, generation = 0): this {
    this.record(num, generation);
    return this.raw(`${num} ${generation} obj${LF}${body}${LF}endobj${LF}`);
  }

  /** A stream object; `/Length` is the data length unless `length` overrides it. */
  stream(
    num: number,
    dict: string,
    data: string | Uint8Array,
    options: { length?: string; eol?: string } = {},
  ): this {
    const bytes = toBytes(data);
    this.record(num, 0);
    this.raw(`${num} 0 obj${LF}<< /Length ${options.length ?? bytes.length} ${dict} >>${LF}stream`);
    this.raw(options.eol ?? EOL.CRLF);
    this.raw(bytes);
    return this.raw(`${LF}endstream${LF}endobj${LF}`);
  }

  /** An object stream (7.5.7) holding `members`; they become type-2 entries. */
  objectStream(num: number, members: readonly { num: number; body: string }[]): this {
    let head = '';
    let body = '';
    for (const m of members) {
      head += `${m.num} ${body.length} `;
      body += `${m.body}${LF}`;
    }
    const data = head + body;
    this.stream(num, `/Type /ObjStm /N ${members.length} /First ${head.length}`, data);
    members.forEach((m, index) => {
      this.pending.set(m.num, { type: 2, container: num, index });
      this.maxNumber = Math.max(this.maxNumber, m.num);
    });
    return this;
  }

  private takePending() {
    const entries = [...this.pending].sort(([a], [b]) => a - b);
    this.pending = new Map();
    return entries;
  }

  private tail(sectionOffset: number, startxref?: number) {
    this.raw(`startxref${LF}${startxref ?? sectionOffset}${LF}%%EOF${LF}`);
  }

  /** A cross-reference table and trailer for the objects written since the last section. */
  xrefTable(options: TableOptions = {}): this {
    const at = this.length;
    const first = this.sections.length === 0;
    const eol = options.eol ?? EOL.CRLF;
    const entries = this.takePending();
    let text = `xref${LF}`;
    const line = (offset: number, gen: number, kind: string) =>
      `${String(offset).padStart(10, '0')} ${String(gen).padStart(5, '0')} ${kind}${eol}`;
    if (first) {
      const byNumber = new Map(entries);
      text += `0 ${this.maxNumber + 1}${LF}`;
      text += line(0, 65535, 'f');
      for (let n = 1; n <= this.maxNumber; n++) {
        const e = byNumber.get(n);
        text += e?.type === 1 ? line(e.offset, e.generation, 'n') : line(0, 0, 'f');
      }
    } else {
      for (const [n, e] of entries) {
        if (e.type !== 1) continue;
        text += `${n} 1${LF}${line(e.offset, e.generation, 'n')}`;
      }
    }
    this.raw(text);
    if (!options.noTrailer) {
      const prev = options.prev !== undefined ? options.prev : this.sections.at(-1);
      const size = options.size ?? this.maxNumber + 1;
      this.raw(
        `trailer${LF}<< /Size ${size}${prev == null ? '' : ` /Prev ${prev}`} ${options.trailer ?? ''} >>${LF}`,
      );
    }
    this.sections.push(at);
    if (!options.noTail) this.tail(at, options.startxref);
    return this;
  }

  /** A cross-reference stream object `num` for the objects written since the last section. */
  xrefStream(num: number, options: StreamSectionOptions = {}): this {
    const w = options.w ?? [1, 4, 2];
    const first = this.sections.length === 0;
    const at = this.length;
    this.pending.set(num, { type: 1, offset: at, generation: 0 });
    this.maxNumber = Math.max(this.maxNumber, num);
    const entries = this.takePending();
    const rows: number[][] = [];
    const index: number[] = [];
    const field = (value: number, width: number) =>
      Array.from({ length: width }, (_, i) => (value >>> (8 * (width - 1 - i))) & 0xff);
    const row = (type: number, a: number, b: number) => [
      ...field(type, w[0]),
      ...field(a, w[1]),
      ...field(b, w[2]),
    ];
    if (first) {
      const byNumber = new Map(entries);
      index.push(0, this.maxNumber + 1);
      for (let n = 0; n <= this.maxNumber; n++) {
        const e = byNumber.get(n);
        if (!e) rows.push(row(0, 0, n === 0 ? 65535 : 0));
        else if (e.type === 1) rows.push(row(1, e.offset, e.generation));
        else rows.push(row(2, e.container, e.index));
      }
    } else {
      for (const [n, e] of entries) {
        index.push(n, 1);
        rows.push(e.type === 1 ? row(1, e.offset, e.generation) : row(2, e.container, e.index));
      }
    }
    let data: Uint8Array = Uint8Array.from(rows.flat());
    let dict = `/Type /XRef /Size ${options.size ?? this.maxNumber + 1} /W [${w.join(' ')}] /Index [${index.join(' ')}]`;
    const prev = options.prev !== undefined ? options.prev : this.sections.at(-1);
    if (prev != null) dict += ` /Prev ${prev}`;
    if (options.predictor) {
      data = pngUp(data, w[0] + w[1] + w[2]);
      dict += ` /DecodeParms << /Predictor 12 /Columns ${w[0] + w[1] + w[2]} >>`;
    }
    if (options.compress !== false) {
      data = new Uint8Array(deflateSync(data));
      dict += ' /Filter /FlateDecode';
    }
    this.offsets.set(num, at);
    this.raw(
      `${num} 0 obj${LF}<< /Length ${data.length} ${dict} ${options.trailer ?? ''} >>${LF}stream${EOL.CRLF}`,
    );
    this.raw(data);
    this.raw(`${LF}endstream${LF}endobj${LF}`);
    this.sections.push(at);
    if (!options.noTail) this.tail(at);
    return this;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** PNG Up filter (RFC 2083 §6.4) over rows of `columns` bytes, each row tagged 2. */
export function pngUp(data: Uint8Array, columns: number): Uint8Array {
  const out: number[] = [];
  let prior: Uint8Array = new Uint8Array(columns);
  for (let r = 0; r * columns < data.length; r++) {
    const rowBytes = data.subarray(r * columns, (r + 1) * columns);
    out.push(2, ...rowBytes.map((b, i) => (b - (prior[i] ?? 0)) & 0xff));
    prior = rowBytes;
  }
  return Uint8Array.from(out);
}

/** A minimal valid one-revision PDF: catalog, pages, one page. */
export function simplePdf(options: BuilderOptions = {}): PdfBuilder {
  return new PdfBuilder(options)
    .object(1, '<< /Type /Catalog /Pages 2 0 R >>')
    .object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
    .object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>')
    .xrefTable({ trailer: '/Root 1 0 R' });
}

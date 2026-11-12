/** Files become report documents (docs/reference/dmarc-aggregate/input.md, INP-3..7, INP-12, INP-13). */
import { crc32, gunzip, inflateRawStream } from '@benchside/core';
import { analyzeZip, bytesSource } from '@benchside/zip';
import { TarReader } from './tar.ts';
import { type XmlDocument, type XmlFinding, type XmlOutput, XmlReader } from './xml/reader.ts';

export type InputKind = 'xml' | 'gzip' | 'zip' | 'tar' | 'unknown';

export interface InputFinding {
  readonly id:
    | 'aggregate.input.unknown-type'
    | 'aggregate.input.gzip'
    | 'aggregate.input.budget'
    | 'aggregate.input.nested'
    | 'aggregate.input.too-large'
    | 'aggregate.zip.unreadable'
    | 'aggregate.zip.entry-skipped'
    | 'aggregate.zip.crc'
    | 'aggregate.zip.too-many-entries'
    | 'aggregate.tar.malformed'
    | 'aggregate.tar.too-many-entries'
    | XmlFinding['id'];
  readonly severity: 'error' | 'warning';
  /** The label of the input it is about (INP-7). */
  readonly label: string;
  readonly message: string;
  /** Where in an XML input, for XML findings. */
  readonly line?: number;
  readonly column?: number;
}

export type InputEvent =
  /** The kind of the top-level file (INP-3); always the first event. */
  | { readonly type: 'kind'; readonly kind: InputKind }
  /**
   * One report document (INP-7). `filename` is the innermost name for INP-8, or null when the XML
   * holds several documents.
   */
  | {
      readonly type: 'document';
      readonly label: string;
      readonly filename: string | null;
      readonly document: XmlDocument;
    }
  | { readonly type: 'finding'; readonly finding: InputFinding }
  /** The reader may stop here (PRG-8). */
  | { readonly type: 'pause' };

/** The decompressed bytes a batch may still produce (INP-6). One object is shared by a batch. */
export interface Budget {
  remaining: number;
  exhausted: boolean;
}

export const newBudget = (): Budget => ({ remaining: 1024 * 1024 * 1024, exhausted: false });

export interface InputLimits {
  /** INP-6 */
  readonly maxDocument: number;
  /** INP-5 */
  readonly maxZipEntries: number;
  /** INP-12 */
  readonly maxTarEntries: number;
  /** INP-13: a gzip entry of an archive is read whole. */
  readonly maxGzipEntry: number;
}

export const INPUT_LIMITS: InputLimits = {
  maxDocument: 32 * 1024 * 1024,
  maxZipEntries: 1000,
  maxTarEntries: 10_000,
  maxGzipEntry: 64 * 1024 * 1024,
};

const CHUNK = 65536;
/** `ustar` ends at 262 (INP-3). */
const SNIFF = 262;
const PAUSE: InputEvent = { type: 'pause' };

const UNKNOWN_MESSAGE =
  'Not a DMARC aggregate report. Only aggregate reports are read: XML, gzip, ZIP, or tar. Failure reports are not supported.';

type Gen = Generator<InputEvent, void, void>;

/** Where a stream sits decides which kinds it may hold (INP-4, INP-13). */
type Place = 'top-gzip' | 'entry' | 'entry-gzip';
const ALLOWED: Record<Place, readonly InputKind[]> = {
  'top-gzip': ['xml', 'tar'],
  entry: ['xml', 'gzip'],
  'entry-gzip': ['xml'],
};

/** Reads one top-level file (design: dmarc-aggregate-design/input.md). Never throws on bad input. */
export async function* readInput(
  file: { readonly name: string; readonly bytes: Uint8Array },
  budget: Budget,
  limits: Partial<InputLimits> = {},
): AsyncGenerator<InputEvent, void, void> {
  // INP-6: past the budget, later files are not read.
  if (budget.exhausted) return;
  const ctx = new Context(budget, { ...INPUT_LIMITS, ...limits });
  const { name, bytes } = file;
  const kind = sniff(bytes.subarray(0, SNIFF), bytes.length <= SNIFF);
  yield { type: 'kind', kind };
  if (kind === 'unknown') {
    yield finding('aggregate.input.unknown-type', 'error', name, UNKNOWN_MESSAGE);
    return;
  }
  if (kind === 'zip') {
    yield* readZip(ctx, name, bytes);
    return;
  }
  let root: Sink;
  if (kind === 'xml') root = new XmlSink(ctx, name, name);
  else if (kind === 'tar') root = new TarSink(ctx, name);
  else {
    root = new Sniff(ctx, 'top-gzip', name, name);
    yield* decompress(ctx, gunzip(bytes, { limit: budget.remaining }), root, name);
    yield* root.abort();
    return;
  }
  for (let at = 0; at < bytes.length && !ctx.halted && !root.done; at += CHUNK) {
    yield* root.push(bytes.subarray(at, at + CHUNK));
    yield PAUSE;
  }
  yield* ctx.halted ? root.abort() : root.end();
}

class Context {
  /** The budget ran out while reading this file; every layer stops (INP-6). */
  halted = false;

  constructor(
    readonly budget: Budget,
    readonly limits: InputLimits,
  ) {}

  /** Takes decompressed bytes from the budget. */
  *spend(n: number, label: string): Gen {
    this.budget.remaining -= n;
    if (this.budget.remaining < 0) yield* this.exhaust(label);
  }

  *exhaust(label: string): Gen {
    this.budget.remaining = 0;
    this.halted = true;
    if (this.budget.exhausted) return;
    this.budget.exhausted = true;
    yield finding(
      'aggregate.input.budget',
      'error',
      label,
      'The batch has decompressed 1 GiB. Later files are not read.',
    );
  }
}

/**
 * Runs a decompressor into a sink, spending the budget and pausing per chunk. Ends the sink when
 * the data was whole; after an error the caller's `abort` keeps the documents completed before it.
 */
function* decompress(
  ctx: Context,
  chunks: Generator<Uint8Array, { readonly kind: string }, void>,
  sink: Sink,
  label: string,
  onError?: () => Gen,
): Generator<InputEvent, boolean, void> {
  for (;;) {
    const step = chunks.next();
    if (step.done) {
      if (step.value.kind === 'ok') {
        yield* sink.end();
        return true;
      }
      // Documents completed before the problem come first, then the one finding about it.
      yield* sink.abort();
      if (step.value.kind === 'exceeded') yield* ctx.exhaust(label);
      else if (onError) yield* onError();
      else {
        yield finding(
          'aggregate.input.gzip',
          'error',
          label,
          'The gzip data is damaged. Reports read before the damage are kept.',
        );
      }
      return false;
    }
    yield* ctx.spend(step.value.length, label);
    if (ctx.halted) return false;
    yield* sink.push(step.value);
    yield PAUSE;
    if (ctx.halted) return false;
    // The sink rejected the stream or stopped: the rest is not decompressed or charged (INP-6).
    if (sink.done) return false;
  }
}

async function* readZip(
  ctx: Context,
  name: string,
  bytes: Uint8Array,
): AsyncGenerator<InputEvent, void, void> {
  const report = await analyzeZip(bytesSource(bytes));
  if (!report.end) {
    yield finding(
      'aggregate.zip.unreadable',
      'error',
      name,
      'The ZIP file has no readable central directory.',
    );
    return;
  }
  let files = 0;
  for (const entry of report.entries) {
    if (entry.kind === 'directory') continue;
    if (++files > ctx.limits.maxZipEntries) {
      yield finding(
        'aggregate.zip.too-many-entries',
        'warning',
        name,
        `The ZIP file has more than ${ctx.limits.maxZipEntries} file entries. Later entries are not read.`,
      );
      return;
    }
    const label = `${name} › ${entry.name.text}`;
    const method = entry.central.method.code;
    let reason: string | null = null;
    if (entry.central.flags.raw & 1) reason = 'it is encrypted';
    else if (method !== 0 && method !== 8) reason = `compression method ${method} is not supported`;
    else if (!entry.data) reason = 'its data could not be located';
    if (reason || !entry.data) {
      yield finding('aggregate.zip.entry-skipped', 'warning', label, `Entry skipped: ${reason}.`);
      continue;
    }
    const data = bytes.subarray(entry.data.offset, entry.data.offset + entry.data.byteLength);
    const sink = new Sniff(ctx, 'entry', label, entry.name.text);
    let crc = 0;
    let whole: boolean;
    if (method === 0) {
      for (let at = 0; at < data.length && !ctx.halted && !sink.done; at += CHUNK) {
        const part = data.subarray(at, at + CHUNK);
        crc = crc32(part, crc);
        yield* sink.push(part);
        yield PAUSE;
      }
      whole = !ctx.halted && !sink.done;
      if (whole) yield* sink.end();
    } else {
      const counted = withCrc(inflateRawStream(data, { limit: ctx.budget.remaining }), (c) => {
        crc = crc32(c, crc);
      });
      whole = yield* decompress(ctx, counted, sink, label, function* () {
        yield finding(
          'aggregate.zip.entry-skipped',
          'warning',
          label,
          'Entry skipped: its deflate data is damaged. Reports read before the damage are kept.',
        );
      });
    }
    if (ctx.halted) {
      yield* sink.abort();
      return;
    }
    if (whole && crc !== entry.crc32) {
      yield finding(
        'aggregate.zip.crc',
        'warning',
        label,
        'The CRC-32 of the entry differs from the one in the ZIP file. The entry is still read.',
      );
    }
  }
}

function* withCrc<R>(
  chunks: Generator<Uint8Array, R, void>,
  each: (c: Uint8Array) => void,
): Generator<Uint8Array, R, void> {
  for (;;) {
    const step = chunks.next();
    if (step.done) return step.value;
    each(step.value);
    yield step.value;
  }
}

interface Sink {
  push(bytes: Uint8Array): Gen;
  /** The stream ended normally. */
  end(): Gen;
  /** The stream ended after an error above; emits only documents already completed. Idempotent. */
  abort(): Gen;
  /** It takes no more bytes: rejected, stopped by an error, or ended. Feeding it is wasted work. */
  readonly done: boolean;
}

/** Decides the kind of a nested stream from its first bytes, then routes to one sink (INP-3). */
class Sniff implements Sink {
  private readonly head = new Uint8Array(SNIFF);
  private len = 0;
  private inner: Sink | null = null;
  private skipped = false;

  get done(): boolean {
    return this.skipped || (this.inner?.done ?? false);
  }

  constructor(
    private readonly ctx: Context,
    private readonly place: Place,
    private readonly label: string,
    private readonly name: string,
  ) {}

  *push(bytes: Uint8Array): Gen {
    if (this.skipped || this.ctx.halted) return;
    if (this.inner) {
      yield* this.inner.push(bytes);
      return;
    }
    const n = Math.min(SNIFF - this.len, bytes.length);
    this.head.set(bytes.subarray(0, n), this.len);
    this.len += n;
    if (this.len < SNIFF) return;
    yield* this.decide(false);
    if (this.inner) yield* (this.inner as Sink).push(bytes.subarray(n));
  }

  *end(): Gen {
    if (this.skipped || this.ctx.halted) return;
    if (!this.inner) yield* this.decide(true);
    if (this.inner) yield* (this.inner as Sink).end();
  }

  *abort(): Gen {
    if (this.inner) {
      yield* this.inner.abort();
      return;
    }
    // Fewer than 262 bytes arrived before the error. Only XML can hold a complete report that
    // short (a tar header alone is 512 bytes), so keep what it completed, without new findings.
    if (this.skipped || this.len === 0) return;
    this.skipped = true;
    const head = this.head.subarray(0, this.len);
    if (sniff(head, true) === 'xml') {
      yield* new XmlSink(this.ctx, this.label, this.name).salvage(head);
    }
  }

  private *decide(final: boolean): Gen {
    const kind = sniff(this.head.subarray(0, this.len), final);
    if (!ALLOWED[this.place].includes(kind)) {
      this.skipped = true;
      if (this.place === 'top-gzip') {
        yield finding('aggregate.input.unknown-type', 'error', this.label, UNKNOWN_MESSAGE);
      } else {
        yield finding(
          'aggregate.input.nested',
          'warning',
          this.label,
          kind === 'unknown'
            ? 'Not an aggregate report; skipped.'
            : `A ${kind === 'xml' ? 'XML' : kind} file is not allowed here; skipped.`,
        );
      }
      return;
    }
    const ctx = this.ctx;
    if (kind === 'xml') this.inner = new XmlSink(ctx, this.label, this.name);
    else if (kind === 'tar') this.inner = new TarSink(ctx, this.label);
    else this.inner = new GzipEntrySink(ctx, this.label, this.name);
    const head = this.head.subarray(0, this.len);
    if (head.length > 0) yield* this.inner.push(head);
  }
}

/** Feeds an XmlReader and labels its documents (INP-7). */
class XmlSink implements Sink {
  private readonly reader: XmlReader;
  /** The last completed document, held until we know whether another follows. */
  private pending: XmlDocument | null = null;
  private count = 0;
  private stopped = false;

  get done(): boolean {
    return this.stopped;
  }

  constructor(
    private readonly ctx: Context,
    private readonly label: string,
    private readonly name: string,
  ) {
    this.reader = new XmlReader({ maxDocument: ctx.limits.maxDocument });
  }

  *push(bytes: Uint8Array): Gen {
    if (this.stopped || this.ctx.halted) return;
    yield* this.take(this.reader.push(bytes));
  }

  *end(): Gen {
    if (this.stopped || this.ctx.halted) return;
    yield* this.take(this.reader.end());
    this.stopped = true;
    yield* this.flush();
  }

  *abort(): Gen {
    yield* this.flush();
  }

  /** Reads the last bytes before an error above, even after the budget ran out, and keeps what they completed. */
  *salvage(bytes: Uint8Array): Gen {
    if (this.stopped) return;
    yield* this.documents(this.reader.push(bytes));
    yield* this.flush();
  }

  private *documents(out: XmlOutput): Gen {
    for (const doc of out.documents) {
      if (this.pending) yield this.emit(this.pending, this.count, true);
      this.pending = doc;
      this.count++;
    }
  }

  private *take(out: XmlOutput): Gen {
    yield* this.documents(out);
    if (out.stop) {
      this.stopped = true;
      yield* this.flush();
      const f = out.stop;
      yield {
        type: 'finding',
        finding: {
          id: f.id,
          severity: f.severity,
          label: this.label,
          message: f.message,
          line: f.line,
          column: f.column,
        },
      };
    }
  }

  private *flush(): Gen {
    if (!this.pending) return;
    const doc = this.pending;
    this.pending = null;
    yield this.emit(doc, this.count, this.count > 1);
  }

  private emit(document: XmlDocument, n: number, several: boolean): InputEvent {
    return {
      type: 'document',
      label: several ? `${this.label} #${n}` : this.label,
      filename: several ? null : this.name,
      document,
    };
  }
}

/** Feeds a TarReader; each regular file becomes a nested stream (INP-12). */
class TarSink implements Sink {
  private readonly reader: TarReader;
  private current: Sniff | null = null;

  get done(): boolean {
    return this.reader.done;
  }

  constructor(
    private readonly ctx: Context,
    private readonly label: string,
  ) {
    this.reader = new TarReader({ maxEntries: ctx.limits.maxTarEntries });
  }

  *push(bytes: Uint8Array): Gen {
    if (!this.ctx.halted) yield* this.events(this.reader.push(bytes));
  }

  *end(): Gen {
    if (!this.ctx.halted) yield* this.events(this.reader.end());
  }

  *abort(): Gen {
    if (this.current) yield* this.current.abort();
    this.current = null;
  }

  private *events(events: ReturnType<TarReader['push']>): Gen {
    for (const e of events) {
      if (this.ctx.halted) return;
      if (e.type === 'entry') {
        this.current = new Sniff(this.ctx, 'entry', `${this.label} › ${e.name}`, e.name);
      } else if (e.type === 'data') {
        if (this.current) yield* this.current.push(e.bytes);
      } else if (e.type === 'entry-end') {
        if (this.current) yield* this.current.end();
        this.current = null;
        yield PAUSE;
      } else {
        yield* this.abort();
        yield e.type === 'malformed'
          ? finding(
              'aggregate.tar.malformed',
              'error',
              this.label,
              `${e.message} Reports read before it are kept.`,
            )
          : finding(
              'aggregate.tar.too-many-entries',
              'warning',
              this.label,
              `The tar archive has more than ${this.ctx.limits.maxTarEntries} file entries. Later entries are not read.`,
            );
      }
    }
  }
}

/** A gzip entry of an archive: collected whole, then decompressed; it may hold XML only (INP-13). */
class GzipEntrySink implements Sink {
  private parts: Uint8Array[] = [];
  private size = 0;
  private skipped = false;
  private readonly inner: Sniff;

  get done(): boolean {
    return this.skipped;
  }

  constructor(
    private readonly ctx: Context,
    private readonly label: string,
    name: string,
  ) {
    this.inner = new Sniff(ctx, 'entry-gzip', label, name);
  }

  *push(bytes: Uint8Array): Gen {
    if (this.skipped || this.ctx.halted) return;
    this.size += bytes.length;
    if (this.size > this.ctx.limits.maxGzipEntry) {
      this.skipped = true;
      this.parts = [];
      yield finding(
        'aggregate.input.too-large',
        'error',
        this.label,
        `The gzip entry is over ${this.ctx.limits.maxGzipEntry / (1024 * 1024)} MiB; skipped.`,
      );
      return;
    }
    this.parts.push(bytes.slice());
  }

  *end(): Gen {
    if (this.skipped || this.ctx.halted) return;
    const data = join(this.parts, this.size);
    this.parts = [];
    yield* decompress(
      this.ctx,
      gunzip(data, { limit: this.ctx.budget.remaining }),
      this.inner,
      this.label,
    );
  }

  *abort(): Gen {
    yield* this.inner.abort();
  }
}

/**
 * INP-3: the kind from the first bytes. `final` means `head` holds the whole input; otherwise it
 * holds 262 bytes, and white space alone through them reads as XML.
 */
function sniff(head: Uint8Array, final: boolean): InputKind {
  const b = head;
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  if (
    b[0] === 0x50 &&
    b[1] === 0x4b &&
    ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6))
  ) {
    return 'zip';
  }
  if (b[257] === 0x75 && b[258] === 0x73 && b[259] === 0x74 && b[260] === 0x61 && b[261] === 0x72) {
    return 'tar';
  }
  // Code units after an optional BOM: 1 byte, or 2 for UTF-16 in either byte order.
  let at = 0;
  let width = 1;
  let high = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) at = 3;
  else if (b[0] === 0xfe && b[1] === 0xff) [at, width, high] = [2, 2, 0];
  else if (b[0] === 0xff && b[1] === 0xfe) [at, width, high] = [2, 2, 1];
  for (; at + width <= b.length; at += width) {
    const unit =
      width === 1
        ? (b[at] as number)
        : (b[at + 1 - high] as number) | ((b[at + high] as number) << 8);
    if (unit === 0x3c) return 'xml';
    if (unit !== 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) return 'unknown';
  }
  return final ? 'unknown' : 'xml';
}

function finding(
  id: InputFinding['id'],
  severity: InputFinding['severity'],
  label: string,
  message: string,
): InputEvent {
  return { type: 'finding', finding: { id, severity, label, message } };
}

function join(parts: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** tar archives as a stream of entries (INP-12; POSIX.1-2017 pax, "ustar Interchange Format"). */

export type TarEvent =
  /** A regular file starts. */
  | { readonly type: 'entry'; readonly name: string }
  /** Part of the current entry's data; valid only until the next `push`. */
  | { readonly type: 'data'; readonly bytes: Uint8Array }
  /** The current entry's data is complete. */
  | { readonly type: 'entry-end' }
  /** A bad header or data that ends early; nothing follows. */
  | { readonly type: 'malformed'; readonly message: string }
  /** More regular files than `maxEntries`; nothing follows. */
  | { readonly type: 'too-many' };

const BLOCK = 512;
/** Largest pax or GNU long-name header read (INP-12). */
const MAX_META = 1024 * 1024;

const Mode = { Header: 0, Data: 1, Skip: 2, Meta: 3, Padding: 4, Done: 5 } as const;
type Mode = (typeof Mode)[keyof typeof Mode];

const utf8 = new TextDecoder('utf-8');

/** Reads one archive pushed in chunks of any size. Never throws on bad input. */
export class TarReader {
  private readonly maxEntries: number;
  private mode: Mode = Mode.Header;
  /** A partial header block. */
  private readonly head = new Uint8Array(BLOCK);
  private headLen = 0;
  /** Data bytes left in the current entry, then padding bytes left. */
  private left = 0;
  private padding = 0;
  private entries = 0;
  /** One zero block was seen; a second one ends the archive. */
  private zero = false;
  /** pax or GNU long-name data being collected, and its type. */
  private meta: Uint8Array | null = null;
  private metaLen = 0;
  private metaType = '';
  /** Name for the next entry, from pax `path` or GNU `L`. */
  private paxPath: string | null = null;
  private longName: string | null = null;

  /** Two zero blocks, a malformed header, or too many entries ended the archive; later bytes are ignored. */
  get done(): boolean {
    return this.mode === Mode.Done;
  }

  constructor(o: { readonly maxEntries?: number } = {}) {
    this.maxEntries = o.maxEntries ?? 10_000;
  }

  push(bytes: Uint8Array): TarEvent[] {
    const out: TarEvent[] = [];
    let at = 0;
    while (at < bytes.length && this.mode !== Mode.Done) {
      switch (this.mode) {
        case Mode.Header: {
          const n = Math.min(BLOCK - this.headLen, bytes.length - at);
          this.head.set(bytes.subarray(at, at + n), this.headLen);
          this.headLen += n;
          at += n;
          if (this.headLen === BLOCK) {
            this.headLen = 0;
            this.header(out);
          }
          break;
        }
        case Mode.Data: {
          const n = Math.min(this.left, bytes.length - at);
          out.push({ type: 'data', bytes: bytes.subarray(at, at + n) });
          at += n;
          this.left -= n;
          if (this.left === 0) this.endData(out);
          break;
        }
        case Mode.Meta: {
          const n = Math.min(this.left, bytes.length - at);
          (this.meta as Uint8Array).set(bytes.subarray(at, at + n), this.metaLen);
          this.metaLen += n;
          at += n;
          this.left -= n;
          if (this.left === 0) this.endMeta();
          break;
        }
        case Mode.Skip:
        case Mode.Padding: {
          const n = Math.min(this.left, bytes.length - at);
          at += n;
          this.left -= n;
          if (this.left === 0) this.mode = this.mode === Mode.Skip ? this.afterData() : Mode.Header;
          break;
        }
      }
    }
    return out;
  }

  end(): TarEvent[] {
    const out: TarEvent[] = [];
    if (this.mode === Mode.Done) return out;
    if (this.mode === Mode.Header && this.headLen === 0) {
      // The end of the data ends the archive (INP-12).
    } else if (this.mode === Mode.Padding) {
      // Padding missing after the last entry's data is not an error.
    } else {
      this.fail(
        out,
        this.mode === Mode.Header ? 'A tar header is cut short.' : 'tar entry data ends early.',
      );
      return out;
    }
    this.mode = Mode.Done;
    return out;
  }

  private header(out: TarEvent[]): void {
    const h = this.head;
    if (h.every((b) => b === 0)) {
      if (this.zero) this.mode = Mode.Done;
      this.zero = true;
      return;
    }
    this.zero = false;
    if (!checksumOk(h)) {
      this.fail(out, 'A tar header checksum does not match.');
      return;
    }
    const size = readSize(h);
    if (size === null) {
      this.fail(out, 'A tar header has an invalid size.');
      return;
    }
    const type = String.fromCharCode(h[156] as number);
    this.left = size;
    this.padding = (BLOCK - (size % BLOCK)) % BLOCK;

    if (type === 'x' || type === 'L') {
      if (size > MAX_META) {
        this.fail(out, 'A tar extended header is over 1 MiB.');
        return;
      }
      this.meta = new Uint8Array(size);
      this.metaLen = 0;
      this.metaType = type;
      if (size === 0) this.endMeta();
      else this.mode = Mode.Meta;
      return;
    }
    if (type !== '0' && type !== String.fromCharCode(0)) {
      // Directories, links, devices, global pax headers: skipped without a finding. A pax path or
      // long name before them names them, not the next file.
      this.paxPath = null;
      this.longName = null;
      this.mode = size === 0 ? Mode.Header : Mode.Skip;
      return;
    }
    if (this.entries >= this.maxEntries) {
      this.mode = Mode.Done;
      out.push({ type: 'too-many' });
      return;
    }
    this.entries++;
    const name = this.paxPath ?? this.longName ?? ustarName(h);
    this.paxPath = null;
    this.longName = null;
    out.push({ type: 'entry', name });
    if (size === 0) this.endData(out);
    else this.mode = Mode.Data;
  }

  private endData(out: TarEvent[]): void {
    out.push({ type: 'entry-end' });
    this.mode = this.afterData();
  }

  private afterData(): Mode {
    if (this.padding === 0) return Mode.Header;
    this.left = this.padding;
    return Mode.Padding;
  }

  private endMeta(): void {
    const data = (this.meta as Uint8Array).subarray(0, this.metaLen);
    if (this.metaType === 'L') this.longName = cString(data);
    else {
      const path = paxRecord(data, 'path');
      if (path !== null) this.paxPath = path;
    }
    this.meta = null;
    this.mode = this.afterData();
  }

  private fail(out: TarEvent[], message: string): void {
    this.mode = Mode.Done;
    out.push({ type: 'malformed', message });
  }
}

/** The sum of the header bytes with the checksum field as spaces, unsigned or signed (INP-12). */
function checksumOk(h: Uint8Array): boolean {
  const stored = octal(h.subarray(148, 156));
  if (stored === null) return false;
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i++) {
    const b = i >= 148 && i < 156 ? 32 : (h[i] as number);
    unsigned += b;
    signed += b > 127 ? b - 256 : b;
  }
  return stored === unsigned || stored === signed;
}

/** Octal digits, after optional spaces, ended by NUL, a space, or the field's end. */
function octal(field: Uint8Array): number | null {
  let i = 0;
  while (i < field.length && field[i] === 32) i++;
  let v = 0;
  let digits = 0;
  for (; i < field.length; i++) {
    const b = field[i] as number;
    if (b === 0 || b === 32) break;
    if (b < 48 || b > 55) return null;
    v = v * 8 + (b - 48);
    digits++;
  }
  return digits > 0 ? v : null;
}

/** Octal, or base-256 when the high bit of the first byte is set; negative sizes are invalid. */
function readSize(h: Uint8Array): number | null {
  const field = h.subarray(124, 136);
  const first = field[0] as number;
  if (!(first & 0x80)) return octal(field);
  if (first & 0x40) return null;
  let v = first & 0x3f;
  for (let i = 1; i < field.length; i++) v = v * 256 + (field[i] as number);
  return Number.isSafeInteger(v) ? v : null;
}

function cString(b: Uint8Array): string {
  const nul = b.indexOf(0);
  return utf8.decode(nul === -1 ? b : b.subarray(0, nul));
}

/** `prefix` + `/` + `name`; `prefix` counts only with the POSIX magic `ustar` NUL. */
function ustarName(h: Uint8Array): string {
  const name = cString(h.subarray(0, 100));
  const posix =
    h[257] === 0x75 &&
    h[258] === 0x73 &&
    h[259] === 0x74 &&
    h[260] === 0x61 &&
    h[261] === 0x72 &&
    h[262] === 0;
  const prefix = posix ? cString(h.subarray(345, 500)) : '';
  return prefix ? `${prefix}/${name}` : name;
}

/** The value of one key in pax records `"%d %s=%s\n"`; unreadable records are ignored. */
function paxRecord(data: Uint8Array, key: string): string | null {
  let found: string | null = null;
  let at = 0;
  while (at < data.length) {
    let sp = at;
    while (sp < data.length && data[sp] !== 32) sp++;
    const len = Number(utf8.decode(data.subarray(at, sp)));
    if (!Number.isInteger(len) || len <= sp - at || at + len > data.length) break;
    const record = data.subarray(sp + 1, at + len - 1);
    const eq = record.indexOf(0x3d);
    if (eq > 0 && utf8.decode(record.subarray(0, eq)) === key)
      found = utf8.decode(record.subarray(eq + 1));
    at += len;
  }
  return found;
}

import { crc32 } from './crc32.ts';
import { view } from './source.ts';

/** How `gunzip` ended (0017). Chunks yielded before an error or `exceeded` stay valid. */
export type GunzipResult =
  | { readonly kind: 'ok'; readonly members: number }
  | { readonly kind: 'exceeded' }
  | {
      readonly kind: 'error';
      readonly reason: 'header' | 'data' | 'crc' | 'size' | 'truncated' | 'trailing';
      /** Input offset where the problem was found; for `data`, up to 3 bytes past the bad bits, which are read ahead. */
      readonly offset: number;
    };

/**
 * Decodes gzip members one after another (RFC 1952 §2.2) with an in-house inflate (RFC 1951),
 * yielding output in chunks. Stops with `exceeded` before yielding past `limit` bytes (NaN counts
 * as 0). An empty chunk is a pause point: input that gives little output still yields often (PRG-8).
 * Never throws on bad input.
 */
export function* gunzip(
  input: Uint8Array,
  o: { readonly limit: number; readonly chunkSize?: number },
): Generator<Uint8Array, GunzipResult, void> {
  const size = o.chunkSize ?? 65536;
  const chunkSize = Number.isFinite(size)
    ? Math.min(Math.max(1024, Math.floor(size)), 1 << 24)
    : 65536;
  const limit = Number.isNaN(o.limit) ? 0 : o.limit;
  const d = new Decoder(input, chunkSize);
  let total = 0;
  try {
    while (!d.done) {
      d.run();
      const chunk = d.take();
      total += chunk.length;
      if (total > limit) return { kind: 'exceeded' };
      if (chunk.length > 0 || !d.done) yield chunk;
    }
    return { kind: 'ok', members: d.members };
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    // Output decoded before the problem is still the caller's (INP-4: completed reports stay).
    const chunk = d.take();
    // Output past the limit is a bomb (INP-6) whatever follows it.
    if (total + chunk.length > limit) return { kind: 'exceeded' };
    if (chunk.length > 0) yield chunk;
    return { kind: 'error', reason: e.reason, offset: e.offset };
  }
}

class Stop {
  constructor(
    readonly reason: 'header' | 'data' | 'crc' | 'size' | 'truncated' | 'trailing',
    readonly offset: number,
  ) {}
}

const WINDOW = 32768;
/** Loop steps per `run`: a header, a block header, one symbol, or one copy each. */
const WORK_PER_RUN = 16384;

const State = { Header: 0, Block: 1, Stored: 2, Huffman: 3, Copy: 4, Trailer: 5, Done: 6 } as const;
type State = (typeof State)[keyof typeof State];

interface Code {
  /** Indexed by the next `maxLen` input bits; each entry is `symbol << 4 | length`, 0 for no code. */
  readonly table: Uint32Array;
  readonly maxLen: number;
}

// RFC 1951 §3.2.5
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
// RFC 1951 §3.2.7
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** RFC 1951 §3.2.2: canonical Huffman code from code lengths. */
function buildCode(lengths: ArrayLike<number>, at: number, codeLengths = false): Code {
  const counts = new Uint16Array(16);
  let maxLen = 0;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i] as number;
    counts[len] = (counts[len] as number) + 1;
    if (len > maxLen) maxLen = len;
  }
  counts[0] = 0;
  let left = 1;
  for (let len = 1; len < 16; len++) {
    left = (left << 1) - (counts[len] as number);
    if (left < 0) throw new Stop('data', at); // over-subscribed
  }
  // An incomplete code is allowed only as a single 1-bit code, or no code, for literals and
  // distances; the code-length code must be complete. zlib draws the same line (inftrees.c).
  if (left > 0 && (codeLengths || maxLen > 1)) throw new Stop('data', at);
  const next = new Uint16Array(16);
  for (let len = 1, code = 0; len < 16; len++) {
    code = (code + (counts[len - 1] as number)) << 1;
    next[len] = code;
  }
  if (maxLen === 0) maxLen = 1;
  const table = new Uint32Array(1 << maxLen);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym] as number;
    if (len === 0) continue;
    const code = next[len] as number;
    next[len] = code + 1;
    let reversed = 0;
    for (let i = 0; i < len; i++) reversed |= ((code >> i) & 1) << (len - 1 - i);
    for (let i = reversed; i < table.length; i += 1 << len) table[i] = (sym << 4) | len;
  }
  return { table, maxLen };
}

const FIXED_LITERALS = buildCode(
  Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)),
  0,
);
const FIXED_DISTANCES = buildCode(new Array<number>(32).fill(5), 0);

class Decoder {
  done = false;
  members = 0;
  private state: State = State.Header;
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;
  private final = false;
  private stored = 0;
  private literals: Code = FIXED_LITERALS;
  private distances: Code = FIXED_DISTANCES;
  private copyLen = 0;
  private copyDist = 0;
  private readonly out: Uint8Array;
  private op = 0;
  private flushFrom = 0;
  private crcFrom = 0;
  private crc = 0;
  /** Bytes produced by the current member, for back references (§3.2.5) and ISIZE. */
  private memberOut = 0;

  constructor(
    private readonly input: Uint8Array,
    chunkSize: number,
  ) {
    this.out = new Uint8Array(WINDOW + chunkSize);
  }

  /** Pending output; afterwards only the last 32 KiB stay, as history for back references. */
  take(): Uint8Array {
    const chunk = this.out.slice(this.flushFrom, this.op);
    if (this.op > WINDOW) {
      this.syncCrc();
      this.out.copyWithin(0, this.op - WINDOW, this.op);
      this.op = WINDOW;
      this.crcFrom = WINDOW;
    }
    this.flushFrom = this.op;
    return chunk;
  }

  /** Decodes until the output buffer is full, the input ends, or a bounded amount of work is done. */
  run(): void {
    const out = this.out;
    for (let work = 0; this.op < out.length && work < WORK_PER_RUN; work++) {
      switch (this.state) {
        case State.Header:
          this.header();
          break;
        case State.Block:
          this.block();
          break;
        case State.Stored: {
          const n = Math.min(this.stored, out.length - this.op, this.input.length - this.pos);
          out.set(this.input.subarray(this.pos, this.pos + n), this.op);
          this.pos += n;
          this.op += n;
          this.memberOut += n;
          this.stored -= n;
          if (this.stored === 0) this.state = State.Block;
          else if (this.pos >= this.input.length) throw new Stop('truncated', this.pos);
          break;
        }
        case State.Huffman: {
          const sym = this.decode(this.literals);
          if (sym < 256) {
            out[this.op++] = sym;
            this.memberOut++;
          } else if (sym === 256) {
            this.state = State.Block;
          } else {
            const i = sym - 257;
            if (i >= 29) throw new Stop('data', this.pos);
            this.copyLen = (LENGTH_BASE[i] as number) + this.bits(LENGTH_EXTRA[i] as number);
            const d = this.decode(this.distances);
            if (d >= 30) throw new Stop('data', this.pos);
            this.copyDist = (DIST_BASE[d] as number) + this.bits(DIST_EXTRA[d] as number);
            if (this.copyDist > this.memberOut) throw new Stop('data', this.pos);
            this.state = State.Copy;
          }
          break;
        }
        case State.Copy: {
          const dist = this.copyDist;
          let op = this.op;
          const n = Math.min(this.copyLen, out.length - op);
          for (let k = 0; k < n; k++, op++) out[op] = out[op - dist] as number;
          this.op = op;
          this.memberOut += n;
          this.copyLen -= n;
          if (this.copyLen === 0) this.state = State.Huffman;
          break;
        }
        case State.Trailer:
          this.trailer();
          if (this.done) return;
          break;
        case State.Done:
          return;
      }
    }
  }

  /** RFC 1952 §2.3: one member header, read from a byte boundary. */
  private header(): void {
    const b = this.input;
    const start = this.pos;
    if (start + 10 > b.length) throw new Stop('truncated', start);
    const flags = b[start + 3] as number;
    if (b[start] !== 0x1f || b[start + 1] !== 0x8b || b[start + 2] !== 8 || flags & 0xe0) {
      throw new Stop('header', start);
    }
    let p = start + 10;
    if (flags & 4) {
      if (p + 2 > b.length) throw new Stop('truncated', p);
      p += 2 + ((b[p] as number) | ((b[p + 1] as number) << 8));
    }
    for (const bit of [8, 16]) {
      if (!(flags & bit)) continue;
      const field = p;
      while (p < b.length && b[p] !== 0) p++;
      if (p >= b.length) throw new Stop('truncated', field);
      p++;
    }
    if (flags & 2) {
      // FHCRC: the low 16 bits of the CRC-32 of the header before it (RFC 1952 §2.3.1).
      if (p + 2 > b.length) throw new Stop('truncated', p);
      const stored = (b[p] as number) | ((b[p + 1] as number) << 8);
      if (stored !== (crc32(b.subarray(start, p)) & 0xffff)) throw new Stop('header', start);
      p += 2;
    }
    if (p > b.length) throw new Stop('truncated', start + 10);
    this.pos = p;
    this.memberOut = 0;
    this.crc = 0;
    this.crcFrom = this.op;
    this.final = false;
    this.state = State.Block;
  }

  /** RFC 1951 §3.2.3: a block header, or the trailer after the final block. */
  private block(): void {
    if (this.final) {
      this.state = State.Trailer;
      return;
    }
    this.final = this.bits(1) === 1;
    const type = this.bits(2);
    if (type === 0) {
      this.toByte();
      const b = this.input;
      const p = this.pos;
      if (p + 4 > b.length) throw new Stop('truncated', p);
      const len = (b[p] as number) | ((b[p + 1] as number) << 8);
      const nlen = (b[p + 2] as number) | ((b[p + 3] as number) << 8);
      if ((len ^ 0xffff) !== nlen) throw new Stop('data', p);
      this.pos = p + 4;
      this.stored = len;
      this.state = len === 0 ? State.Block : State.Stored;
    } else if (type === 1) {
      this.literals = FIXED_LITERALS;
      this.distances = FIXED_DISTANCES;
      this.state = State.Huffman;
    } else if (type === 2) {
      this.dynamic();
      this.state = State.Huffman;
    } else {
      throw new Stop('data', this.pos);
    }
  }

  /** RFC 1951 §3.2.7: the code lengths of a dynamic block. */
  private dynamic(): void {
    const hlit = this.bits(5) + 257;
    const hdist = this.bits(5) + 1;
    const hclen = this.bits(4) + 4;
    if (hlit > 286 || hdist > 30) throw new Stop('data', this.pos);
    const clens = new Uint8Array(19);
    for (let i = 0; i < hclen; i++) clens[CODE_LENGTH_ORDER[i] as number] = this.bits(3);
    const clcode = buildCode(clens, this.pos, true);
    const lengths = new Uint8Array(hlit + hdist);
    for (let i = 0; i < lengths.length; ) {
      const sym = this.decode(clcode);
      if (sym < 16) {
        lengths[i++] = sym;
        continue;
      }
      let value = 0;
      let repeat: number;
      if (sym === 16) {
        if (i === 0) throw new Stop('data', this.pos);
        value = lengths[i - 1] as number;
        repeat = 3 + this.bits(2);
      } else if (sym === 17) {
        repeat = 3 + this.bits(3);
      } else {
        repeat = 11 + this.bits(7);
      }
      if (i + repeat > lengths.length) throw new Stop('data', this.pos);
      lengths.fill(value, i, i + repeat);
      i += repeat;
    }
    if (lengths[256] === 0) throw new Stop('data', this.pos);
    this.literals = buildCode(lengths.subarray(0, hlit), this.pos);
    this.distances = buildCode(lengths.subarray(hlit), this.pos);
  }

  /** RFC 1952 §2.3.1: CRC-32 and ISIZE, then the next member or the end. */
  private trailer(): void {
    this.toByte();
    const b = this.input;
    const p = this.pos;
    if (p + 8 > b.length) throw new Stop('truncated', p);
    this.syncCrc();
    const v = view(b);
    const crc = v.getUint32(p, true);
    const size = v.getUint32(p + 4, true);
    if (crc !== this.crc) throw new Stop('crc', p);
    if (size !== this.memberOut >>> 0) throw new Stop('size', p + 4);
    this.members++;
    this.pos = p + 8;
    if (this.pos === b.length) {
      this.state = State.Done;
      this.done = true;
    } else if (b[this.pos] === 0x1f && b[this.pos + 1] === 0x8b) {
      this.state = State.Header;
    } else if (b.subarray(this.pos).every((x) => x === 0)) {
      // Zero padding after the last member, as block-oriented tools write it (INP-4).
      this.state = State.Done;
      this.done = true;
    } else {
      throw new Stop('trailing', this.pos);
    }
  }

  private syncCrc(): void {
    this.crc = crc32(this.out.subarray(this.crcFrom, this.op), this.crc);
    this.crcFrom = this.op;
  }

  /** Drops the bits left in the current byte and gives back whole bytes already buffered. */
  private toByte(): void {
    this.pos -= this.bitCnt >> 3;
    this.bitBuf = 0;
    this.bitCnt = 0;
  }

  private bits(n: number): number {
    while (this.bitCnt < n) {
      if (this.pos >= this.input.length) throw new Stop('truncated', this.pos);
      this.bitBuf |= (this.input[this.pos++] as number) << this.bitCnt;
      this.bitCnt += 8;
    }
    const v = this.bitBuf & ((1 << n) - 1);
    this.bitBuf >>>= n;
    this.bitCnt -= n;
    return v;
  }

  private decode(code: Code): number {
    while (this.bitCnt < code.maxLen && this.pos < this.input.length) {
      this.bitBuf |= (this.input[this.pos++] as number) << this.bitCnt;
      this.bitCnt += 8;
    }
    const entry = code.table[this.bitBuf & ((1 << code.maxLen) - 1)] as number;
    const len = entry & 15;
    if (len === 0 || len > this.bitCnt) {
      throw new Stop(this.bitCnt < code.maxLen ? 'truncated' : 'data', this.pos);
    }
    this.bitBuf >>>= len;
    this.bitCnt -= len;
    return entry >> 4;
  }
}

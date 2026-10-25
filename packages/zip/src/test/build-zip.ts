/** Builds ZIP bytes in code for tests, so each test shows what every byte is for. */
import { crc32 } from '../crc32.ts';

const enc = new TextEncoder();
const bytesOf = (v: string | Uint8Array) => (typeof v === 'string' ? enc.encode(v) : v);

export class Writer {
  private chunks: number[] = [];
  get length() {
    return this.chunks.length;
  }
  u8(v: number) {
    this.chunks.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v).u8(v >>> 8);
  }
  u32(v: number) {
    return this.u16(v & 0xffff).u16(v >>> 16);
  }
  u64(v: number | bigint) {
    const b = BigInt(v);
    return this.u32(Number(b & 0xffffffffn)).u32(Number(b >> 32n));
  }
  bytes(v: string | Uint8Array) {
    for (const b of bytesOf(v)) this.u8(b);
    return this;
  }
  done() {
    return Uint8Array.from(this.chunks);
  }
}

/** One extra block: Header ID, Data Size, data (4.5.1). */
export function extraBlock(id: number, data: Uint8Array): Uint8Array {
  return new Writer().u16(id).u16(data.length).bytes(data).done();
}

export interface HeaderFields {
  versionNeeded: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
}

export interface FixtureEntry {
  name: string | Uint8Array;
  /** Uncompressed content. */
  content?: string | Uint8Array;
  method?: number;
  /** The stored bytes when the method is not 0. */
  compressed?: Uint8Array;
  flags?: number;
  time?: number;
  date?: number;
  versionMadeBy?: number;
  versionNeeded?: number;
  internal?: number;
  external?: number;
  comment?: string | Uint8Array;
  centralExtra?: Uint8Array;
  localExtra?: Uint8Array;
  /** Sentinel sizes and offset, with 0x0001 blocks in both headers. */
  zip64?: boolean;
  /** Sets flag bit 3, zeroes the local CRC and sizes, writes a descriptor. */
  descriptor?: 'signed' | 'unsigned';
  localName?: string | Uint8Array;
  /** Raw overrides, written as given. */
  local?: Partial<HeaderFields>;
  central?: Partial<HeaderFields & { localHeaderOffset: number }>;
}

export interface BuildOptions {
  comment?: string | Uint8Array;
  /** Bytes before the archive, such as a self-extracting stub. Offsets do not count them. */
  prepend?: Uint8Array;
  /** Bytes after the EOCD. */
  append?: Uint8Array;
  /** Write a ZIP64 EOCD record and locator, with sentinels in the EOCD. */
  zip64?: boolean;
  /** Bytes between the central directory and the end records. */
  afterCentral?: Uint8Array;
}

export interface Built {
  bytes: Uint8Array;
  /** Absolute offsets in `bytes`. */
  local: number[];
  data: number[];
  central: number[];
  cdOffset: number;
  cdByteLength: number;
  zip64Offset?: number;
  locatorOffset?: number;
  eocdOffset: number;
}

export function buildZip(entries: readonly FixtureEntry[], options: BuildOptions = {}): Built {
  const prepend = options.prepend ?? new Uint8Array();
  const out = new Writer().bytes(prepend);
  const base = prepend.length;
  const local: number[] = [];
  const data: number[] = [];
  const centrals: Uint8Array[] = [];

  for (const e of entries) {
    const content = bytesOf(e.content ?? '');
    const stored = e.compressed ?? content;
    const method = e.method ?? 0;
    const name = bytesOf(e.name);
    const flags = (e.flags ?? 0) | (e.descriptor ? 0x08 : 0);
    const real: HeaderFields = {
      versionNeeded: e.versionNeeded ?? (e.zip64 ? 45 : 20),
      flags,
      method,
      time: e.time ?? 0x6000,
      date: e.date ?? 0x5a21,
      crc32: crc32(content),
      compressedSize: stored.length,
      uncompressedSize: content.length,
    };
    const offset = out.length - base;
    local.push(out.length);

    const lf: HeaderFields = {
      ...real,
      ...(e.descriptor ? { crc32: 0, compressedSize: 0, uncompressedSize: 0 } : {}),
      ...(e.zip64 ? { compressedSize: 0xffffffff, uncompressedSize: 0xffffffff } : {}),
      ...e.local,
    };
    const localZip64 = e.zip64
      ? extraBlock(
          0x0001,
          new Writer()
            .u64(e.descriptor ? 0 : real.uncompressedSize)
            .u64(e.descriptor ? 0 : real.compressedSize)
            .done(),
        )
      : new Uint8Array();
    const localExtra = concat(localZip64, e.localExtra ?? new Uint8Array());
    const localName = bytesOf(e.localName ?? name);
    writeLocal(out, lf, localName, localExtra);
    data.push(out.length);
    out.bytes(stored);
    if (e.descriptor) {
      if (e.descriptor === 'signed') out.u32(0x08074b50);
      out.u32(real.crc32);
      if (e.zip64) out.u64(real.compressedSize).u64(real.uncompressedSize);
      else out.u32(real.compressedSize).u32(real.uncompressedSize);
    }

    const cf = { ...real, localHeaderOffset: offset, ...e.central };
    const centralZip64 = e.zip64
      ? extraBlock(
          0x0001,
          new Writer()
            .u64(cf.uncompressedSize)
            .u64(cf.compressedSize)
            .u64(cf.localHeaderOffset)
            .done(),
        )
      : new Uint8Array();
    const comment = bytesOf(e.comment ?? '');
    const centralExtra = concat(centralZip64, e.centralExtra ?? new Uint8Array());
    const c = new Writer()
      .u32(0x02014b50)
      .u16(e.versionMadeBy ?? 0x031e)
      .u16(cf.versionNeeded)
      .u16(cf.flags)
      .u16(cf.method)
      .u16(cf.time)
      .u16(cf.date)
      .u32(cf.crc32)
      .u32(e.zip64 ? 0xffffffff : cf.compressedSize)
      .u32(e.zip64 ? 0xffffffff : cf.uncompressedSize)
      .u16(name.length)
      .u16(centralExtra.length)
      .u16(comment.length)
      .u16(0)
      .u16(e.internal ?? 0)
      .u32(e.external ?? 0)
      .u32(e.zip64 ? 0xffffffff : cf.localHeaderOffset)
      .bytes(name)
      .bytes(centralExtra)
      .bytes(comment)
      .done();
    centrals.push(c);
  }

  const cdOffset = out.length;
  const central: number[] = [];
  for (const c of centrals) {
    central.push(out.length);
    out.bytes(c);
  }
  const cdByteLength = out.length - cdOffset;
  if (options.afterCentral) out.bytes(options.afterCentral);

  let zip64Offset: number | undefined;
  let locatorOffset: number | undefined;
  if (options.zip64) {
    zip64Offset = out.length;
    out
      .u32(0x06064b50)
      .u64(44)
      .u16(0x032d)
      .u16(45)
      .u32(0)
      .u32(0)
      .u64(entries.length)
      .u64(entries.length)
      .u64(cdByteLength)
      .u64(cdOffset - base);
    locatorOffset = out.length;
    out
      .u32(0x07064b50)
      .u32(0)
      .u64(zip64Offset - base)
      .u32(1);
  }
  const eocdOffset = out.length;
  const comment = bytesOf(options.comment ?? '');
  const z = options.zip64;
  out
    .u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(z ? 0xffff : entries.length)
    .u16(z ? 0xffff : entries.length)
    .u32(z ? 0xffffffff : cdByteLength)
    .u32(z ? 0xffffffff : cdOffset - base)
    .u16(comment.length)
    .bytes(comment);
  if (options.append) out.bytes(options.append);

  return {
    bytes: out.done(),
    local,
    data,
    central,
    cdOffset,
    cdByteLength,
    ...(zip64Offset === undefined ? {} : { zip64Offset }),
    ...(locatorOffset === undefined ? {} : { locatorOffset }),
    eocdOffset,
  };
}

function writeLocal(out: Writer, f: HeaderFields, name: Uint8Array, extra: Uint8Array) {
  out
    .u32(0x04034b50)
    .u16(f.versionNeeded)
    .u16(f.flags)
    .u16(f.method)
    .u16(f.time)
    .u16(f.date)
    .u32(f.crc32)
    .u32(f.compressedSize)
    .u32(f.uncompressedSize)
    .u16(name.length)
    .u16(extra.length)
    .bytes(name)
    .bytes(extra);
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Patches little-endian values in place. */
export function patch(bytes: Uint8Array, offset: number, value: number, size: 1 | 2 | 4) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (size === 1) view.setUint8(offset, value);
  else if (size === 2) view.setUint16(offset, value, true);
  else view.setUint32(offset, value, true);
}

export async function deflateRaw(content: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([content as BufferSource])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

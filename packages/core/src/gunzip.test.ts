import { deflateRawSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32.ts';
import { type GunzipResult, gunzip } from './gunzip.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
/** Byte-wise equality; vitest's deep `toEqual` on megabyte arrays is slow. */
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

/** Runs gunzip to the end and joins the chunks it yielded. */
function run(
  input: Uint8Array,
  limit = 1 << 30,
  chunkSize?: number,
): { out: Uint8Array; result: GunzipResult } {
  const chunks: Uint8Array[] = [];
  const it = gunzip(input, chunkSize === undefined ? { limit } : { limit, chunkSize });
  for (;;) {
    const step = it.next();
    if (step.done) {
      const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return { out, result: step.value };
    }
    chunks.push(step.value);
  }
}

const le32 = (n: number) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** A gzip member built by hand: RFC 1952 §2.3 header, a deflate body, CRC-32 and ISIZE. */
function member(
  data: Uint8Array,
  o: {
    flags?: number;
    extra?: Uint8Array;
    body?: Uint8Array;
    crc?: number;
    size?: number;
    headerCrc?: number;
  } = {},
) {
  const flags = o.flags ?? 0;
  const head: Uint8Array[] = [Uint8Array.of(0x1f, 0x8b, 8, flags, 0, 0, 0, 0, 0, 255)];
  if (flags & 4) {
    const x = o.extra ?? Uint8Array.of(1, 2);
    head.push(Uint8Array.of(x.length & 255, x.length >> 8), x);
  }
  if (flags & 8) head.push(enc('report.xml\0'));
  if (flags & 16) head.push(enc('a comment\0'));
  if (flags & 2) {
    const h = o.headerCrc ?? crc32(cat(...head)) & 0xffff;
    head.push(Uint8Array.of(h & 255, h >> 8));
  }
  return cat(
    ...head,
    o.body ?? deflateRawSync(data),
    le32(o.crc ?? crc32(data)),
    le32(o.size ?? data.length),
  );
}

describe('gunzip (INP-4, 0017)', () => {
  it('INP-4: given one member, when decoded, then gives its content and ok', () => {
    const { out, result } = run(gzipSync(enc('<feedback/>')));
    expect(dec(out)).toBe('<feedback/>');
    expect(result).toEqual({ kind: 'ok', members: 1 });
  });

  it('INP-4: given two members joined, when decoded, then gives both contents in order', () => {
    const { out, result } = run(cat(gzipSync(enc('<a/>')), gzipSync(enc('<b/>'))));
    expect(dec(out)).toBe('<a/><b/>');
    expect(result).toEqual({ kind: 'ok', members: 2 });
  });

  it('INP-4: given a header with FEXTRA, FNAME, FCOMMENT, and FHCRC, when decoded, then the fields are skipped', () => {
    expect(dec(run(member(enc('<x/>'), { flags: 2 | 4 | 8 | 16 })).out)).toBe('<x/>');
  });

  it('INP-4: given a wrong header CRC (FHCRC), when decoded, then header error', () => {
    expect(run(member(enc('<x/>'), { flags: 2, headerCrc: 0x1234 })).result).toMatchObject({
      kind: 'error',
      reason: 'header',
      offset: 0,
    });
  });

  it('INP-4: given zero padding after the last member, when decoded, then ok', () => {
    const { out, result } = run(cat(gzipSync(enc('<a/>')), new Uint8Array(512)));
    expect(dec(out)).toBe('<a/>');
    expect(result).toEqual({ kind: 'ok', members: 1 });
  });

  it('RFC 1951 §3.2.7: given an incomplete code-length code, when decoded, then data error', () => {
    // Dynamic block: HLIT 257, HDIST 1, HCLEN 4, and one 1-bit code length for symbol 16 only.
    const body = Uint8Array.of(0b00000101, 0, 0b00000100, 0);
    expect(run(member(enc(''), { body })).result).toMatchObject({ kind: 'error', reason: 'data' });
  });

  it('0017: given zlib output of random and repetitive data at several levels, when decoded with small chunks, then the bytes match', () => {
    let seed = 11;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed >> 8;
    };
    for (const size of [0, 1, 100, 40_000, 70_000, 200_000]) {
      const random = Uint8Array.from({ length: size }, () => rand() & 255);
      const text = Uint8Array.from({ length: size }, (_, i) => 97 + ((i * 7 + (rand() % 3)) % 26));
      for (const data of [random, text]) {
        for (const level of [1, 6, 9]) {
          const { out, result } = run(gzipSync(data, { level }), 1 << 30, 1024);
          expect(result).toEqual({ kind: 'ok', members: 1 });
          expect(same(out, data)).toBe(true);
        }
      }
    }
  });

  it('0017: given a chunk size of 0, when decoded, then it still ends', () => {
    expect(dec(run(gzipSync(enc('x'.repeat(100_000))), 1 << 30, 0).out)).toBe('x'.repeat(100_000));
  });

  it('RFC 1951 §3.2.4: given a stored block, when decoded, then gives its bytes', () => {
    // BFINAL=1, BTYPE=00, then LEN=3, NLEN=~3, then the bytes.
    const body = Uint8Array.of(1, 3, 0, 0xfc, 0xff, 0x61, 0x62, 0x63);
    expect(dec(run(member(enc('abc'), { body })).out)).toBe('abc');
  });

  it('RFC 1951 §3.2.4: given a stored block whose NLEN is not the complement of LEN, when decoded, then data error', () => {
    const body = Uint8Array.of(1, 3, 0, 0, 0, 0x61, 0x62, 0x63);
    expect(run(member(enc('abc'), { body })).result).toMatchObject({
      kind: 'error',
      reason: 'data',
    });
  });

  it('RFC 1951 §3.2.6: given fixed Huffman data, when decoded, then gives the content', () => {
    // zlib picks fixed codes for very short input.
    expect(dec(run(gzipSync(enc('a'))).out)).toBe('a');
  });

  it('RFC 1951 §3.2.7: given dynamic Huffman data with long back references across output chunks, when decoded, then gives the content', () => {
    const data = new Uint8Array(1_500_000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (i >> 7)) & 255;
    const { out, result } = run(gzipSync(data, { level: 9 }));
    expect(result.kind).toBe('ok');
    expect(same(out, data)).toBe(true);
  });

  it('INP-4: given a CRC-32 that does not match, when decoded, then crc error after the content', () => {
    const { out, result } = run(member(enc('<x/>'), { crc: 1 }));
    expect(dec(out)).toBe('<x/>');
    expect(result).toMatchObject({ kind: 'error', reason: 'crc' });
  });

  it('INP-4: given an ISIZE that does not match, when decoded, then size error', () => {
    expect(run(member(enc('<x/>'), { size: 99 })).result).toMatchObject({
      kind: 'error',
      reason: 'size',
    });
  });

  it('INP-4: given a second member cut short, when decoded, then the first member stays and truncated error', () => {
    const second = gzipSync(enc('<b>second</b>'));
    const { out, result } = run(cat(gzipSync(enc('<a/>')), second.subarray(0, second.length - 6)));
    expect(dec(out).startsWith('<a/>')).toBe(true);
    expect(result).toMatchObject({ kind: 'error', reason: 'truncated' });
  });

  it('INP-4: given bytes after a member that do not start another, when decoded, then trailing error with the member kept', () => {
    const { out, result } = run(cat(gzipSync(enc('<a/>')), Uint8Array.of(1, 2, 3, 4)));
    expect(dec(out)).toBe('<a/>');
    expect(result).toMatchObject({ kind: 'error', reason: 'trailing', offset: 24 });
  });

  it('INP-4: given a header whose method is not deflate, when decoded, then header error', () => {
    const bad = gzipSync(enc('x'));
    bad[2] = 7;
    expect(run(bad).result).toMatchObject({ kind: 'error', reason: 'header', offset: 0 });
  });

  it('INP-4: given empty input, when decoded, then truncated error', () => {
    expect(run(new Uint8Array()).result).toMatchObject({ kind: 'error', reason: 'truncated' });
  });

  it('RFC 1951 §3.2.3: given the reserved block type, when decoded, then data error', () => {
    expect(run(member(enc(''), { body: Uint8Array.of(0b111) })).result).toMatchObject({
      kind: 'error',
      reason: 'data',
    });
  });

  it('RFC 1951 §3.2.5: given a distance before the start of the member, when decoded, then data error', () => {
    // Fixed block: length 3 (code 257), distance code 0 (distance 1), with nothing written yet.
    // Bits LSB first: BFINAL 1, BTYPE 01, code 257 = 0000001 (7 bits), distance 00000.
    const body = Uint8Array.of(0b00000011, 0b00000010, 0);
    expect(run(member(enc(''), { body })).result).toMatchObject({ kind: 'error', reason: 'data' });
  });

  it('INP-6: given output past the limit, when decoded, then exceeded without yielding past it', () => {
    const { out, result } = run(gzipSync(new Uint8Array(1_000_000)), 100_000);
    expect(result).toEqual({ kind: 'exceeded' });
    expect(out.length).toBeLessThanOrEqual(100_000);
  });

  it('0017: given mutated gzip data, when decoded, then it never throws and always ends', () => {
    const base = gzipSync(enc('<feedback><record><row>x</row></record></feedback>'.repeat(50)));
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let n = 0; n < 300; n++) {
      const bytes = base.slice(0, rand() % (base.length + 1));
      for (let k = 0; k < 4; k++) if (bytes.length) bytes[rand() % bytes.length] = rand() & 255;
      expect(() => run(bytes, 1 << 20)).not.toThrow();
    }
  });
});

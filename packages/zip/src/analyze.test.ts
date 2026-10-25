import { describe, expect, it } from 'vitest';
import { analyzeZip } from './analyze.ts';
import { crc32 } from './crc32.ts';
import { bytesSource } from './source.ts';
import {
  type BuildOptions,
  type Built,
  buildZip,
  concat,
  extraBlock,
  type FixtureEntry,
  patch,
  Writer,
} from './test/build-zip.ts';
import { PYTHON_ZIPFILE } from './test/python-zipfile.ts';
import type { FindingId, ZipReport } from './types.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const analyze = (bytes: Uint8Array, limits = {}) => analyzeZip(bytesSource(bytes), { limits });
const build = (entries: FixtureEntry[], options?: BuildOptions) => buildZip(entries, options);
const ids = (r: ZipReport) => r.findings.map((f) => f.id);
const kinds = (r: ZipReport) => r.regions.map((g) => [g.kind, g.offset, g.byteLength]);
const two = (): FixtureEntry[] => [
  { name: 'a.txt', content: 'hello' },
  { name: 'dir/b.txt', content: 'world!' },
];

describe('an archive from a common tool', () => {
  it('REQ-ZIP-002: given an archive written by Python zipfile, when analyzed, then lists every entry with no findings', async () => {
    const r = await analyze(PYTHON_ZIPFILE);
    expect(r.findings).toEqual([]);
    expect(r.end?.comment.text).toBe('made by Python zipfile');
    expect(
      r.entries.map((e) => [
        e.name.text,
        e.name.source,
        e.kind,
        e.central.method.name,
        e.compressedSize,
        e.uncompressedSize,
        e.zip64,
        e.central.modified.text,
      ]),
    ).toEqual([
      ['docs/', 'cp437', 'directory', 'Stored', 0, 0, false, '2025-01-02 03:04:06'],
      ['docs/readme.txt', 'cp437', 'file', 'Deflated', 12, 300, false, '2025-01-02 03:04:06'],
      ['日本語.txt', 'utf-8-flag', 'file', 'Stored', 10, 10, false, '2025-01-02 03:04:06'],
      ['inner.zip', 'cp437', 'file', 'Deflated', 78, 128, false, '2025-01-02 03:04:06'],
      ['big.bin', 'cp437', 'file', 'Stored', 3, 3, true, '2025-01-02 03:04:06'],
    ]);
  });
});

describe('end of central directory record', () => {
  it('EOCD-1: given a plain archive, when analyzed, then finds the EOCD and reads every entry with no findings', async () => {
    const z = build(two());
    const r = await analyze(z.bytes);
    expect(r.end?.eocd.offset).toBe(z.eocdOffset);
    expect(r.end?.entryCount).toBe(2);
    expect(r.entries.map((e) => e.name.text)).toEqual(['a.txt', 'dir/b.txt']);
    expect(r.findings).toEqual([]);
  });

  it('EOCD-1: given a comment holding the EOCD signature, when analyzed, then the exact EOCD wins', async () => {
    const z = build(two(), { comment: concat(utf8('PK\x05\x06'), utf8('xyz')) });
    const r = await analyze(z.bytes);
    expect(r.end?.eocd.offset).toBe(z.eocdOffset);
    expect(r.end?.comment.text).toBe('PK\x05\x06xyz');
  });

  it('EOCD-1: given a 65 535-byte comment, when analyzed, then still finds the EOCD', async () => {
    const z = build(two(), { comment: new Uint8Array(65535).fill(0x41) });
    expect((await analyze(z.bytes)).entries).toHaveLength(2);
  });

  it('EOCD-1: given an empty archive, when analyzed, then no entries, one eocd region, no findings', async () => {
    const r = await analyze(build([]).bytes);
    expect(r.entries).toEqual([]);
    expect(kinds(r)).toEqual([['eocd', 0, 22]]);
    expect(r.findings).toEqual([]);
  });

  it('EOCD-2: given bytes after the comment, when analyzed, then a trailing region and trailing-data', async () => {
    const z = build(two(), { append: new Uint8Array(7) });
    const r = await analyze(z.bytes);
    expect(r.entries).toHaveLength(2);
    expect(r.regions.at(-1)).toEqual({
      kind: 'trailing',
      offset: z.bytes.length - 7,
      byteLength: 7,
    });
    expect(ids(r)).toEqual(['zip.eocd.trailing-data']);
  });

  it('EOCD-3: given bytes with no EOCD, when analyzed, then eocd.missing and one unknown region', async () => {
    const r = await analyze(new Uint8Array(100).fill(7));
    expect(r.end).toBeNull();
    expect(ids(r)).toEqual(['zip.eocd.missing']);
    expect(kinds(r)).toEqual([['unknown', 0, 100]]);
  });

  it('EOCD-3: given an empty file, when analyzed, then eocd.missing and no regions', async () => {
    const r = await analyze(new Uint8Array());
    expect(ids(r)).toEqual(['zip.eocd.missing']);
    expect(r.regions).toEqual([]);
  });

  it('EOCD-3: given only part of an EOCD, when analyzed, then eocd.missing', async () => {
    expect(ids(await analyze(build([]).bytes.subarray(0, 20)))).toEqual(['zip.eocd.missing']);
  });

  it('EOCD-4: given disk number 1, when analyzed, then multi-disk', async () => {
    const z = build(two());
    patch(z.bytes, z.eocdOffset + 4, 1, 2);
    expect(ids(await analyze(z.bytes))).toContain('zip.multi-disk');
  });
});

describe('ZIP64', () => {
  it('Z64-1, Z64-4: given ZIP64 end records with sentinels, when analyzed, then uses the ZIP64 values', async () => {
    const z = build(two(), { zip64: true });
    const r = await analyze(z.bytes);
    expect(r.end?.zip64).toMatchObject({
      offset: z.zip64Offset,
      locatorOffset: z.locatorOffset,
      entries: 2,
    });
    expect(r.end?.entryCount).toBe(2);
    expect(r.entries).toHaveLength(2);
    expect(r.findings).toEqual([]);
    expect(r.regions.slice(-3).map((g) => [g.kind, g.byteLength])).toEqual([
      ['zip64-eocd', 56],
      ['zip64-locator', 20],
      ['eocd', 22],
    ]);
  });

  it('Z64-1: given a locator with 2 total disks, when analyzed, then multi-disk', async () => {
    const z = build(two(), { zip64: true });
    patch(z.bytes, (z.locatorOffset as number) + 16, 2, 4);
    expect(ids(await analyze(z.bytes))).toEqual(['zip.multi-disk']);
  });

  it('Z64-4: given an EOCD count that is not a sentinel and differs, when analyzed, then zip64.mismatch and the ZIP64 count is used', async () => {
    const z = build(two(), { zip64: true });
    patch(z.bytes, z.eocdOffset + 10, 5, 2);
    const r = await analyze(z.bytes);
    expect(ids(r)).toEqual(['zip64.mismatch']);
    expect(r.entries).toHaveLength(2);
  });

  it('Z64-2: given prepended bytes and unshifted ZIP64 offsets, when analyzed, then finds the record before the locator and the shift', async () => {
    const z = build(two(), { zip64: true, prepend: new Uint8Array(100) });
    const r = await analyze(z.bytes);
    expect(r.end?.shift).toBe(100);
    expect(r.end?.zip64?.offset).toBe(z.zip64Offset);
    expect(ids(r)).toEqual(['zip.offsets-shifted']);
    expect(r.entries.map((e) => e.local?.offset)).toEqual(z.local);
  });

  it('Z64-2: given no record at either place, when analyzed, then zip64.record-missing and the EOCD values alone', async () => {
    const z = build(two(), { zip64: true });
    patch(z.bytes, z.zip64Offset as number, 0, 4);
    const r = await analyze(z.bytes);
    expect(r.end?.zip64).toBeNull();
    expect(ids(r)).toContain('zip64.record-missing');
    expect(ids(r)).toContain('zip64.missing');
  });

  it('Z64-3: given a size field below 44, when analyzed, then zip64.record-size and a 56-byte region', async () => {
    const z = build(two(), { zip64: true });
    patch(z.bytes, (z.zip64Offset as number) + 4, 10, 4);
    const r = await analyze(z.bytes);
    expect(ids(r)).toEqual(['zip64.record-size']);
    expect(r.end?.zip64?.byteLength).toBe(56);
  });

  it('Z64-4: given an EOCD sentinel and no ZIP64 records, when analyzed, then zip64.missing', async () => {
    const z = build(two());
    patch(z.bytes, z.eocdOffset + 12, 0xffffffff, 4);
    expect(ids(await analyze(z.bytes))).toContain('zip64.missing');
  });

  it('NUM-1: given a ZIP64 entry count above 2^53, when analyzed, then value-too-large and the record is ignored', async () => {
    const z = build(two(), { zip64: true });
    patch(z.bytes, (z.zip64Offset as number) + 32 + 4, 0x01000000, 4);
    const r = await analyze(z.bytes);
    expect(ids(r)).toContain('zip.value-too-large');
    expect(r.end?.zip64).toBeNull();
  });

  it('Z64-5: given a ZIP64 entry, when analyzed, then sizes and the local offset come from its extra field', async () => {
    const z = build([
      { name: 'a', content: 'abc' },
      { name: 'big', content: 'hello', zip64: true },
    ]);
    const r = await analyze(z.bytes);
    const e = r.entries[1];
    expect(e).toMatchObject({
      zip64: true,
      compressedSize: 5,
      uncompressedSize: 5,
      localHeaderOffset: z.local[1],
    });
    expect(e?.central.compressedSize).toBe(0xffffffff);
    expect(e?.central.extra[0]?.zip64).toEqual({
      uncompressedSize: 5,
      compressedSize: 5,
      localHeaderOffset: z.local[1],
    });
    expect(r.findings).toEqual([]);
  });

  it('Z64-6: given local sentinel sizes and a ZIP64 extra, when analyzed, then the local effective sizes match', async () => {
    const z = build([{ name: 'big', content: 'hello', zip64: true }]);
    const r = await analyze(z.bytes);
    expect(r.entries[0]?.local).toMatchObject({
      effectiveCompressedSize: 5,
      effectiveUncompressedSize: 5,
    });
    expect(r.entries[0]?.mismatches).toEqual([]);
  });

  it('Z64-7: given a central sentinel size and no 0x0001 block, when analyzed, then zip64.extra-missing', async () => {
    const z = build([{ name: 'a', content: 'abc' }]);
    patch(z.bytes, (z.central[0] as number) + 20, 0xffffffff, 4);
    const r = await analyze(z.bytes);
    expect(ids(r)).toContain('zip64.extra-missing');
    expect(r.entries[0]?.compressedSize).toBe(0xffffffff);
  });

  it('Z64-7: given a 0x0001 block shorter than its fields, when analyzed, then zip64.extra-short', async () => {
    const z = build([
      {
        name: 'a',
        content: 'abc',
        central: { compressedSize: 0xffffffff, uncompressedSize: 0xffffffff },
        centralExtra: extraBlock(0x0001, new Writer().u64(3).done()),
      },
    ]);
    expect(ids(await analyze(z.bytes))).toContain('zip64.extra-short');
  });
});

describe('central directory', () => {
  it('CD-2: given a 100-byte stub before the archive, when analyzed, then the shift is 100 and the stub is a prepended region', async () => {
    const z = build(two(), { prepend: new Uint8Array(100) });
    const r = await analyze(z.bytes);
    expect(r.end?.shift).toBe(100);
    expect(r.end?.cdOffset).toBe(z.cdOffset - 100);
    expect(ids(r)).toEqual(['zip.offsets-shifted']);
    expect(r.regions[0]).toEqual({ kind: 'prepended', offset: 0, byteLength: 100 });
    expect(r.entries.map((e) => [e.localHeaderOffset, e.local?.offset])).toEqual(
      z.local.map((o) => [o, o]),
    );
  });

  it('CD-1: given a central directory size reaching past the end records, when analyzed, then cd.out-of-range', async () => {
    const z = build(two());
    patch(z.bytes, z.eocdOffset + 12, z.cdByteLength + 10, 4);
    const r = await analyze(z.bytes);
    expect(ids(r)).toContain('zip.cd.out-of-range');
    expect(r.entries).toHaveLength(2);
  });

  it('CD-3: given a bad signature in the second header, when analyzed, then cd.bad-signature and one entry', async () => {
    const z = build(two());
    patch(z.bytes, z.central[1] as number, 0, 4);
    const r = await analyze(z.bytes);
    expect(ids(r)).toContain('zip.cd.bad-signature');
    expect(r.entries).toHaveLength(1);
  });

  it('CD-3: given a header cut short by the central directory size, when analyzed, then cd.truncated', async () => {
    const z = build(two());
    patch(z.bytes, z.eocdOffset + 12, z.cdByteLength - 5, 4);
    patch(z.bytes, z.eocdOffset + 16, z.cdOffset, 4);
    const r = await analyze(z.bytes);
    expect(ids(r)).toContain('zip.cd.truncated');
    expect(r.entries).toHaveLength(1);
  });

  it('CD-4: given a count above the headers present, when analyzed, then cd.count-mismatch', async () => {
    const z = build(two());
    patch(z.bytes, z.eocdOffset + 8, 3, 2);
    patch(z.bytes, z.eocdOffset + 10, 3, 2);
    const r = await analyze(z.bytes);
    expect(ids(r)).toEqual(['zip.cd.count-mismatch']);
    expect(r.entries).toHaveLength(2);
  });

  it('CD-4: given a count below the headers present, when analyzed, then cd.size-mismatch', async () => {
    const z = build(two());
    patch(z.bytes, z.eocdOffset + 8, 1, 2);
    patch(z.bytes, z.eocdOffset + 10, 1, 2);
    const r = await analyze(z.bytes);
    // The unread entry's local header and central header are gaps.
    expect(ids(r)).toEqual(['zip.cd.size-mismatch', 'zip.gap', 'zip.gap']);
    expect(r.entries).toHaveLength(1);
  });

  it('CD-4: given a digital signature record after the headers, when analyzed, then it is a region and no finding', async () => {
    const z = build(two(), {
      afterCentral: new Writer().u32(0x05054b50).u16(3).bytes('sig').done(),
    });
    patch(z.bytes, z.eocdOffset + 12, z.cdByteLength + 9, 4);
    const r = await analyze(z.bytes);
    expect(r.regions.find((g) => g.kind === 'digital-signature')).toEqual({
      kind: 'digital-signature',
      offset: z.cdOffset + z.cdByteLength,
      byteLength: 9,
    });
    expect(r.findings).toEqual([]);
  });

  it('CD-5: given more headers than the limit, when analyzed, then too-many-entries and only the limit is read', async () => {
    const z = build([...two(), { name: 'c' }]);
    const r = await analyze(z.bytes, { maxEntries: 2 });
    expect(ids(r)).toContain('zip.too-many-entries');
    expect(r.entries).toHaveLength(2);
  });

  it('CD-6: given a name ending with a slash, when analyzed, then the entry is a directory', async () => {
    const r = await analyze(build([{ name: 'dir/' }, { name: 'dir/f' }]).bytes);
    expect(r.entries.map((e) => e.kind)).toEqual(['directory', 'file']);
  });

  it('REP-3: given a central header, when analyzed, then raw fields keep their numbers next to decoded values', async () => {
    const z = build([
      { name: 'a', content: 'abc', versionMadeBy: 0x031e, external: 0o100644 * 0x10000 },
    ]);
    const c = (await analyze(z.bytes)).entries[0]?.central;
    expect(c).toMatchObject({
      offset: z.central[0],
      versionMadeBy: { raw: 0x031e, host: 'UNIX', spec: '3.0' },
      versionNeeded: { raw: 20, spec: '2.0' },
      method: { code: 0, name: 'Stored' },
      modified: { text: '2025-01-01 12:00:00' },
      crc32: crc32(utf8('abc')),
      compressedSize: 3,
      uncompressedSize: 3,
      externalAttributes: { unixMode: '-rw-r--r--' },
      localHeaderOffset: 0,
    });
  });
});

describe('local headers', () => {
  it('LH-1: given a local offset past the file, when analyzed, then local.out-of-range and no local header', async () => {
    const z = build(two());
    patch(z.bytes, (z.central[1] as number) + 42, 0x00ffffff, 4);
    const r = await analyze(z.bytes);
    expect(ids(r)).toContain('zip.local.out-of-range');
    expect(r.entries[1]).toMatchObject({ local: null, data: null, descriptor: null });
  });

  it('LH-1: given a wrong local signature, when analyzed, then local.bad-signature', async () => {
    const z = build(two());
    patch(z.bytes, z.local[0] as number, 0x12345678, 4);
    const r = await analyze(z.bytes);
    expect(r.findings).toMatchObject([
      { id: 'zip.local.bad-signature', entry: 0, offset: z.local[0] },
    ]);
  });

  it('LH-2: given a different local name, when analyzed, then local.mismatch lists name', async () => {
    const r = await analyze(build([{ name: 'a.txt', localName: 'evil.txt', content: 'x' }]).bytes);
    expect(r.entries[0]?.mismatches).toEqual(['name']);
    expect(ids(r)).toEqual(['zip.local.mismatch']);
  });

  it('LH-2: given a different method and CRC-32, when analyzed, then both are listed', async () => {
    const r = await analyze(
      build([{ name: 'a', content: 'x', local: { method: 8, crc32: 1 } }]).bytes,
    );
    expect(r.entries[0]?.mismatches).toEqual(['method', 'crc32']);
  });

  it('LH-2: given a data descriptor, when analyzed, then zero local CRC-32 and sizes are not mismatches', async () => {
    const r = await analyze(build([{ name: 'a', content: 'abc', descriptor: 'signed' }]).bytes);
    expect(r.entries[0]?.mismatches).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it('LH-3: given an entry, when analyzed, then its data starts after the local extra field and is as long as the compressed size', async () => {
    const z = build([
      { name: 'a', content: 'abcde', localExtra: extraBlock(0x5455, new Uint8Array(5)) },
    ]);
    expect((await analyze(z.bytes)).entries[0]?.data).toEqual({ offset: z.data[0], byteLength: 5 });
  });

  it('LH-3: given a compressed size reaching past the file, when analyzed, then data.truncated and the region stops at the end', async () => {
    const z = build([{ name: 'a', content: 'abc' }]);
    patch(z.bytes, (z.central[0] as number) + 20, 0x00100000, 4);
    const r = await analyze(z.bytes);
    expect(ids(r)).toContain('zip.data.truncated');
    expect(r.regions.find((g) => g.kind === 'file-data')).toEqual({
      kind: 'file-data',
      offset: z.data[0],
      byteLength: z.bytes.length - (z.data[0] as number),
      entry: 0,
    });
  });

  it('LH-4: given signed and unsigned descriptors, when analyzed, then reads 16 and 12 bytes', async () => {
    const z = build([
      { name: 'a', content: 'abc', descriptor: 'signed' },
      { name: 'b', content: 'de', descriptor: 'unsigned' },
    ]);
    const r = await analyze(z.bytes);
    expect(r.entries.map((e) => e.descriptor)).toEqual([
      {
        offset: (z.data[0] as number) + 3,
        byteLength: 16,
        signature: true,
        crc32: crc32(utf8('abc')),
        compressedSize: 3,
        uncompressedSize: 3,
      },
      {
        offset: (z.data[1] as number) + 2,
        byteLength: 12,
        signature: false,
        crc32: crc32(utf8('de')),
        compressedSize: 2,
        uncompressedSize: 2,
      },
    ]);
    expect(r.findings).toEqual([]);
  });

  it('LH-4: given a ZIP64 entry with a descriptor, when analyzed, then reads 8-byte sizes', async () => {
    const r = await analyze(
      build([{ name: 'a', content: 'abc', descriptor: 'signed', zip64: true }]).bytes,
    );
    expect(r.entries[0]?.descriptor).toMatchObject({
      byteLength: 24,
      compressedSize: 3,
      uncompressedSize: 3,
    });
    expect(r.findings).toEqual([]);
  });

  it('LH-4: given a descriptor CRC-32 that differs, when analyzed, then descriptor.mismatch', async () => {
    const z = build([{ name: 'a', content: 'abc', descriptor: 'signed' }]);
    patch(z.bytes, (z.data[0] as number) + 3 + 4, 99, 4);
    expect(ids(await analyze(z.bytes))).toEqual(['zip.descriptor.mismatch']);
  });

  it('LH-4: given a descriptor that does not fit in the file, when analyzed, then descriptor.truncated', async () => {
    const z = build([{ name: 'a', content: 'abc', descriptor: 'signed' }]);
    patch(z.bytes, (z.central[0] as number) + 20, z.bytes.length - (z.data[0] as number) - 4, 4);
    expect(ids(await analyze(z.bytes))).toContain('zip.descriptor.truncated');
  });
});

describe('byte map', () => {
  it('MAP-1: given a plain archive, when analyzed, then every record is a region in offset order', async () => {
    const z = build(two());
    const r = await analyze(z.bytes);
    expect(r.regions.map((g) => [g.kind, g.offset, g.entry])).toEqual([
      ['local-header', z.local[0], 0],
      ['file-data', z.data[0], 0],
      ['local-header', z.local[1], 1],
      ['file-data', z.data[1], 1],
      ['central-header', z.central[0], 0],
      ['central-header', z.central[1], 1],
      ['eocd', z.eocdOffset, undefined],
    ]);
  });

  it('MAP-1: given an empty file entry, when analyzed, then it has no file-data region', async () => {
    const r = await analyze(build([{ name: 'empty' }]).bytes);
    expect(r.regions.map((g) => g.kind)).toEqual(['local-header', 'central-header', 'eocd']);
  });

  it('MAP-2: given bytes between the central directory and the EOCD, when analyzed, then a gap region and zip.gap', async () => {
    const z = build(two(), { afterCentral: new Uint8Array(7) });
    const r = await analyze(z.bytes);
    expect(r.regions).toContainEqual({
      kind: 'gap',
      offset: z.cdOffset + z.cdByteLength,
      byteLength: 7,
    });
    expect(ids(r)).toEqual(['zip.gap']);
  });

  it('MAP-3: given two central headers pointing at one local header, when analyzed, then zip.overlap', async () => {
    const z = build(two());
    patch(z.bytes, (z.central[1] as number) + 42, 0, 4);
    const r = await analyze(z.bytes);
    expect(ids(r)).toContain('zip.overlap');
  });
});

describe('names and comments', () => {
  it('NAME-1: given flag bit 11 and a UTF-8 name, when analyzed, then the name is UTF-8 from the flag', async () => {
    const r = await analyze(build([{ name: '日本.txt', flags: 0x0800 }]).bytes);
    expect(r.entries[0]?.name).toMatchObject({
      text: '日本.txt',
      encoding: 'utf-8',
      source: 'utf-8-flag',
    });
  });

  it('NAME-1: given flag bit 11 and invalid UTF-8, when analyzed, then name.invalid-utf8', async () => {
    const r = await analyze(build([{ name: Uint8Array.of(0x61, 0xff), flags: 0x0800 }]).bytes);
    expect(r.entries[0]?.name.text).toBe('a�');
    expect(ids(r)).toEqual(['zip.name.invalid-utf8']);
  });

  it('NAME-2: given a matching Unicode Path extra field, when analyzed, then the name comes from it', async () => {
    const raw = Uint8Array.of(0x8e, 0x2e, 0x74);
    const up = new Writer().u8(1).u32(crc32(raw)).bytes('Ä.t').done();
    const r = await analyze(build([{ name: raw, centralExtra: extraBlock(0x7075, up) }]).bytes);
    expect(r.entries[0]?.name).toMatchObject({
      text: 'Ä.t',
      encoding: 'utf-8',
      source: 'unicode-path',
    });
    expect(r.findings).toEqual([]);
  });

  it('NAME-2: given a stale Unicode Path extra field, when analyzed, then unicode-path.stale and the CP437 name', async () => {
    const raw = Uint8Array.of(0x8e, 0x2e, 0x74);
    const up = new Writer().u8(1).u32(0).bytes('other').done();
    const r = await analyze(build([{ name: raw, centralExtra: extraBlock(0x7075, up) }]).bytes);
    expect(r.entries[0]?.name).toMatchObject({ text: 'Ä.t', encoding: 'cp437', source: 'cp437' });
    expect(ids(r)).toEqual(['zip.unicode-path.stale']);
  });

  it('NAME-3, NAME-5: given no flag, when analyzed, then Code Page 437 and the raw bytes', async () => {
    const r = await analyze(build([{ name: Uint8Array.of(0x82, 0x2e, 0x74) }]).bytes);
    expect(r.entries[0]?.name).toMatchObject({ text: 'é.t', source: 'cp437' });
    expect([...(r.entries[0]?.name.bytes ?? [])]).toEqual([0x82, 0x2e, 0x74]);
  });

  it('NAME-1: given flag bit 11, when analyzed, then the entry comment is UTF-8', async () => {
    const r = await analyze(build([{ name: 'a', flags: 0x0800, comment: 'ç' }]).bytes);
    expect(r.entries[0]?.comment).toEqual({ text: 'ç', encoding: 'utf-8', guessed: false });
  });

  it('NAME-4: given a UTF-8 archive comment, when analyzed, then it is guessed UTF-8', async () => {
    const r = await analyze(build([], { comment: 'ありがとう' }).bytes);
    expect(r.end?.comment).toEqual({ text: 'ありがとう', encoding: 'utf-8', guessed: true });
  });
});

describe('archive hint', () => {
  it('NEST-1: given archive-like names, when analyzed, then they carry the hint', async () => {
    const r = await analyze(
      build([
        { name: 'a.ZIP' },
        { name: 'lib/x.jar' },
        { name: 'doc.docx' },
        { name: 'a.txt' },
        { name: 'zip/' },
      ]).bytes,
    );
    expect(r.entries.map((e) => e.archiveHint)).toEqual([true, true, true, false, false]);
  });
});

describe('robustness', () => {
  it('REQ-ZIP-005: given a large archive, when analyzed, then only the needed ranges are read', async () => {
    const z = build([
      { name: 'big', content: new Uint8Array(5_000_000) },
      { name: 'small', content: 'x' },
    ]);
    let read = 0;
    const inner = bytesSource(z.bytes);
    const source = {
      byteLength: inner.byteLength,
      read: (o: number, n: number) => {
        read += n;
        return inner.read(o, n);
      },
    };
    const r = await analyzeZip(source);
    expect(r.entries).toHaveLength(2);
    expect(read).toBeLessThan(z.bytes.length / 2);
  });

  it('REQ-ZIP-005: given large entries, when analyzed, then each local header costs a small read, not a whole window', async () => {
    const big = () => new Uint8Array(2_000_000);
    const z = build([
      { name: 'a', content: big(), descriptor: 'signed' },
      { name: 'b', content: big(), descriptor: 'signed' },
      { name: 'c', content: big() },
    ]);
    let read = 0;
    const inner = bytesSource(z.bytes);
    await analyzeZip({
      byteLength: inner.byteLength,
      read: (o: number, n: number) => {
        read += n;
        return inner.read(o, n);
      },
    });
    expect(read).toBeLessThan(512 * 1024);
  });

  it('REQ-ZIP-005: given 300 randomly damaged archives, when analyzed, then none throws', async () => {
    const base: Built = build(
      [
        { name: 'a.txt', content: 'hello', descriptor: 'signed' },
        {
          name: 'b',
          content: 'xyz',
          zip64: true,
          centralExtra: extraBlock(0x7075, Uint8Array.of(1, 0, 0, 0, 0, 0x41)),
        },
        { name: 'dir/' },
      ],
      { zip64: true, comment: 'c' },
    );
    let seed = 1;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 300; i++) {
      const bytes = base.bytes.slice(0, base.bytes.length - (i % 7 === 0 ? random() % 40 : 0));
      for (let k = 0; k < 1 + (i % 5); k++) bytes[random() % bytes.length] = random() & 0xff;
      const r = await analyze(bytes);
      expect(r.byteLength).toBe(bytes.length);
    }
  });
});

describe('report', () => {
  it('REP-1: given no path, when analyzed, then the path is empty', async () => {
    expect((await analyze(build([]).bytes)).path).toEqual([]);
  });

  it('REP-8: given more findings than the limit, when analyzed, then too-many-findings', async () => {
    const z = build(two());
    patch(z.bytes, z.local[0] as number, 0, 4);
    patch(z.bytes, z.local[1] as number, 0, 4);
    const r = await analyze(z.bytes, { maxFindings: 1 });
    expect(ids(r).at(-1)).toBe<FindingId>('zip.too-many-findings');
  });
});

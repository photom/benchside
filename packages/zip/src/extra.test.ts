import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32.ts';
import { extraName, splitExtra, toBlock, unicodePath, zip64Fields } from './extra.ts';
import { FindingList } from './findings.ts';
import { concat, extraBlock, Writer } from './test/build-zip.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const ALL = {
  uncompressedSize: true,
  compressedSize: true,
  localHeaderOffset: true,
  diskStart: true,
};
const NONE = {
  uncompressedSize: false,
  compressedSize: false,
  localHeaderOffset: false,
  diskStart: false,
};

describe('extra field blocks', () => {
  it('EXT-1: given two blocks, when split, then gives each with its offset and data', () => {
    const findings = new FindingList();
    const bytes = concat(
      extraBlock(0x5455, Uint8Array.of(1, 2, 3)),
      extraBlock(0x000a, new Uint8Array(4)),
    );
    const blocks = splitExtra(bytes, 100, findings, 0);
    expect(blocks.map((b) => [b.id, b.offset, b.data.length])).toEqual([
      [0x5455, 100, 3],
      [0x000a, 107, 4],
    ]);
    expect(findings.list).toEqual([]);
  });

  it('EXT-1: given a block whose size reaches past the field, when split, then the rest is one block with no ID', () => {
    const findings = new FindingList();
    const bytes = concat(
      extraBlock(0x5455, Uint8Array.of(1)),
      new Writer().u16(0x7875).u16(50).u8(9).done(),
    );
    const blocks = splitExtra(bytes, 0, findings, 2);
    expect(blocks.map((b) => [b.id, b.offset, b.data.length])).toEqual([
      [0x5455, 0, 1],
      [null, 5, 5],
    ]);
    expect(findings.list).toMatchObject([{ id: 'zip.extra.malformed', offset: 5, entry: 2 }]);
  });

  it('EXT-1: given 2 bytes left over, when split, then they are a malformed rest', () => {
    const findings = new FindingList();
    const blocks = splitExtra(Uint8Array.of(0, 0), 10, findings, 0);
    expect(blocks.map((b) => [b.id, b.offset, b.data.length])).toEqual([[null, 10, 2]]);
    expect(findings.list.map((f) => f.id)).toEqual(['zip.extra.malformed']);
  });

  it('EXT-2: given known and unknown IDs, when named, then uses the APPNOTE tables', () => {
    expect(extraName(0x0001)).toBe('Zip64 extended information');
    expect(extraName(0x5455)).toBe('Extended timestamp');
    expect(extraName(0x7075)).toBe('Info-ZIP Unicode Path');
    expect(extraName(0xd935)).toBe('Android ZIP Alignment');
    expect(extraName(0x1234)).toBe('Unknown');
    expect(extraName(null)).toBe('Malformed');
  });

  it('EXT-3: given a 100-byte block, when kept, then keeps its size and the first 64 bytes', () => {
    const data = Uint8Array.from({ length: 100 }, (_, i) => i);
    const block = toBlock({ id: 0x5455, offset: 7, data });
    expect(block).toMatchObject({
      id: 0x5455,
      name: 'Extended timestamp',
      offset: 7,
      byteLength: 100,
    });
    expect([...block.preview]).toEqual([...data.subarray(0, 64)]);
  });
});

describe('ZIP64 extended information', () => {
  const four = new Writer().u64(1000).u64(500).u64(70000).u32(2).done();

  it('Z64-5: given all four needed, when read, then gives them in order', () => {
    expect(zip64Fields(four, ALL)).toEqual({
      values: {
        uncompressedSize: 1000,
        compressedSize: 500,
        localHeaderOffset: 70000,
        diskStart: 2,
      },
      short: false,
      tooLarge: false,
    });
  });

  it('Z64-5: given only the offset needed, when read, then the first 8 bytes are the offset', () => {
    const data = new Writer().u64(70000).done();
    expect(zip64Fields(data, { ...NONE, localHeaderOffset: true }).values).toEqual({
      localHeaderOffset: 70000,
    });
  });

  it('Z64-7: given fewer bytes than needed, when read, then short, with the fields it has', () => {
    const data = new Writer().u64(1000).done();
    expect(zip64Fields(data, ALL)).toEqual({
      values: { uncompressedSize: 1000 },
      short: true,
      tooLarge: false,
    });
  });

  it('NUM-1: given a size above 2^53, when read, then too large', () => {
    const data = new Writer().u64(2n ** 60n).done();
    expect(zip64Fields(data, { ...NONE, uncompressedSize: true }).tooLarge).toBe(true);
  });
});

describe('Info-ZIP Unicode Path', () => {
  const name = Uint8Array.of(0x8e, 0x2e, 0x74); // "Ä.t" in CP437

  it('NAME-2: given version 1 and the name CRC-32, when read, then matches', () => {
    const data = new Writer().u8(1).u32(crc32(name)).bytes(utf8('Ä.txt')).done();
    expect(unicodePath(data, name)).toEqual({
      version: 1,
      nameCrc32: crc32(name),
      name: 'Ä.txt',
      matches: true,
    });
  });

  it('NAME-2: given another CRC-32, when read, then does not match', () => {
    const data = new Writer().u8(1).u32(1234).bytes(utf8('x')).done();
    expect(unicodePath(data, name)?.matches).toBe(false);
  });

  it('NAME-2: given version 2, when read, then does not match', () => {
    const data = new Writer().u8(2).u32(crc32(name)).bytes(utf8('x')).done();
    expect(unicodePath(data, name)?.matches).toBe(false);
  });

  it('NAME-2: given fewer than 5 bytes, when read, then null', () => {
    expect(unicodePath(Uint8Array.of(1, 2), name)).toBeNull();
  });
});

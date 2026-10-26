import { describe, expect, it } from 'vitest';
import { analyzeZip } from './analyze.ts';
import { splitExtra } from './extra.ts';
import { decodeExtra, type Where } from './extra-decode.ts';
import { FindingList } from './findings.ts';
import { bytesSource } from './source.ts';
import { buildZip, concat, extraBlock, Writer } from './test/build-zip.ts';

// 2025-01-02 03:04:05 UTC
const T = 1735787045;
const TEXT = '2025-01-02 03:04:05 UTC';
// The same moment as a FILETIME, plus 0.1234567 s.
const TICKS = 133802606451234567n;

const LOCAL: Where = { header: 'local' };
const CENTRAL: Where = { header: 'central' };

function decode(id: number, data: Uint8Array, where: Where = LOCAL) {
  const findings = new FindingList();
  const decoded = decodeExtra({ id, offset: 50, data }, where, findings, 3);
  return { decoded, ids: findings.list.map((f) => f.id), findings: findings.list };
}

const ut = (flags: number, ...times: number[]) => {
  const w = new Writer().u8(flags);
  for (const t of times) w.u32(t >>> 0);
  return w.done();
};

describe('extended timestamp (0x5455)', () => {
  it('EXT-5, EXT-11: given a local block with three times, when decoded, then each time in UTC with its seconds', () => {
    const { decoded, ids } = decode(0x5455, ut(7, T, T + 3600, T - 86400));
    expect(decoded).toEqual({
      kind: 'timestamp',
      flags: 7,
      modified: { seconds: T, text: TEXT },
      accessed: { seconds: T + 3600, text: '2025-01-02 04:04:05 UTC' },
      created: { seconds: T - 86400, text: '2025-01-01 03:04:05 UTC' },
    });
    expect(ids).toEqual([]);
  });

  it('EXT-5: given a central block with flags 7 and one time, when decoded, then only the modification time', () => {
    const { decoded, ids } = decode(0x5455, ut(7, T), CENTRAL);
    expect(decoded).toEqual({ kind: 'timestamp', flags: 7, modified: { seconds: T, text: TEXT } });
    expect(ids).toEqual([]);
  });

  it('EXT-5: given a local creation time only, when decoded, then it is the creation time', () => {
    expect(decode(0x5455, ut(4, T)).decoded).toEqual({
      kind: 'timestamp',
      flags: 4,
      created: { seconds: T, text: TEXT },
    });
  });

  it('EXT-5: given a local block shorter than its flags say, when decoded, then malformed and the times that fit', () => {
    const { decoded, ids, findings } = decode(0x5455, ut(3, T));
    expect(decoded).toEqual({ kind: 'timestamp', flags: 3, modified: { seconds: T, text: TEXT } });
    expect(ids).toEqual(['zip.extra.malformed']);
    expect(findings[0]).toMatchObject({ offset: 50, entry: 3 });
  });

  it('EXT-5: given a central block with bit 0 and no time, when decoded, then malformed', () => {
    expect(decode(0x5455, ut(1), CENTRAL).ids).toEqual(['zip.extra.malformed']);
  });

  it('EXT-5: given an empty block, when decoded, then malformed and nothing decoded', () => {
    const { decoded, ids } = decode(0x5455, new Uint8Array());
    expect(decoded).toBeUndefined();
    expect(ids).toEqual(['zip.extra.malformed']);
  });

  it('EXT-5: given a negative time, when decoded, then a time before 1970', () => {
    expect(decode(0x5455, ut(1, -1)).decoded).toMatchObject({
      modified: { seconds: -1, text: '1969-12-31 23:59:59 UTC' },
    });
  });
});

describe('Info-ZIP UNIX UID and GID (0x7875)', () => {
  const ux = (version: number, uid: Uint8Array, gid: Uint8Array) =>
    new Writer().u8(version).u8(uid.length).bytes(uid).u8(gid.length).bytes(gid).done();
  const le = (value: number | bigint, size: number) => {
    const out = new Uint8Array(size);
    let v = BigInt(value);
    for (let i = 0; i < size; i++) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return out;
  };

  it('EXT-6: given version 1 with 4-byte IDs, when decoded, then the UID and GID', () => {
    const { decoded, ids } = decode(0x7875, ux(1, le(501, 4), le(20, 4)));
    expect(decoded).toEqual({ kind: 'unix-owner', version: 1, uid: 501, gid: 20 });
    expect(ids).toEqual([]);
  });

  it('EXT-6: given 2-byte and 0-byte IDs, when decoded, then a UID and no GID', () => {
    expect(decode(0x7875, ux(1, le(1000, 2), new Uint8Array())).decoded).toEqual({
      kind: 'unix-owner',
      version: 1,
      uid: 1000,
    });
  });

  it('EXT-6: given version 2, when decoded, then only the version and no finding', () => {
    const { decoded, ids } = decode(0x7875, ux(2, le(501, 4), le(20, 4)));
    expect(decoded).toEqual({ kind: 'unix-owner', version: 2 });
    expect(ids).toEqual([]);
  });

  it('EXT-6: given a UID size of 9, when decoded, then malformed', () => {
    expect(decode(0x7875, ux(1, le(1, 9), le(1, 4))).ids).toEqual(['zip.extra.malformed']);
  });

  it('EXT-6: given a GID past the block, when decoded, then malformed', () => {
    const data = new Writer().u8(1).u8(4).u32(501).u8(4).u16(20).done();
    expect(decode(0x7875, data).ids).toEqual(['zip.extra.malformed']);
  });

  it('EXT-6: given an empty block, when decoded, then malformed', () => {
    expect(decode(0x7875, new Uint8Array()).ids).toEqual(['zip.extra.malformed']);
  });

  it('EXT-6: given an 8-byte UID above 2^53, when decoded, then value-too-large', () => {
    expect(decode(0x7875, ux(1, le(2n ** 60n, 8), le(1, 4))).ids).toEqual(['zip.value-too-large']);
  });
});

describe('NTFS (0x000a)', () => {
  const times = (m: bigint, a: bigint, c: bigint) =>
    new Writer().u16(1).u16(24).u64(m).u64(a).u64(c).done();
  const ntfs = (...attributes: Uint8Array[]) => concat(new Uint8Array(4), ...attributes);

  it('EXT-7, EXT-11: given tag 1 with three FILETIMEs, when decoded, then UTC times with seven fraction digits', () => {
    const { decoded, ids } = decode(0x000a, ntfs(times(TICKS, TICKS + 10n ** 7n, 0n)));
    expect(decoded).toEqual({
      kind: 'ntfs',
      attributes: [{ tag: 1, byteLength: 24 }],
      modified: { ticks: String(TICKS), text: '2025-01-02 03:04:05.1234567 UTC' },
      accessed: { ticks: String(TICKS + 10n ** 7n), text: '2025-01-02 03:04:06.1234567 UTC' },
      created: { ticks: '0', text: null },
    });
    expect(ids).toEqual([]);
  });

  it('EXT-7: given another tag before tag 1, when decoded, then both are listed', () => {
    const other = new Writer().u16(9).u16(2).u16(0).done();
    const { decoded, ids } = decode(0x000a, ntfs(other, times(TICKS, TICKS, TICKS)));
    expect(decoded).toMatchObject({
      attributes: [
        { tag: 9, byteLength: 2 },
        { tag: 1, byteLength: 24 },
      ],
    });
    expect(ids).toEqual([]);
  });

  it('EXT-7: given a block under 4 bytes, when decoded, then malformed', () => {
    expect(decode(0x000a, new Uint8Array(3)).ids).toEqual(['zip.extra.malformed']);
  });

  it('EXT-7: given an attribute past the block, when decoded, then malformed and the earlier attributes stay', () => {
    const other = new Writer().u16(9).u16(0).done();
    const broken = new Writer().u16(1).u16(24).u64(TICKS).done();
    const { decoded, ids } = decode(0x000a, ntfs(other, broken));
    expect(decoded).toEqual({ kind: 'ntfs', attributes: [{ tag: 9, byteLength: 0 }] });
    expect(ids).toEqual(['zip.extra.malformed']);
  });

  it('EXT-7: given tag 1 of 16 bytes, when decoded, then malformed', () => {
    const short = new Writer().u16(1).u16(16).u64(TICKS).u64(TICKS).done();
    const { decoded, ids } = decode(0x000a, ntfs(short));
    expect(decoded).toEqual({ kind: 'ntfs', attributes: [{ tag: 1, byteLength: 16 }] });
    expect(ids).toEqual(['zip.extra.malformed']);
  });
});

describe('WinZip AES (0x9901)', () => {
  const aes = (version: number, vendor: string, strength: number, method: number) =>
    new Writer().u16(version).bytes(vendor).u8(strength).u16(method).done();

  it('EXT-8: given AE-2, 256 bits, and Deflate, when decoded, then all of them', () => {
    const { decoded, ids } = decode(0x9901, aes(2, 'AE', 3, 8));
    expect(decoded).toEqual({
      kind: 'aes',
      vendorVersion: 2,
      version: 'AE-2',
      vendorId: 'AE',
      strength: 3,
      keyBits: 256,
      method: { code: 8, name: 'Deflated' },
    });
    expect(ids).toEqual([]);
  });

  it('EXT-8: given AE-1 and 128 bits, when decoded, then AE-1 and 128', () => {
    expect(decode(0x9901, aes(1, 'AE', 1, 0)).decoded).toMatchObject({
      version: 'AE-1',
      keyBits: 128,
      method: { code: 0 },
    });
  });

  it('EXT-8: given unknown version and strength, when decoded, then unknown', () => {
    expect(decode(0x9901, aes(7, 'XY', 9, 8)).decoded).toMatchObject({
      vendorVersion: 7,
      version: 'unknown',
      vendorId: 'XY',
      strength: 9,
      keyBits: null,
    });
  });

  it('EXT-8: given more than 7 bytes, when decoded, then the rest is ignored', () => {
    const { decoded, ids } = decode(0x9901, concat(aes(2, 'AE', 2, 8), Uint8Array.of(1, 2)));
    expect(decoded).toMatchObject({ keyBits: 192 });
    expect(ids).toEqual([]);
  });

  it('EXT-8: given 6 bytes, when decoded, then malformed', () => {
    const { decoded, ids } = decode(0x9901, aes(2, 'AE', 3, 8).subarray(0, 6));
    expect(decoded).toBeUndefined();
    expect(ids).toEqual(['zip.extra.malformed']);
  });
});

describe('Android ZIP alignment (0xd935)', () => {
  const align = (alignment: number, padding: number) =>
    concat(new Writer().u16(alignment).done(), new Uint8Array(padding));

  it('EXT-9: given an aligned local header, when decoded, then alignment, padding, and aligned', () => {
    const { decoded, ids } = decode(0xd935, align(4, 3), { header: 'local', dataOffset: 100 });
    expect(decoded).toEqual({ kind: 'alignment', alignment: 4, paddingBytes: 3, aligned: true });
    expect(ids).toEqual([]);
  });

  it('EXT-9: given data at an offset that is not a multiple, when decoded, then not aligned', () => {
    expect(
      decode(0xd935, align(4096, 0), { header: 'local', dataOffset: 102 }).decoded,
    ).toMatchObject({ aligned: false });
  });

  it('EXT-9: given alignment 0, when decoded, then not checked', () => {
    expect(decode(0xd935, align(0, 0), { header: 'local', dataOffset: 102 }).decoded).toMatchObject(
      { aligned: null },
    );
  });

  it('EXT-9: given a central header, when decoded, then not checked', () => {
    expect(decode(0xd935, align(4, 0), CENTRAL).decoded).toMatchObject({ aligned: null });
  });

  it('EXT-9: given 1 byte, when decoded, then malformed', () => {
    expect(decode(0xd935, Uint8Array.of(4)).ids).toEqual(['zip.extra.malformed']);
  });
});

describe('other blocks', () => {
  it('EXT-3: given an ID with no decoder, when decoded, then nothing and no finding', () => {
    const { decoded, ids } = decode(0x1234, Uint8Array.of(1, 2, 3));
    expect(decoded).toBeUndefined();
    expect(ids).toEqual([]);
  });
});

describe('zero padding', () => {
  const split = (bytes: Uint8Array, local: boolean) => {
    const findings = new FindingList();
    const blocks = splitExtra(bytes, 0, findings, 0, local);
    return { blocks: blocks.map((b) => [b.id, b.offset, b.data.length]), findings: findings.list };
  };

  it('EXT-10: given a block and 3 zero bytes in a local header, when split, then a Zero padding block and no finding', () => {
    const r = split(concat(extraBlock(0x5455, ut(1, T)), new Uint8Array(3)), true);
    expect(r.blocks).toEqual([
      [0x5455, 0, 5],
      [null, 9, 3],
    ]);
    expect(r.findings).toEqual([]);
  });

  it('EXT-10: given only zero bytes in a local header, when split, then one Zero padding block', () => {
    expect(split(new Uint8Array(6), true)).toEqual({ blocks: [[null, 0, 6]], findings: [] });
  });

  it('EXT-10: given zero bytes in a central header, when split, then still malformed', () => {
    expect(split(new Uint8Array(2), false).findings.map((f) => f.id)).toEqual([
      'zip.extra.malformed',
    ]);
  });

  it('EXT-10: given zero bytes followed by others in a local header, when split, then not padding', () => {
    const r = split(Uint8Array.of(0, 0, 0, 0, 1, 0), true);
    expect(r.blocks).toEqual([
      [0, 0, 0],
      [null, 4, 2],
    ]);
    expect(r.findings.map((f) => f.id)).toEqual(['zip.extra.malformed']);
  });
});

describe('archives from common tools', () => {
  const analyze = (bytes: Uint8Array) => analyzeZip(bytesSource(bytes));
  const decodedOf = (blocks: readonly { decoded?: unknown }[] | undefined) =>
    (blocks ?? []).map((b) => b.decoded);

  it('REQ-ZIP-010: given the blocks Info-ZIP zip writes, when analyzed, then the time in UTC and the owner', async () => {
    const owner = new Writer().u8(1).u8(4).u32(501).u8(4).u32(20).done();
    const z = buildZip([
      {
        name: 'a.txt',
        content: 'hello',
        localExtra: concat(extraBlock(0x5455, ut(3, T, T + 3600)), extraBlock(0x7875, owner)),
        centralExtra: concat(extraBlock(0x5455, ut(3, T)), extraBlock(0x7875, owner)),
      },
    ]);
    const r = await analyze(z.bytes);
    expect(r.findings).toEqual([]);
    expect(decodedOf(r.entries[0]?.central.extra)).toEqual([
      { kind: 'timestamp', flags: 3, modified: { seconds: T, text: TEXT } },
      { kind: 'unix-owner', version: 1, uid: 501, gid: 20 },
    ]);
    expect(r.entries[0]?.local?.extra[0]?.decoded).toMatchObject({
      accessed: { seconds: T + 3600 },
    });
  });

  it('REQ-ZIP-010: given a WinZip AES entry, when analyzed, then the strength and the real method', async () => {
    const aes = extraBlock(0x9901, new Writer().u16(2).bytes('AE').u8(3).u16(8).done());
    const z = buildZip([
      {
        name: 'secret.txt',
        content: 'xxxxxxxx',
        method: 99,
        flags: 1,
        centralExtra: aes,
        localExtra: aes,
      },
    ]);
    const r = await analyze(z.bytes);
    expect(r.findings).toEqual([]);
    expect(r.entries[0]?.central.extra[0]?.decoded).toMatchObject({
      version: 'AE-2',
      keyBits: 256,
      method: { code: 8, name: 'Deflated' },
    });
  });

  it('REQ-ZIP-010: given an entry aligned by apksigner, when analyzed, then the local block says aligned', async () => {
    // 30 + 11 (name) + 4 + 2 + 1 (padding) = 48, a multiple of 4.
    const z = buildZip([
      {
        name: 'classes.dex',
        content: 'dex',
        localExtra: extraBlock(0xd935, Uint8Array.of(4, 0, 0)),
      },
    ]);
    const r = await analyze(z.bytes);
    expect(r.findings).toEqual([]);
    expect(r.entries[0]?.data?.offset).toBe(48);
    expect(r.entries[0]?.local?.extra[0]?.decoded).toEqual({
      kind: 'alignment',
      alignment: 4,
      paddingBytes: 1,
      aligned: true,
    });
  });

  it('REQ-ZIP-010: given an entry padded by older zipalign, when analyzed, then Zero padding and no finding', async () => {
    const z = buildZip([{ name: 'res.png', content: 'png', localExtra: new Uint8Array(3) }]);
    const r = await analyze(z.bytes);
    expect(r.findings).toEqual([]);
    expect(r.entries[0]?.local?.extra.map((b) => [b.id, b.name, b.byteLength])).toEqual([
      [null, 'Zero padding', 3],
    ]);
  });
});

describe('review fixes', () => {
  it('EXT-6: given a good UID and a GID of 9 bytes, when decoded, then malformed and the UID stays', () => {
    const data = new Writer().u8(1).u8(4).u32(501).u8(9).bytes(new Uint8Array(9)).done();
    const { decoded, ids } = decode(0x7875, data);
    expect(decoded).toEqual({ kind: 'unix-owner', version: 1, uid: 501 });
    expect(ids).toEqual(['zip.extra.malformed']);
  });

  it('EXT-10: given a zero padding block, when kept, then it is marked as padding', async () => {
    const z = buildZip([{ name: 'a', localExtra: new Uint8Array(3) }]);
    const r = await analyzeZip(bytesSource(z.bytes));
    expect(r.entries[0]?.local?.extra[0]).toMatchObject({ id: null, padding: true });
  });

  it('EXT-1, EXT-10: given 65 531 zero bytes then one other byte in a local header, when split, then it finishes quickly', () => {
    const bytes = concat(new Uint8Array(65_528), Uint8Array.of(0, 0, 0, 1));
    const started = performance.now();
    for (let i = 0; i < 5; i++) splitExtra(bytes, 0, new FindingList(), 0, true);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

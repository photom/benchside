import { describe, expect, it } from 'vitest';
import { analyzeZip } from './analyze.ts';
import { crc32 } from './crc32.ts';
import { bytesSource } from './source.ts';
import { buildZip, concat, extraBlock, type FixtureEntry, Writer } from './test/build-zip.ts';
import { PYTHON_ZIPFILE } from './test/python-zipfile.ts';
import type { ZipReport } from './types.ts';

const ch = (code: number) => String.fromCharCode(code);
const utf8 = (s: string) => new TextEncoder().encode(s);
const analyze = (bytes: Uint8Array, limits = {}) => analyzeZip(bytesSource(bytes), { limits });
const rd = (r: ZipReport) => r.findings.filter((f) => f.id.startsWith('rd.'));
const two = (): FixtureEntry[] => [
  { name: 'a.txt', content: 'hello' },
  { name: 'b.txt', content: 'world' },
];

/** A whole local file header for `name`, with no data. */
const localHeader = (name: string) =>
  new Writer()
    .u32(0x04034b50)
    .u16(20)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u16(name.length)
    .u16(0)
    .bytes(name)
    .done();

describe('reader disagreement', () => {
  it('REQ-ZIP-007: given an archive from a common tool, when analyzed, then no disagreement findings', async () => {
    expect(rd(await analyze(PYTHON_ZIPFILE))).toEqual([]);
  });

  it('RD-1, REP-11: given a second EOCD inside the comment, when analyzed, then both candidates and the one used', async () => {
    const fake = concat(Uint8Array.of(0x50, 0x4b, 5, 6), new Uint8Array(18), utf8('x'));
    const z = buildZip(two(), { comment: fake });
    const r = await analyze(z.bytes);
    const fakeOffset = z.eocdOffset + 22;
    expect(r.end?.eocdCandidates).toEqual([fakeOffset, z.eocdOffset]);
    expect(r.end?.eocd.offset).toBe(z.eocdOffset);
    expect(rd(r)).toMatchObject([{ id: 'rd.eocd-candidates', category: 'disagreement' }]);
    expect(rd(r)[0]?.message).toContain(String(fakeOffset));
    expect(rd(r)[0]?.message).toContain(String(z.eocdOffset));
  });

  it('RD-1: given one EOCD, when analyzed, then one candidate and no finding', async () => {
    const z = buildZip(two());
    const r = await analyze(z.bytes);
    expect(r.end?.eocdCandidates).toEqual([z.eocdOffset]);
    expect(rd(r)).toEqual([]);
  });

  it('RD-2: given a different local name, when analyzed, then local.mismatch is a disagreement naming both names', async () => {
    const r = await analyze(
      buildZip([{ name: 'a.txt', localName: 'evil.txt', content: 'x' }]).bytes,
    );
    const f = r.findings.find((x) => x.id === 'zip.local.mismatch');
    expect(f?.category).toBe('disagreement');
    expect(f?.message).toContain('"a.txt"');
    expect(f?.message).toContain('"evil.txt"');
  });

  it('RD-2: given a different local method, when analyzed, then the message gives both values', async () => {
    const r = await analyze(buildZip([{ name: 'a', content: 'x', local: { method: 8 } }]).bytes);
    expect(r.findings.find((x) => x.id === 'zip.local.mismatch')?.message).toMatch(/method.*0.*8/);
  });

  it('RD-3: given UTF-8 bytes without flag bit 11, when analyzed, then name-encoding gives both readings', async () => {
    const name = `caf${ch(0xe9)}.txt`;
    const r = await analyze(buildZip([{ name: utf8(name) }]).bytes);
    expect(rd(r)).toMatchObject([{ id: 'rd.name-encoding', entry: 0 }]);
    expect(rd(r)[0]?.message).toContain(name);
    expect(rd(r)[0]?.message).toContain(r.entries[0]?.name.text);
  });

  it('RD-3: given a matching Unicode Path that differs from the Code Page 437 name, when analyzed, then name-encoding', async () => {
    const raw = Uint8Array.of(0x41, 0x2e, 0x74); // "A.t"
    const up = new Writer().u8(1).u32(crc32(raw)).bytes('B.t').done();
    const r = await analyze(buildZip([{ name: raw, centralExtra: extraBlock(0x7075, up) }]).bytes);
    expect(rd(r).map((f) => f.id)).toEqual(['rd.name-encoding']);
  });

  it('RD-3: given ASCII names, when analyzed, then no name-encoding', async () => {
    expect(rd(await analyze(buildZip(two()).bytes))).toEqual([]);
  });

  it('RD-4: given a local header in a gap, when analyzed, then hidden-header with its offset and name', async () => {
    const hidden = localHeader('evil.exe');
    const z = buildZip(two(), { afterCentral: hidden });
    const r = await analyze(z.bytes);
    const offset = z.cdOffset + z.cdByteLength;
    expect(rd(r)).toMatchObject([{ id: 'rd.hidden-header', offset }]);
    expect(rd(r)[0]?.message).toContain('evil.exe');
  });

  it('RD-4: given a signature without a whole header after it, when analyzed, then nothing', async () => {
    const z = buildZip(two(), { afterCentral: Uint8Array.of(0x50, 0x4b, 3, 4, 1, 2) });
    expect(rd(await analyze(z.bytes))).toEqual([]);
  });

  it('RD-4: given a hidden header in prepended data, when analyzed, then hidden-header', async () => {
    const z = buildZip(two(), { prepend: concat(new Uint8Array(10), localHeader('stub')) });
    expect(rd(await analyze(z.bytes)).map((f) => f.id)).toEqual(['rd.hidden-header']);
  });

  it('RD-5: given more gap bytes than the scan limit, when analyzed, then scan-limit', async () => {
    const z = buildZip(two(), { afterCentral: new Uint8Array(100) });
    const r = await analyze(z.bytes, { maxScanBytes: 50 });
    expect(rd(r).map((f) => f.id)).toEqual(['rd.scan-limit']);
  });

  it('RD-1: given a stored archive as the last entry, when analyzed, then its EOCD inside the file data is not a candidate', async () => {
    const z = buildZip([
      { name: 'a.txt', content: 'x' },
      { name: 'in.zip', content: buildZip([{ name: 'i' }]).bytes },
    ]);
    const r = await analyze(z.bytes);
    expect(r.end?.eocdCandidates).toHaveLength(2);
    expect(rd(r)).toEqual([]);
  });

  it('RD-2: given UTF-8 set only in the local flags, when analyzed, then the local name is read as UTF-8', async () => {
    const name = `caf${ch(0xe9)}`;
    const r = await analyze(buildZip([{ name: utf8(name), local: { flags: 0x0800 } }]).bytes);
    expect(r.findings.find((x) => x.id === 'zip.local.mismatch')?.message).toContain(
      `local "${name}"`,
    );
  });
});

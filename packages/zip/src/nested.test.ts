import { describe, expect, it } from 'vitest';
import { analyzeZip } from './analyze.ts';
import { crc32 } from './crc32.ts';
import { inflateRaw } from './inflate.ts';
import { openNested } from './nested.ts';
import { bytesSource } from './source.ts';
import { buildZip, deflateRaw, type FixtureEntry, patch } from './test/build-zip.ts';
import { PYTHON_ZIPFILE } from './test/python-zipfile.ts';

const inner = () => buildZip([{ name: 'inner.txt', content: 'inside' }]).bytes;
const MiB = 1024 * 1024;
// Bytes that deflate barely compresses.
const noise = (n: number) => {
  let x = 1;
  return Uint8Array.from({ length: n }, () => {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    return x >>> 16;
  });
};

async function outer(entries: FixtureEntry[], path: number[] = []) {
  const z = buildZip(entries);
  const source = bytesSource(z.bytes);
  return { z, source, report: await analyzeZip(source, { path }) };
}

async function deflated(name: string, content: Uint8Array): Promise<FixtureEntry> {
  return { name, content, method: 8, compressed: await deflateRaw(content) };
}

describe('inflate', () => {
  it('NEST-3: given deflated bytes, when inflated within the limit, then gives the content', async () => {
    const content = new TextEncoder().encode('hello hello hello');
    expect(await inflateRaw(await deflateRaw(content), 100)).toEqual({
      kind: 'ok',
      bytes: content,
    });
  });

  it('NEST-3: given output beyond the limit, when inflated, then exceeded', async () => {
    expect(await inflateRaw(await deflateRaw(new Uint8Array(100_000)), 1000)).toEqual({
      kind: 'exceeded',
    });
  });

  it('NEST-3: given bytes that are not deflate, when inflated, then error', async () => {
    expect(await inflateRaw(Uint8Array.of(0xff, 0xff, 0xff, 0xff), 100)).toEqual({ kind: 'error' });
  });
});

describe('opening nested archives', () => {
  it('NEST-5: given a stored ZIP entry, when opened, then reports the inner archive with its path', async () => {
    const { source, report } = await outer([
      { name: 'a.txt' },
      { name: 'in.zip', content: inner() },
    ]);
    const opened = await openNested(source, report, 1);
    expect(opened.kind).toBe('report');
    if (opened.kind !== 'report') return;
    expect(opened.report.path).toEqual([1]);
    expect(opened.report.entries.map((e) => e.name.text)).toEqual(['inner.txt']);
    expect(opened.report.findings).toEqual([]);
  });

  it('REQ-ZIP-004: given a deflated ZIP inside a Python zipfile archive, when opened, then shows its entry with no findings', async () => {
    const source = bytesSource(PYTHON_ZIPFILE);
    const opened = await openNested(source, await analyzeZip(source), 3);
    expect(opened.kind === 'report' && opened.report.entries.map((e) => e.name.text)).toEqual([
      'inner.txt',
    ]);
    expect(opened.kind === 'report' && opened.report.findings).toEqual([]);
  });

  it('NEST-3, NEST-5: given a deflated ZIP entry, when opened, then reports the inner archive', async () => {
    const { source, report } = await outer([await deflated('in.zip', inner())]);
    const opened = await openNested(source, report, 0);
    expect(opened.kind === 'report' && opened.report.entries[0]?.name.text).toBe('inner.txt');
  });

  it('NEST-5: given a nested archive, when its entry is opened, then the path grows', async () => {
    const middle = buildZip([{ name: 'in.zip', content: inner() }]).bytes;
    const { source, report } = await outer([{ name: 'mid.zip', content: middle }]);
    const first = await openNested(source, report, 0);
    if (first.kind !== 'report') throw new Error('not opened');
    const second = await openNested(first.source, first.report, 0);
    expect(second.kind === 'report' && second.report.path).toEqual([0, 0]);
  });

  it('NEST-5: given an entry that is not a ZIP, when opened, then the report says eocd.missing', async () => {
    const { source, report } = await outer([{ name: 'a.txt', content: 'plain text' }]);
    const opened = await openNested(source, report, 0);
    expect(opened.kind === 'report' && opened.report.findings.map((f) => f.id)).toEqual([
      'zip.eocd.missing',
    ]);
  });

  it('NEST-2: given a directory, when opened, then refused: directory', async () => {
    const { source, report } = await outer([{ name: 'dir/' }]);
    expect(await openNested(source, report, 0)).toEqual({ kind: 'refused', reason: 'directory' });
  });

  it('NEST-2: given an archive 8 levels down, when one of its entries is opened, then refused: too-deep', async () => {
    const { source, report } = await outer(
      [{ name: 'in.zip', content: inner() }],
      [0, 0, 0, 0, 0, 0, 0, 0],
    );
    expect(await openNested(source, report, 0)).toEqual({ kind: 'refused', reason: 'too-deep' });
  });

  it('NEST-2: given an archive 7 levels down, when one of its entries is opened, then it opens', async () => {
    const { source, report } = await outer(
      [{ name: 'in.zip', content: inner() }],
      [0, 0, 0, 0, 0, 0, 0],
    );
    expect((await openNested(source, report, 0)).kind).toBe('report');
  });

  it('NEST-2: given an encrypted entry, when opened, then refused: encrypted', async () => {
    const { source, report } = await outer([{ name: 'in.zip', content: inner(), flags: 1 }]);
    expect(await openNested(source, report, 0)).toEqual({ kind: 'refused', reason: 'encrypted' });
  });

  it('NEST-2: given method 12, when opened, then refused: unsupported-method', async () => {
    const { source, report } = await outer([{ name: 'in.zip', content: inner(), method: 12 }]);
    expect(await openNested(source, report, 0)).toEqual({
      kind: 'refused',
      reason: 'unsupported-method',
    });
  });

  it('NEST-2: given a missing local header, when opened, then refused: unreadable', async () => {
    const z = buildZip([{ name: 'in.zip', content: inner() }]);
    patch(z.bytes, 0, 0, 4);
    const source = bytesSource(z.bytes);
    expect(await openNested(source, await analyzeZip(source), 0)).toEqual({
      kind: 'refused',
      reason: 'unreadable',
    });
  });

  it('NEST-2: given truncated file data, when opened, then refused: unreadable', async () => {
    const z = buildZip([{ name: 'in.zip', content: inner() }]);
    patch(z.bytes, (z.central[0] as number) + 20, 0x00100000, 4);
    const source = bytesSource(z.bytes);
    expect(await openNested(source, await analyzeZip(source), 0)).toEqual({
      kind: 'refused',
      reason: 'unreadable',
    });
  });

  it('NEST-2, PAR-2: given an uncompressed size above maxNestedBytes, when opened, then refused: too-large', async () => {
    const z = buildZip([await deflated('in.zip', inner())]);
    patch(z.bytes, (z.central[0] as number) + 24, 2 * MiB, 4);
    const source = bytesSource(z.bytes);
    const report = await analyzeZip(source, { parameters: { maxNestedBytes: MiB } });
    expect(await openNested(source, report, 0)).toEqual({
      kind: 'refused',
      reason: 'too-large',
    });
  });

  it('NEST-2, PAR-2: given a stored entry larger than maxNestedBytes, when opened, then refused: too-large', async () => {
    const z = buildZip([{ name: 'in.zip', content: noise(2 * MiB) }]);
    patch(z.bytes, (z.central[0] as number) + 24, 1, 4);
    const source = bytesSource(z.bytes);
    const report = await analyzeZip(source, { parameters: { maxNestedBytes: MiB } });
    expect(await openNested(source, report, 0)).toEqual({
      kind: 'refused',
      reason: 'too-large',
    });
  });

  it('NEST-2, PAR-2: given a deflated entry whose compressed size is above maxNestedBytes, when opened, then refused: too-large', async () => {
    const z = buildZip([await deflated('in.zip', noise(2 * MiB))]);
    patch(z.bytes, (z.central[0] as number) + 24, 1, 4);
    const source = bytesSource(z.bytes);
    const report = await analyzeZip(source, { parameters: { maxNestedBytes: MiB } });
    expect(await openNested(source, report, 0)).toEqual({
      kind: 'refused',
      reason: 'too-large',
    });
  });

  it('NEST-3: given inflated output beyond the uncompressed size, when opened, then refused: size-exceeded', async () => {
    const z = buildZip([await deflated('in.zip', inner())]);
    patch(z.bytes, (z.central[0] as number) + 24, 10, 4);
    const source = bytesSource(z.bytes);
    expect(await openNested(source, await analyzeZip(source), 0)).toEqual({
      kind: 'refused',
      reason: 'size-exceeded',
    });
  });

  it('NEST-3: given data that is not deflate, when opened, then refused: inflate-failed', async () => {
    const { source, report } = await outer([
      { name: 'in.zip', content: inner(), method: 8, compressed: Uint8Array.of(0xff, 0xff, 0xff) },
    ]);
    expect(await openNested(source, report, 0)).toEqual({
      kind: 'refused',
      reason: 'inflate-failed',
    });
  });

  it('NEST-4: given a CRC-32 that differs, when opened, then nested.crc-mismatch in the nested report', async () => {
    const z = buildZip([{ name: 'in.zip', content: inner() }]);
    patch(z.bytes, (z.central[0] as number) + 16, crc32(inner()) ^ 1, 4);
    const source = bytesSource(z.bytes);
    const opened = await openNested(source, await analyzeZip(source), 0);
    expect(opened.kind === 'report' && opened.report.findings.map((f) => f.id)).toEqual([
      'nested.crc-mismatch',
    ]);
    // The entry index would point into the nested archive, where it means another entry.
    expect(opened.kind === 'report' && opened.report.findings[0]).not.toHaveProperty('entry');
  });

  it('NEST-4: given content shorter than the uncompressed size, when opened, then nested.size-mismatch', async () => {
    const z = buildZip([await deflated('in.zip', inner())]);
    patch(z.bytes, (z.central[0] as number) + 24, inner().length + 5, 4);
    const source = bytesSource(z.bytes);
    const opened = await openNested(source, await analyzeZip(source), 0);
    expect(opened.kind === 'report' && opened.report.findings.map((f) => f.id)).toEqual([
      'nested.size-mismatch',
    ]);
  });

  it('PAR-1: given maxNestingDepth 1, when an archive inside a nested archive is opened, then refused: too-deep', async () => {
    const middle = buildZip([{ name: 'in.zip', content: inner() }]).bytes;
    const z = buildZip([{ name: 'mid.zip', content: middle }]);
    const source = bytesSource(z.bytes);
    const report = await analyzeZip(source, { parameters: { maxNestingDepth: 1 } });
    const first = await openNested(source, report, 0);
    if (first.kind !== 'report') throw new Error('not opened');
    expect(await openNested(first.source, first.report, 0)).toEqual({
      kind: 'refused',
      reason: 'too-deep',
    });
  });

  it('PAR-13: given parameters, when a nested archive is opened, then it uses the same values', async () => {
    const z = buildZip([{ name: 'in.zip', content: inner() }]);
    const source = bytesSource(z.bytes);
    const report = await analyzeZip(source, { parameters: { ratioThreshold: 500 } });
    const opened = await openNested(source, report, 0);
    expect(opened.kind === 'report' && opened.report.parameters).toEqual(report.parameters);
  });
});

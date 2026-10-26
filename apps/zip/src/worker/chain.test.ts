import { describe, expect, it } from 'vitest';
import { buildZip } from '../../../../packages/zip/src/test/build-zip.ts';
import { ArchiveChain } from './chain.ts';

const inner = (name: string) => buildZip([{ name }]).bytes;
const file = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>]);

describe('archive chain', () => {
  it('NEST-5: given a file, when an entry and then its entry are opened, then each report has its path', async () => {
    const middle = buildZip([{ name: 'deep.zip', content: inner('deep.txt') }]).bytes;
    const chain = new ArchiveChain();
    await chain.analyze(file(buildZip([{ name: 'mid.zip', content: middle }]).bytes));
    const first = await chain.open([0]);
    const second = await chain.open([0, 0]);
    expect(first.kind === 'report' && first.report.entries[0]?.name.text).toBe('deep.zip');
    expect(second.kind === 'report' && second.report.path).toEqual([0, 0]);
    expect(second.kind === 'report' && second.report.entries[0]?.name.text).toBe('deep.txt');
  });

  it('NEST-2: given a refused entry, when opened, then the reason comes back', async () => {
    const chain = new ArchiveChain();
    await chain.analyze(file(buildZip([{ name: 'dir/' }]).bytes));
    expect(await chain.open([0])).toEqual({ kind: 'refused', reason: 'directory' });
  });

  it('0007: given a sibling opened, when cached, then only the viewed chain is kept', async () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({
      name: `${i}.zip`,
      content: inner(`${i}.txt`),
    }));
    const chain = new ArchiveChain();
    await chain.analyze(file(buildZip(entries).bytes));
    await chain.open([1]);
    await chain.open([10]);
    expect(chain.cachedPaths()).toEqual(['', '10']);
  });

  it('0007: given two opens overlapping, when both finish, then only the later one is cached', async () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({
      name: `${i}.zip`,
      content: inner(`${i}.txt`),
    }));
    const chain = new ArchiveChain();
    await chain.analyze(file(buildZip(entries).bytes));
    await Promise.all([chain.open([1]), chain.open([2])]);
    expect(chain.cachedPaths()).toEqual(['', '2']);
  });

  it('0007: given a new file, when analyzed, then nested archives of the old file are dropped', async () => {
    const chain = new ArchiveChain();
    await chain.analyze(file(buildZip([{ name: 'a.zip', content: inner('x') }]).bytes));
    await chain.open([0]);
    await chain.analyze(file(buildZip([{ name: 'b.txt' }]).bytes));
    expect(chain.cachedPaths()).toEqual(['']);
  });

  it('PAR-12, PAR-13: given parameters, when analyzed and opened, then both reports carry them', async () => {
    const chain = new ArchiveChain();
    const top = await chain.analyze(
      file(buildZip([{ name: 'a.zip', content: inner('x') }]).bytes),
      {
        ratioThreshold: 300,
      },
    );
    const nested = await chain.open([0]);
    expect(top.parameters.ratioThreshold).toBe(300);
    expect(nested.kind === 'report' && nested.report.parameters.ratioThreshold).toBe(300);
  });
});

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

  describe('reading bytes', () => {
    it('HEX-3: given the top level, when a range is read, then those bytes of the file', async () => {
      const bytes = buildZip([{ name: 'a.txt', content: 'hello' }]).bytes;
      const chain = new ArchiveChain();
      await chain.analyze(file(bytes));
      expect(await chain.read([], 30, 5)).toEqual(bytes.slice(30, 35));
    });

    it('HEX-9: given a nested archive open, when its path is read, then bytes of its own content', async () => {
      const nested = inner('deep.txt');
      const chain = new ArchiveChain();
      await chain.analyze(file(buildZip([{ name: 'in.zip', content: nested }]).bytes));
      await chain.open([0]);
      expect(await chain.read([0], 0, 8)).toEqual(nested.slice(0, 8));
    });

    it('HEX-3: given a range past the end or over 512 bytes, when read, then it is cut', async () => {
      const bytes = buildZip([{ name: 'a', content: new Uint8Array(2000) }]).bytes;
      const chain = new ArchiveChain();
      await chain.analyze(file(bytes));
      expect((await chain.read([], 0, 4096)).length).toBe(512);
      expect((await chain.read([], bytes.length - 3, 512)).length).toBe(3);
      expect((await chain.read([], bytes.length + 10, 16)).length).toBe(0);
    });

    it('HEX-3: given a nested archive, when a page is read, then the bytes carry no more than the page', async () => {
      const nested = buildZip([{ name: 'big', content: new Uint8Array(100_000) }]).bytes;
      const chain = new ArchiveChain();
      await chain.analyze(file(buildZip([{ name: 'in.zip', content: nested }]).bytes));
      await chain.open([0]);
      const page = await chain.read([0], 100, 16);
      expect(page.buffer.byteLength).toBe(16);
    });

    it('0008: given a path that is not open, when read, then it fails', async () => {
      const chain = new ArchiveChain();
      await chain.analyze(file(buildZip([{ name: 'a' }]).bytes));
      await expect(chain.read([0], 0, 4)).rejects.toThrow('not open');
    });
  });
});

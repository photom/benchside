import { describe, expect, it } from 'vitest';
import { analyzeZip } from './analyze.ts';
import type { ParameterInput } from './parameters.ts';
import { bytesSource } from './source.ts';
import { buildZip, deflateRaw, type FixtureEntry, patch } from './test/build-zip.ts';
import { PYTHON_ZIPFILE } from './test/python-zipfile.ts';
import type { ZipReport } from './types.ts';

// Characters built from code points, so the source stays plain ASCII.
const ch = (code: number) => String.fromCharCode(code);
const BS = ch(0x5c); // backslash
const MiB = 1024 * 1024;
const utf8 = (s: string) => new TextEncoder().encode(s);

async function analyze(entries: FixtureEntry[], parameters: ParameterInput = {}) {
  return analyzeZip(bytesSource(buildZip(entries).bytes), { parameters });
}
const sec = (r: ZipReport) => r.findings.filter((f) => f.category === 'security');
const secIds = (r: ZipReport) => sec(r).map((f) => f.id);
const names = (...list: string[]): FixtureEntry[] => list.map((name) => ({ name }));

describe('security checks: names', () => {
  it('REQ-ZIP-006: given an archive from a common tool, when analyzed, then no security findings', async () => {
    expect(secIds(await analyzeZip(bytesSource(PYTHON_ZIPFILE)))).toEqual([]);
  });

  it('SEC-1: given ../evil.sh, when analyzed, then path-traversal naming the entry', async () => {
    const r = await analyze(names('ok.txt', '../evil.sh'));
    expect(sec(r)).toMatchObject([{ id: 'sec.path-traversal', entry: 1 }]);
    expect(sec(r)[0]?.message).toContain('../evil.sh');
  });

  it('SEC-1: given a .. component after a backslash, when analyzed, then path-traversal', async () => {
    expect(secIds(await analyze(names(`a${BS}..${BS}..${BS}b`)))).toContain('sec.path-traversal');
  });

  it('SEC-1: given a name that only contains dots, when analyzed, then no path-traversal', async () => {
    expect(secIds(await analyze(names('a..b/...txt')))).toEqual([]);
  });

  it('SEC-2: given absolute and drive-letter names, when analyzed, then absolute-path for each', async () => {
    const r = await analyze(names('/etc/passwd', 'C:/Windows/x.dll', `${BS}${BS}server${BS}share`));
    expect(
      sec(r)
        .filter((f) => f.id === 'sec.absolute-path')
        .map((f) => f.entry),
    ).toEqual([0, 1, 2]);
  });

  it('SEC-3: given a backslash, when analyzed, then backslash', async () => {
    expect(secIds(await analyze(names(`dir${BS}file.txt`)))).toEqual(['sec.backslash']);
  });

  it('SEC-4: given the same name twice, when analyzed, then one duplicate-name naming both entries', async () => {
    const r = await analyze(names('a.txt', 'b.txt', 'a.txt'));
    expect(sec(r)).toMatchObject([{ id: 'sec.duplicate-name', entry: 0 }]);
    expect(sec(r)[0]?.message).toMatch(/0.*2/);
  });

  it('SEC-5: given names differing only in case, when analyzed, then a collision on all, windows, and macos, not linux', async () => {
    const list = names('a.txt', 'A.TXT');
    for (const target of ['all', 'windows', 'macos'] as const) {
      expect(secIds(await analyze(list, { targetFileSystem: target }))).toEqual([
        'sec.name-collision',
      ]);
    }
    expect(secIds(await analyze(list, { targetFileSystem: 'linux' }))).toEqual([]);
  });

  it('SEC-5: given composed and decomposed forms of the same name, when analyzed, then a collision on macos only', async () => {
    const composed = `caf${ch(0xe9)}`;
    const decomposed = `cafe${ch(0x301)}`;
    const list: FixtureEntry[] = [
      { name: utf8(composed), flags: 0x0800 },
      { name: utf8(decomposed), flags: 0x0800 },
    ];
    expect(secIds(await analyze(list, { targetFileSystem: 'macos' }))).toEqual([
      'sec.name-collision',
    ]);
    expect(secIds(await analyze(list, { targetFileSystem: 'windows' }))).toEqual([]);
  });

  it('SEC-5: given a name with a trailing dot, when analyzed, then a collision on windows, not macos', async () => {
    const list = names('dir/a.txt', 'dir/a.txt.');
    expect(secIds(await analyze(list, { targetFileSystem: 'windows' }))).toContain(
      'sec.name-collision',
    );
    expect(secIds(await analyze(list, { targetFileSystem: 'macos' }))).toEqual([]);
  });

  it('SEC-6: given reserved names and forbidden characters, when analyzed on windows, then reserved-name for each', async () => {
    const r = await analyze(names('NUL.txt', 'a/con', 'x<y', 'trail ', 'fine.txt'), {
      targetFileSystem: 'windows',
    });
    expect(
      sec(r)
        .filter((f) => f.id === 'sec.reserved-name')
        .map((f) => f.entry),
    ).toEqual([0, 1, 2, 3]);
  });

  it('SEC-6: given a reserved name, when analyzed on linux, then nothing', async () => {
    expect(secIds(await analyze(names('NUL.txt'), { targetFileSystem: 'linux' }))).toEqual([]);
  });

  it('SEC-7: given a UNIX symbolic link, when analyzed, then symlink', async () => {
    const r = await analyze([
      { name: 'link', content: '/etc', versionMadeBy: 0x031e, external: 0o120777 * 0x10000 },
    ]);
    expect(secIds(r)).toEqual(['sec.symlink']);
  });

  it('SEC-8: given a control character, when analyzed, then control-character', async () => {
    expect(secIds(await analyze(names(`a${ch(1)}b`)))).toEqual(['sec.control-character']);
  });

  it('SEC-8b: given a right-to-left override, when analyzed, then bidi-character', async () => {
    const name = utf8(`invoice${ch(0x202e)}fdp.exe`);
    expect(secIds(await analyze([{ name, flags: 0x0800 }]))).toEqual(['sec.bidi-character']);
  });

  it('SEC-9: given a name longer than maxPathBytes, when analyzed, then long-path', async () => {
    expect(secIds(await analyze(names('abcdefghijk'), { maxPathBytes: 10 }))).toEqual([
      'sec.long-path',
    ]);
  });

  it('SEC-9: given more components than maxPathDepth, when analyzed, then long-path', async () => {
    expect(secIds(await analyze(names('a/b/c'), { maxPathDepth: 2 }))).toEqual(['sec.long-path']);
  });
});

describe('security checks: sizes and counts', () => {
  it('SEC-10, SEC-16: given 1 GiB declared from 1 MiB, when analyzed, then compression-ratio stating 1024 and 100', async () => {
    const r = await analyze([
      {
        name: 'bomb',
        content: 'x',
        central: { uncompressedSize: 1024 * MiB, compressedSize: MiB },
      },
    ]);
    const finding = sec(r).find((f) => f.id === 'sec.compression-ratio');
    expect(finding?.entry).toBe(0);
    expect(finding?.message).toContain('1024');
    expect(finding?.message).toContain('100');
  });

  it('SEC-10: given the threshold raised above 1024, when analyzed, then no compression-ratio', async () => {
    const r = await analyze(
      [
        {
          name: 'bomb',
          content: 'x',
          central: { uncompressedSize: 1024 * MiB, compressedSize: MiB },
        },
      ],
      { ratioThreshold: 2000 },
    );
    expect(secIds(r)).not.toContain('sec.compression-ratio');
  });

  it('SEC-10: given 2 MiB of zeros deflated, when analyzed, then compression-ratio', async () => {
    const zeros = new Uint8Array(2 * MiB);
    const r = await analyze([
      { name: 'zeros', content: zeros, method: 8, compressed: await deflateRaw(zeros) },
    ]);
    expect(secIds(r)).toContain('sec.compression-ratio');
  });

  it('SEC-10: given a highly compressible file below ratioMinBytes, when analyzed, then no compression-ratio', async () => {
    const zeros = new Uint8Array(100_000);
    const r = await analyze([
      { name: 'small', content: zeros, method: 8, compressed: await deflateRaw(zeros) },
    ]);
    expect(secIds(r)).toEqual([]);
  });

  it('SEC-11: given many small files that together compress far, when analyzed, then archive-ratio only', async () => {
    const part = new Uint8Array(512 * 1024);
    const compressed = await deflateRaw(part);
    const r = await analyze(
      [0, 1, 2, 3].map((i) => ({ name: `p${i}`, content: part, method: 8, compressed })),
    );
    expect(secIds(r)).toEqual(['sec.archive-ratio']);
  });

  it('SEC-12: given a total above totalBytesThreshold, when analyzed, then total-size', async () => {
    const data = new Uint8Array(2 * MiB).map((_, i) => (i * 7919) & 0xff);
    const r = await analyze([{ name: 'big', content: data }], { totalBytesThreshold: MiB });
    expect(secIds(r)).toEqual(['sec.total-size']);
  });

  it('SEC-13: given more entries than maxFiles, when analyzed, then file-count', async () => {
    expect(secIds(await analyze(names('a', 'b', 'c'), { maxFiles: 2 }))).toEqual([
      'sec.file-count',
    ]);
  });

  it('SEC-14: given two entries using one local header, when analyzed, then overlapping-entries', async () => {
    const z = buildZip([
      { name: 'a', content: 'aaaa' },
      { name: 'b', content: 'bbbb' },
    ]);
    patch(z.bytes, (z.central[1] as number) + 42, 0, 4);
    const r = await analyzeZip(bytesSource(z.bytes));
    expect(sec(r)).toMatchObject([{ id: 'sec.overlapping-entries', entry: 0 }]);
  });
});

describe('security checks: parameters', () => {
  it('PAR-10: given a check turned off, when analyzed, then that check gives nothing', async () => {
    const list = names(`dir${BS}file.txt`);
    expect(secIds(await analyze(list, { checks: { backslash: false } }))).toEqual([]);
  });

  it('PAR-12: given parameters, when analyzed, then the report carries the values used', async () => {
    const r = await analyze(names('a'), { maxFiles: 0, targetFileSystem: 'linux' });
    expect(r.parameters).toMatchObject({
      maxFiles: 1,
      targetFileSystem: 'linux',
      ratioThreshold: 100,
    });
  });

  describe('security checks: review fixes', () => {
    it('SEC-4: given 30 000 entries with one name, when analyzed, then it finishes quickly', async () => {
      const list = Array.from({ length: 30_000 }, () => ({ name: 'a' }));
      const started = Date.now();
      const r = await analyze(list, { maxFiles: 100_000 });
      expect(secIds(r).filter((id) => id === 'sec.duplicate-name')).toHaveLength(1);
      expect(Date.now() - started).toBeLessThan(5000);
    }, 20_000);

    it('SEC-14, SEC-15: given two entries sharing a local header, when analyzed, then the finding points at the first entry central header', async () => {
      const z = buildZip([
        { name: 'a', content: 'aaaa' },
        { name: 'b', content: 'bbbb' },
      ]);
      patch(z.bytes, (z.central[1] as number) + 42, 0, 4);
      const r = await analyzeZip(bytesSource(z.bytes));
      expect(sec(r)).toMatchObject([
        { id: 'sec.overlapping-entries', entry: 0, offset: z.central[0] },
      ]);
    });
  });
});

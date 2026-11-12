import { describe, expect, it } from 'vitest';
import { compareCodePoints, fromDrop, fromFolderPicker, fromPicker } from './collect.ts';

const file = (name: string, relative = '') => {
  const f = new File(['x'], name);
  if (relative) Object.defineProperty(f, 'webkitRelativePath', { value: relative });
  return f;
};

interface FakeEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FakeEntry[]) => void) => void };
}
const fileEntry = (name: string): FakeEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (ok) => ok(file(name)),
});
/** A folder whose reader returns its children two at a time, then an empty batch. */
const dirEntry = (name: string, children: FakeEntry[]): FakeEntry => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let at = 0;
    return {
      readEntries: (ok) => {
        const batch = children.slice(at, at + 2);
        at += 2;
        ok(batch);
      },
    };
  },
});
const items = (...entries: (FakeEntry | null)[]) =>
  entries.map((e) => ({
    kind: 'file',
    webkitGetAsEntry: () => e,
  })) as unknown as DataTransferItemList;

const paths = (list: { path: string; fromFolder: boolean }[]) =>
  list.map((x) => [x.path, x.fromFolder]);

describe('Input collection (INP-1, INP-11)', () => {
  it('INP-1: given picked files, when collected, then they keep the order given and are not folder files', () => {
    expect(paths(fromPicker([file('b.xml'), file('a.xml')]))).toEqual([
      ['b.xml', false],
      ['a.xml', false],
    ]);
  });

  it('INP-11: given a picked folder, when collected, then its files by relative path, starting with the folder name', () => {
    const list = fromFolderPicker([
      file('b.xml', 'r/sub/b.xml'),
      file('a.xml', 'r/z.xml'),
      file('c.xml', 'r/a.xml'),
    ]);
    expect(paths(list)).toEqual([
      ['r/a.xml', true],
      ['r/sub/b.xml', true],
      ['r/z.xml', true],
    ]);
  });

  it('INP-1, INP-11: given a drop of files and folders, when collected, then files in order, then each folder walked and sorted', async () => {
    const list = await fromDrop(
      items(
        dirEntry('r', [
          fileEntry('z.xml'),
          dirEntry('sub', [fileEntry('b.xml')]),
          fileEntry('a.xml'),
        ]),
        fileEntry('loose2.xml'),
        null,
        fileEntry('loose1.xml'),
      ),
    );
    expect(paths(list)).toEqual([
      ['loose2.xml', false],
      ['loose1.xml', false],
      ['r/a.xml', true],
      ['r/sub/b.xml', true],
      ['r/z.xml', true],
    ]);
  });

  it('INP-11: given names outside the BMP, when compared, then by code point, not by UTF-16 unit', () => {
    const astral = String.fromCodePoint(0x1f600);
    const high = String.fromCharCode(0xff5e);
    expect(astral < high).toBe(true);
    expect([astral, high].sort(compareCodePoints)).toEqual([high, astral]);
    expect(compareCodePoints('a', 'a')).toBe(0);
    expect(compareCodePoints('a', 'ab')).toBeLessThan(0);
  });
});

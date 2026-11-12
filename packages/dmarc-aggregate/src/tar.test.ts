import { describe, expect, it } from 'vitest';
import { type TarEvent, TarReader } from './tar.ts';
import { cat, paxEntry, tar, tarEntry, tarHeader } from './test/tar-writer.ts';

const dec = (b: Uint8Array) => new TextDecoder().decode(b);

interface Result {
  entries: { name: string; data: string; ended: boolean }[];
  end: 'ok' | 'malformed' | 'too-many';
}

/** Feeds `bytes` in chunks of `chunk` bytes and collects entries and how the archive ended. */
function read(bytes: Uint8Array, chunk = bytes.length || 1, maxEntries?: number): Result {
  const r = new TarReader(maxEntries === undefined ? {} : { maxEntries });
  const events: TarEvent[] = [];
  for (let at = 0; at < bytes.length; at += chunk)
    events.push(...r.push(bytes.subarray(at, at + chunk)));
  events.push(...r.end());
  const entries: Result['entries'] = [];
  let end: Result['end'] = 'ok';
  const parts: Uint8Array[] = [];
  for (const e of events) {
    const last = entries[entries.length - 1];
    if (e.type === 'entry') {
      entries.push({ name: e.name, data: '', ended: false });
      parts.length = 0;
    } else if (e.type === 'data') {
      parts.push(e.bytes.slice());
      if (last) last.data = dec(cat(...parts));
    } else if (e.type === 'entry-end') {
      if (last) last.ended = true;
    } else {
      end = e.type;
    }
  }
  return { entries, end };
}

describe('TarReader (INP-12)', () => {
  it('INP-12: given regular files, when read, then gives each name and its data in order', () => {
    const r = read(
      tar(tarEntry({ name: 'a.xml', data: '<a/>' }), tarEntry({ name: 'b.xml', data: '<b/>' })),
    );
    expect(r).toEqual({
      entries: [
        { name: 'a.xml', data: '<a/>', ended: true },
        { name: 'b.xml', data: '<b/>', ended: true },
      ],
      end: 'ok',
    });
  });

  it('INP-12: given type NUL, when read, then it is a regular file', () => {
    const r = read(tar(tarEntry({ name: 'old.xml', type: String.fromCharCode(0), data: 'x' })));
    expect(r.entries).toEqual([{ name: 'old.xml', data: 'x', ended: true }]);
  });

  it('INP-12: given a POSIX header with a prefix, when read, then the name is prefix/name', () => {
    const r = read(tar(tarEntry({ name: 'a.xml', prefix: '2026/11', data: 'x' })));
    expect(r.entries[0]?.name).toBe('2026/11/a.xml');
  });

  it('INP-12: given a GNU header, when read, then the prefix field is not used', () => {
    const r = read(tar(tarEntry({ name: 'a.xml', prefix: 'junk', gnu: true, data: 'x' })));
    expect(r.entries[0]?.name).toBe('a.xml');
  });

  it('INP-12: given a pax path record, when read, then it names the next entry only', () => {
    const r = read(
      tar(
        paxEntry({ mtime: '1', path: `long/${'d'.repeat(150)}/a.xml` }),
        tarEntry({ name: 'short.xml', data: 'x' }),
        tarEntry({ name: 'b.xml', data: 'y' }),
      ),
    );
    expect(r.entries.map((e) => e.name)).toEqual([`long/${'d'.repeat(150)}/a.xml`, 'b.xml']);
  });

  it('INP-12: given a pax path or GNU long name before a skipped entry, when read, then the next file keeps its own name', () => {
    const r = read(
      tar(
        paxEntry({ path: 'reports/' }),
        tarEntry({ name: 'dir/', type: '5' }),
        tarEntry({ name: '././@LongLink', type: 'L', data: 'link-target' }),
        tarEntry({ name: 'l', type: '2' }),
        tarEntry({ name: 'a.xml', data: 'x' }),
      ),
    );
    expect(r.entries.map((e) => e.name)).toEqual(['a.xml']);
  });

  it('INP-12: given a GNU long name, when read, then it names the next entry', () => {
    const long = `${'n'.repeat(200)}.xml`;
    const r = read(
      tar(
        tarEntry({ name: '././@LongLink', type: 'L', data: long + String.fromCharCode(0) }),
        tarEntry({ name: 'x', data: 'z' }),
      ),
    );
    expect(r.entries).toEqual([{ name: long, data: 'z', ended: true }]);
  });

  it('INP-12: given directories, links, and a global pax header, when read, then they are skipped without events', () => {
    const r = read(
      tar(
        tarEntry({ name: 'dir/', type: '5' }),
        tarEntry({ name: 'link', type: '2' }),
        tarEntry({ name: 'g', type: 'g', data: '11 a=bcdef\n' }),
        tarEntry({ name: 'dir/a.xml', data: 'x' }),
      ),
    );
    expect(r).toEqual({ entries: [{ name: 'dir/a.xml', data: 'x', ended: true }], end: 'ok' });
  });

  it('INP-12: given a base-256 size, when read, then the size is used', () => {
    const r = read(tar(tarEntry({ name: 'a.xml', data: 'hello', base256: true })));
    expect(r.entries[0]?.data).toBe('hello');
  });

  it('INP-12: given a checksum over signed bytes, when read, then it is accepted', () => {
    const name = `${String.fromCharCode(0xe9)}.xml`;
    const r = read(tar(tarEntry({ name, data: 'x', signedChecksum: true })));
    expect(r.end).toBe('ok');
    expect(r.entries).toHaveLength(1);
  });

  it('INP-12: given a UTF-8 name, when read, then it is decoded', () => {
    const r = read(
      tar(
        tarEntry({
          name: `r${String.fromCharCode(0xe9)}sum${String.fromCharCode(0xe9)}.xml`,
          data: 'x',
        }),
      ),
    );
    expect(r.entries[0]?.name).toBe(
      `r${String.fromCharCode(0xe9)}sum${String.fromCharCode(0xe9)}.xml`,
    );
  });

  it('INP-12: given a header whose checksum does not match, when read, then malformed after the entries before it', () => {
    const r = read(
      tar(
        tarEntry({ name: 'a.xml', data: 'x' }),
        tarEntry({ name: 'b.xml', data: 'y', checksum: 1 }),
      ),
    );
    expect(r).toEqual({ entries: [{ name: 'a.xml', data: 'x', ended: true }], end: 'malformed' });
  });

  it('INP-12: given data that ends early, when read, then malformed and the entry does not end', () => {
    const r = read(tarEntry({ name: 'a.xml', data: 'x'.repeat(1000) }).subarray(0, 512 + 600));
    expect(r.end).toBe('malformed');
    expect(r.entries).toEqual([{ name: 'a.xml', data: 'x'.repeat(600), ended: false }]);
  });

  it('INP-12: given padding missing after the last entry, when read, then the entry ends and ok', () => {
    const r = read(tarEntry({ name: 'a.xml', data: 'abc' }).subarray(0, 515));
    expect(r).toEqual({ entries: [{ name: 'a.xml', data: 'abc', ended: true }], end: 'ok' });
  });

  it('INP-12: given a header cut short at the end, when read, then malformed', () => {
    const r = read(
      cat(tarEntry({ name: 'a.xml', data: 'x' }), tarHeader({ name: 'b' }, 0).subarray(0, 100)),
    );
    expect(r.end).toBe('malformed');
    expect(r.entries).toHaveLength(1);
  });

  it('INP-12: given the end of the data after an entry, without zero blocks, when read, then ok', () => {
    expect(read(tarEntry({ name: 'a.xml', data: 'x' })).end).toBe('ok');
  });

  it('INP-12: given two zero blocks, when read, then the bytes after them are ignored', () => {
    const r = read(cat(tar(tarEntry({ name: 'a.xml', data: 'x' })), Uint8Array.of(1, 2, 3)));
    expect(r).toEqual({ entries: [{ name: 'a.xml', data: 'x', ended: true }], end: 'ok' });
  });

  it('INP-12: given a lone zero block followed by a header, when read, then reading goes on', () => {
    const r = read(
      cat(
        tarEntry({ name: 'a', data: 'x' }),
        new Uint8Array(512),
        tar(tarEntry({ name: 'b', data: 'y' })),
      ),
    );
    expect(r.entries.map((e) => e.name)).toEqual(['a', 'b']);
  });

  it('INP-12: given a pax header over 1 MiB, when read, then malformed', () => {
    const r = read(
      tar(
        tarEntry({ name: 'p', type: 'x', data: 'x'.repeat(1024 * 1024 + 1) }),
        tarEntry({ name: 'a' }),
      ),
    );
    expect(r).toEqual({ entries: [], end: 'malformed' });
  });

  it('INP-12: given a negative base-256 size, when read, then malformed', () => {
    const h = tarHeader({ name: 'a.xml', base256: true }, 0);
    h[124] = 0xc0; // sign bit set, rest zero: negative, not size 0
    let sum = 0;
    h.fill(32, 148, 156);
    for (const b of h) sum += b;
    h.set(
      new TextEncoder().encode(`${sum.toString(8).padStart(6, '0')}${String.fromCharCode(0)} `),
      148,
    );
    expect(read(cat(h, new Uint8Array(1024))).end).toBe('malformed');
  });

  it('INP-12: given more file entries than the limit, when read, then too-many after the limit and later entries are not read', () => {
    const entries = Array.from({ length: 5 }, (_, i) => tarEntry({ name: `${i}.xml`, data: 'x' }));
    const r = read(tar(tarEntry({ name: 'd/', type: '5' }), ...entries), undefined, 3);
    expect(r.entries.map((e) => e.name)).toEqual(['0.xml', '1.xml', '2.xml']);
    expect(r.end).toBe('too-many');
  });

  it('INP-12: given the archive pushed one byte at a time, when read, then the result is the same', () => {
    const bytes = tar(
      paxEntry({ path: 'p/a.xml' }),
      tarEntry({ name: 'x', data: 'a'.repeat(700) }),
      tarEntry({ name: 'b.xml', data: 'bb' }),
    );
    expect(read(bytes, 1)).toEqual(read(bytes));
  });

  it('INP-12: given mutated archives, when read, then it never throws and always ends', () => {
    const base = tar(
      paxEntry({ path: 'p/a.xml' }),
      tarEntry({ name: 'x', data: 'a'.repeat(700) }),
      tarEntry({ name: 'b', data: 'bb' }),
    );
    let seed = 5;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let n = 0; n < 300; n++) {
      const bytes = base.slice(0, rand() % (base.length + 1));
      for (let k = 0; k < 4; k++) if (bytes.length) bytes[rand() % bytes.length] = rand() & 255;
      expect(() => read(bytes, 1 + (rand() % 700))).not.toThrow();
    }
  });
});

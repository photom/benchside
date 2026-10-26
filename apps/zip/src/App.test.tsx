import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { buildZip, type FixtureEntry, patch } from '../../../packages/zip/src/test/build-zip.ts';
import { App } from './App.tsx';
import { ArchiveChain } from './worker/chain.ts';
import type { ZipHost } from './worker/host.ts';

let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

function mount(host: ZipHost = chainHost()) {
  root = document.createElement('div');
  document.body.append(root);
  act(() => render(<App host={host} />, root));
  return root;
}

function chainHost(): ZipHost {
  const chain = new ArchiveChain();
  return { analyze: (f, p) => chain.analyze(f, p), open: (p) => chain.open(p) };
}

const MiB = 1024 * 1024;
const bomb = (): FixtureEntry[] => [
  { name: 'bomb', content: 'x', central: { uncompressedSize: 1024 * MiB, compressedSize: MiB } },
];
const option = (label: string) =>
  [...section('Options').querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement;
async function change(input: HTMLInputElement | HTMLSelectElement, value: string | boolean) {
  await act(async () => {
    if (typeof value === 'boolean') (input as HTMLInputElement).checked = value;
    else input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
  await settle();
}

async function choose(bytes: Uint8Array, name = 'outer.zip') {
  const input = root.querySelector('input[type=file]') as HTMLInputElement;
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

const section = (label: string) => root.querySelector(`[aria-label="${label}"]`) as HTMLElement;
const rows = (label: string) =>
  [...section(label).querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent),
  );
const button = (scope: HTMLElement, text: string) => {
  const found = [...scope.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
};
async function click(element: HTMLElement) {
  await act(async () => element.click());
  await settle();
}

const simple = (): FixtureEntry[] => [
  { name: 'a.txt', content: 'hello' },
  { name: 'dir/', versionMadeBy: 0x031e },
];

describe('ZIP app', () => {
  it('REQ-ZIP-002: given an archive, when chosen, then the summary and entries show its contents', async () => {
    mount();
    await choose(buildZip(simple()).bytes);
    expect(section('Summary').textContent).toContain('Entries2');
    expect(rows('Entries')).toEqual([
      ['0', 'a.txt', 'Stored', '5', '5', '3610a686', '2025-01-01 12:00:00', '0 (0x0)', ''],
      [
        '1',
        'dir/',
        'Stored',
        '0',
        '0',
        '00000000',
        '2025-01-01 12:00:00',
        '40 (0x28)',
        'directory',
      ],
    ]);
  });

  it('REQ-ZIP-002: given a name mismatch, when the entry is selected, then the detail marks the field and the finding cites APPNOTE', async () => {
    mount();
    await choose(buildZip([{ name: 'a.txt', localName: 'b.txt', content: 'x' }]).bytes);
    await click(button(section('Entries'), 'a.txt'));
    const nameRow = [...section('Entry detail').querySelectorAll('tr')].find(
      (tr) => tr.querySelector('th')?.textContent === 'File name',
    );
    expect(nameRow?.textContent).toContain('a.txt');
    expect(nameRow?.textContent).toContain('b.txt');
    expect(nameRow?.textContent).toContain('differs');
    expect(section('Findings').textContent).toContain('APPNOTE 4.3.2');
  });

  it('REQ-ZIP-002: given an archive, when analyzed, then the byte map lists every region', async () => {
    mount();
    const z = buildZip(simple());
    await choose(z.bytes);
    expect(rows('Byte map').map((r) => r[2])).toEqual([
      'Local header',
      'File data',
      'Local header',
      'Central header',
      'Central header',
      'End of central directory',
    ]);
  });

  it('REQ-ZIP-002: given a name that looks like markup, when shown, then it is text', async () => {
    mount();
    await choose(buildZip([{ name: '<b>x</b>' }]).bytes);
    expect(section('Entries').querySelector('b')).toBeNull();
    expect(section('Entries').textContent).toContain('<b>x</b>');
  });

  it('REQ-ZIP-004: given a nested archive, when opened, then its entries show with the path, and going back shows the outer archive', async () => {
    mount();
    const inner = buildZip([{ name: 'inner.txt', content: 'in' }]).bytes;
    await choose(buildZip([{ name: 'a.txt' }, { name: 'in.zip', content: inner }]).bytes);
    expect(rows('Entries')[1]?.[8]).toBe('archive?');
    await click(button(section('Entries'), 'in.zip'));
    await click(button(section('Entry detail'), 'Open as archive'));
    expect(section('Archive path').textContent).toBe('outer.zip › in.zip');
    expect(rows('Entries').map((r) => r[1])).toEqual(['inner.txt']);
    await click(button(section('Archive path'), 'outer.zip'));
    expect(rows('Entries').map((r) => r[1])).toEqual(['a.txt', 'in.zip']);
  });

  it('NEST-2: given an encrypted entry, when opened, then the reason is shown', async () => {
    mount();
    await choose(buildZip([{ name: 'in.zip', content: 'x', flags: 1 }]).bytes);
    await click(button(section('Entries'), 'in.zip'));
    await click(button(section('Entry detail'), 'Open as archive'));
    expect(section('Entry detail').querySelector('[role=status]')?.textContent).toContain(
      'encrypted',
    );
  });

  it('REQ-ZIP-005: given 501 entries, when shown, then 500 rows and a button for the rest', async () => {
    mount();
    await choose(buildZip(Array.from({ length: 501 }, (_, i) => ({ name: `f${i}` }))).bytes);
    expect(rows('Entries')).toHaveLength(500);
    await click(button(section('Entries'), 'Show more'));
    expect(rows('Entries')).toHaveLength(501);
  });

  it('REQ-ZIP-002: given a finding about an entry, when its entry button is clicked, then that entry is selected', async () => {
    mount();
    const z = buildZip(simple());
    patch(z.bytes, z.local[0] as number, 0, 4);
    await choose(z.bytes);
    await click(button(section('Findings'), 'Entry 0'));
    expect(section('Entry detail').querySelector('h3')?.textContent).toBe('a.txt');
  });

  it('REQ-ZIP-003: given a ZIP64 archive, when analyzed, then the summary says so', async () => {
    mount();
    await choose(buildZip(simple(), { zip64: true }).bytes);
    expect(section('Summary').textContent).toContain('ZIP64Yes');
  });

  it('REQ-ZIP-005: given a failing analysis, when chosen, then an alert explains it', async () => {
    mount({ analyze: () => Promise.reject(new Error('boom')), open: () => Promise.reject() });
    await choose(new Uint8Array(1));
    expect(root.querySelector('[role=alert]')?.textContent).toContain('boom');
  });

  it('REQ-ZIP-004: given an open still running, when the user selects another entry, then the late result does not move the view', async () => {
    const chain = new ArchiveChain();
    let release = () => {};
    const host: ZipHost = {
      analyze: (f) => chain.analyze(f),
      open: (p) =>
        new Promise((resolve) => {
          release = () => void chain.open(p).then(resolve);
        }),
    };
    mount(host);
    const inner = buildZip([{ name: 'inner.txt' }]).bytes;
    await choose(buildZip([{ name: 'a.txt' }, { name: 'in.zip', content: inner }]).bytes);
    await click(button(section('Entries'), 'in.zip'));
    await click(button(section('Entry detail'), 'Open as archive'));
    await click(button(section('Entries'), 'a.txt'));
    release();
    await settle();
    expect(rows('Entries').map((r) => r[1])).toEqual(['a.txt', 'in.zip']);
    expect(section('Entry detail').querySelector('h3')?.textContent).toBe('a.txt');
  });

  it('REQ-ZIP-005: given an open that fails, when it fails, then the report stays and the entry says why', async () => {
    const chain = new ArchiveChain();
    mount({
      analyze: (f) => chain.analyze(f),
      open: () => Promise.reject(new Error('worker crashed')),
    });
    await choose(buildZip([{ name: 'in.zip', content: 'x' }]).bytes);
    await click(button(section('Entries'), 'in.zip'));
    await click(button(section('Entry detail'), 'Open as archive'));
    expect(rows('Entries').map((r) => r[1])).toEqual(['in.zip']);
    expect(section('Entry detail').querySelector('[role=status]')?.textContent).toContain(
      'worker crashed',
    );
  });

  describe('options', () => {
    it('REQ-ZIP-008: given the page, when shown, then the options hold the defaults', () => {
      mount();
      expect((option('Compression ratio threshold') as HTMLInputElement).value).toBe('100');
      expect((option('Max nesting depth') as HTMLInputElement).value).toBe('8');
      expect((option('Max nested size') as HTMLInputElement).value).toBe('256');
      expect(option('Target file system').value).toBe('all');
      expect((option('Symbolic links') as HTMLInputElement).checked).toBe(true);
    });

    it('REQ-ZIP-008: given a ratio warning, when the threshold is raised, then the warning goes without choosing the file again', async () => {
      mount();
      await choose(buildZip(bomb()).bytes);
      expect(section('Findings').textContent).toContain('sec.compression-ratio');
      await change(option('Compression ratio threshold'), '2000');
      expect(section('Findings').textContent).not.toContain('sec.compression-ratio');
    });

    it('REQ-ZIP-008: given max nesting depth 1, when an archive inside a nested archive is opened, then it is refused', async () => {
      mount();
      await change(option('Max nesting depth'), '1');
      const inner = buildZip([{ name: 'inner.txt' }]).bytes;
      const middle = buildZip([{ name: 'in.zip', content: inner }]).bytes;
      await choose(buildZip([{ name: 'mid.zip', content: middle }]).bytes);
      await click(button(section('Entries'), 'mid.zip'));
      await click(button(section('Entry detail'), 'Open as archive'));
      await click(button(section('Entries'), 'in.zip'));
      await click(button(section('Entry detail'), 'Open as archive'));
      expect(section('Entry detail').querySelector('[role=status]')?.textContent).toContain(
        'Nesting is limited',
      );
    });

    it('REQ-ZIP-008: given a nested archive open, when an option changes, then the same nested archive is shown again', async () => {
      mount();
      const inner = buildZip([{ name: 'inner.txt' }]).bytes;
      await choose(buildZip([{ name: 'in.zip', content: inner }]).bytes);
      await click(button(section('Entries'), 'in.zip'));
      await click(button(section('Entry detail'), 'Open as archive'));
      await change(option('Max number of files'), '5');
      expect(section('Archive path').textContent).toBe('outer.zip › in.zip');
      expect(rows('Entries').map((r) => r[1])).toEqual(['inner.txt']);
    });

    it('REQ-ZIP-008: given two nested levels open, when max nesting depth drops to 1, then the first level shows and a notice says why', async () => {
      mount();
      const inner = buildZip([{ name: 'inner.txt' }]).bytes;
      const middle = buildZip([{ name: 'in.zip', content: inner }]).bytes;
      await choose(buildZip([{ name: 'mid.zip', content: middle }]).bytes);
      await click(button(section('Entries'), 'mid.zip'));
      await click(button(section('Entry detail'), 'Open as archive'));
      await click(button(section('Entries'), 'in.zip'));
      await click(button(section('Entry detail'), 'Open as archive'));
      expect(rows('Entries').map((r) => r[1])).toEqual(['inner.txt']);
      await change(option('Max nesting depth'), '1');
      expect(rows('Entries').map((r) => r[1])).toEqual(['in.zip']);
      expect(root.querySelector('main > [role=status]')?.textContent).toContain(
        'in.zip could not be opened again',
      );
    });

    it('PAR-10: given a check turned off, when the file is analyzed again, then that warning goes', async () => {
      mount();
      await choose(
        buildZip([{ name: 'a', content: 'x', versionMadeBy: 0x031e, external: 0o120777 * 0x10000 }])
          .bytes,
      );
      expect(section('Findings').textContent).toContain('sec.symlink');
      await change(option('Symbolic links'), false);
      expect(section('Findings').textContent).not.toContain('sec.symlink');
    });

    it('REQ-ZIP-008: given a changed option, when changed, then nothing is stored in the browser', async () => {
      mount();
      await change(option('Max number of files'), '5');
      expect(localStorage.length).toBe(0);
    });

    it('PAR-12: given an analysis, when shown, then the summary lists the parameters used', async () => {
      mount();
      await change(option('Max number of files'), '5');
      await choose(buildZip(simple()).bytes);
      expect(section('Summary').textContent).toContain('Max number of files5');
    });
  });

  it('REP-10: given findings of several categories, when shown, then they are grouped with counts', async () => {
    mount();
    const z = buildZip([{ name: '../a.txt', localName: 'b.txt', content: 'x' }]);
    await choose(z.bytes);
    const headings = [...section('Findings').querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Security (1)', 'Reader disagreement (1)']);
  });

  describe('review fixes', () => {
    it('REQ-ZIP-008: given a cleared number field, when changed, then the default applies', async () => {
      mount();
      await change(option('Max number of files'), '');
      await choose(buildZip(simple()).bytes);
      expect(section('Summary').textContent).toContain('Max number of files10000');
    });

    it('REQ-ZIP-008: given a new file still analyzing, when an option changes, then the old nested paths are not reopened on it', async () => {
      const chain = new ArchiveChain();
      let hold = false;
      let release = () => {};
      const opened: (readonly number[])[] = [];
      const host: ZipHost = {
        analyze: (f, p) =>
          hold
            ? new Promise((resolve, reject) => {
                release = () => void chain.analyze(f, p).then(resolve, reject);
              })
            : chain.analyze(f, p),
        open: (p) => {
          opened.push(p);
          return chain.open(p);
        },
      };
      mount(host);
      const inner = buildZip([{ name: 'inner.txt' }]).bytes;
      await choose(buildZip([{ name: 'in.zip', content: inner }]).bytes);
      await click(button(section('Entries'), 'in.zip'));
      await click(button(section('Entry detail'), 'Open as archive'));
      hold = true;
      await choose(buildZip([{ name: 'b.txt' }]).bytes, 'b.zip');
      hold = false;
      opened.length = 0;
      await change(option('Max number of files'), '5');
      release();
      await settle();
      expect(opened).toEqual([]);
      expect(rows('Entries').map((r) => r[1])).toEqual(['b.txt']);
    });

    it('REQ-ZIP-008: given a reopen notice, when the user goes back, then the notice goes', async () => {
      mount();
      const inner = buildZip([{ name: 'inner.txt' }]).bytes;
      const middle = buildZip([{ name: 'in.zip', content: inner }]).bytes;
      await choose(buildZip([{ name: 'mid.zip', content: middle }]).bytes);
      await click(button(section('Entries'), 'mid.zip'));
      await click(button(section('Entry detail'), 'Open as archive'));
      await click(button(section('Entries'), 'in.zip'));
      await click(button(section('Entry detail'), 'Open as archive'));
      await change(option('Max nesting depth'), '1');
      expect(root.querySelector('main > [role=status]')).not.toBeNull();
      await click(button(section('Archive path'), 'outer.zip'));
      expect(root.querySelector('main > [role=status]')).toBeNull();
    });
  });

  describe('extra fields', () => {
    const T = 1735787045; // 2025-01-02 03:04:05 UTC
    const le = (...values: [number, 1 | 2 | 4][]) => {
      const out: number[] = [];
      for (const [v, size] of values)
        for (let i = 0; i < size; i++) out.push((v >>> (8 * i)) & 0xff);
      return Uint8Array.of(...out);
    };
    const block = (id: number, data: Uint8Array) =>
      Uint8Array.of(id & 0xff, id >>> 8, data.length & 0xff, data.length >>> 8, ...data);
    const detail = async (entry: FixtureEntry) => {
      mount();
      await choose(buildZip([entry]).bytes);
      await click(button(section('Entries'), entry.name as string));
      return section('Entry detail').textContent ?? '';
    };

    it('REQ-ZIP-010: given Info-ZIP time and owner blocks, when the entry is shown, then the UTC time and the UID and GID', async () => {
      const text = await detail({
        name: 'a.txt',
        centralExtra: Uint8Array.of(
          ...block(0x5455, le([1, 1], [T, 4])),
          ...block(0x7875, le([1, 1], [4, 1], [501, 4], [4, 1], [20, 4])),
        ),
      });
      expect(text).toContain('modified 2025-01-02 03:04:05 UTC');
      expect(text).toContain('UID 501, GID 20');
    });

    it('REQ-ZIP-010: given a WinZip AES block, when the entry is shown, then the strength and the real method', async () => {
      const text = await detail({
        name: 'secret.txt',
        method: 99,
        flags: 1,
        centralExtra: block(0x9901, le([2, 2], [0x4541, 2], [3, 1], [8, 2])),
      });
      expect(text).toContain('AE-2, vendor ID "AE", 256-bit key, real method Deflated (8)');
    });

    it('REQ-ZIP-010: given an NTFS block with no creation time, when the entry is shown, then it says not set', async () => {
      const filetime = (ticks: bigint) =>
        [0, 1, 2, 3, 4, 5, 6, 7].map((i) => Number((ticks >> BigInt(8 * i)) & 0xffn));
      const ticks = (BigInt(T) + 11644473600n) * 10000000n;
      const text = await detail({
        name: 'n.txt',
        centralExtra: block(
          0x000a,
          Uint8Array.of(
            0,
            0,
            0,
            0,
            1,
            0,
            24,
            0,
            ...filetime(ticks),
            ...filetime(ticks),
            ...filetime(0n),
          ),
        ),
      });
      expect(text).toContain('modified 2025-01-02 03:04:05.0000000 UTC');
      expect(text).toContain('created not set');
    });

    it('REQ-ZIP-010: given an apksigner alignment block, when the entry is shown, then the alignment and that the data is aligned', async () => {
      const text = await detail({
        name: 'classes.dex',
        content: 'dex',
        localExtra: block(0xd935, Uint8Array.of(4, 0, 0)),
      });
      expect(text).toContain('alignment 4 bytes, 1 padding bytes, file data aligned');
    });

    it('EXT-10: given zipalign zero padding, when the entry is shown, then it is Zero padding, not Malformed', async () => {
      const text = await detail({ name: 'res.png', content: 'png', localExtra: new Uint8Array(3) });
      expect(text).toContain('Zero padding, 3 bytes');
      expect(text).not.toContain('Malformed');
    });

    it('REQ-ZIP-010: given a malformed timestamp block, when the entry is shown, then its hex preview is shown too', async () => {
      const text = await detail({ name: 't.txt', centralExtra: block(0x5455, Uint8Array.of(3)) });
      expect(text).toContain('flags 0x03');
      expect(text).toContain('03');
      expect(text).toMatch(/flags 0x03.*bytes 03/);
    });

    it('EXT-6: given a UNIX owner block with no IDs, when the entry is shown, then it says so', async () => {
      const text = await detail({
        name: 'u.txt',
        centralExtra: block(0x7875, Uint8Array.of(1, 0, 0)),
      });
      expect(text).toContain('no UID or GID');
    });
  });
});

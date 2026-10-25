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
  return { analyze: (f) => chain.analyze(f), open: (p) => chain.open(p) };
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
});

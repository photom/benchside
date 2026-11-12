import { Batch, Findings, type Snapshot, view } from '@benchside/dmarc-aggregate';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { on, reportXml } from '../../../packages/dmarc-aggregate/src/test/report-xml.ts';
import { ALL_FILTERS } from './state.ts';
import {
  jobHost,
  manualHost,
  mount,
  pick,
  root,
  section,
  settle,
  xmlFile,
} from './test/harness.tsx';

describe('App: page and input (INP-1, REQ-DMARC-011)', () => {
  it('REQ-DMARC-001: given the page, when opened, then the title, the scope line, and the privacy note', () => {
    mount(manualHost().host);
    expect(root.querySelector('h1')?.textContent).toBe('DMARC aggregate report analyzer');
    expect(root.textContent).toContain(
      'Reads aggregate reports (rua). Failure reports (ruf) are not read.',
    );
    expect(root.textContent).toContain('never leave');
  });

  it('INP-1: given picked report files, when added, then the reports, headline numbers, and done note appear', async () => {
    const { host } = jobHost();
    mount(host);
    await pick([
      xmlFile('a.xml', reportXml({ id: 'a', ...on(0), count: 3 })),
      xmlFile('b.xml', reportXml({ id: 'b', ...on(1), count: 2 })),
    ]);
    const rows = section('Reports').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('a.xml');
    expect(rows[0]?.textContent).toContain('RFC 9990 (DMARCbis)');
    expect(rows[0]?.textContent).toContain('2023-11-14');
    const tiles = section('Summary').textContent;
    expect(tiles).toContain('Messages5');
    expect(tiles).toContain('DMARC pass rate100%');
    expect(tiles).toContain('Reports2');
    expect(tiles).toContain('2023-11-14 to 2023-11-15');
    expect(root.textContent).toContain('Read 2 files, 2 reports');
  });

  it('REP-7: given a file that is not a report, when added, then its finding and the file not read are listed', async () => {
    const { host } = jobHost();
    mount(host);
    await pick([xmlFile('notes.txt', 'hello')]);
    const findings = section('Findings').textContent;
    expect(findings).toContain('aggregate.input.unknown-type');
    expect(findings).toContain('notes.txt');
    expect(section('Files not read').textContent).toContain('notes.txt');
    expect(section('Files not read').textContent).toContain('failed');
    expect(section('Summary').textContent).toContain('No dated reports');
  });

  it('PRG-3: given reports, when Clear is pressed, then the host clears and the lists empty', async () => {
    const { host, calls } = jobHost();
    mount(host);
    await pick([xmlFile('a.xml', reportXml({ ...on(0) }))]);
    const clear = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Clear',
    ) as HTMLButtonElement;
    act(() => clear.click());
    await settle();
    expect(calls).toContain('clear');
    expect(section('Reports')).toBeUndefined();
  });
});

describe('App: drop errors', () => {
  it('INP-1: given a dropped folder that cannot be read, when dropped, then an error is shown and nothing is added', async () => {
    const m = manualHost();
    mount(m.host);
    const unreadable = {
      isFile: false,
      isDirectory: true,
      name: 'locked',
      createReader: () => ({
        readEntries: (_ok: unknown, fail: (e: Error) => void) =>
          fail(new Error('NotReadableError')),
      }),
    };
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { items: [{ kind: 'file', webkitGetAsEntry: () => unreadable }] },
    });
    act(() => {
      root.querySelector('.drop')?.dispatchEvent(drop);
    });
    await settle();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('NotReadableError');
    expect(m.calls).not.toContain('add');
  });
});

describe('App: status bar (PRG-4..6, PRG-9, PRG-15)', () => {
  it('PRG-6: given a reading snapshot, when shown, then a progress bar by bytes and the reading text', () => {
    const m = manualHost();
    mount(m.host);
    m.send({ bytesRead: 1024 * 1024, filesRead: 1, reports: 1380 });
    const bar = root.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe(String(1024 * 1024));
    expect(bar.getAttribute('aria-valuemax')).toBe(String(3 * 1024 * 1024));
    expect(root.textContent).toContain('Reading files: 1 of 4 (1.0 MiB of 3.0 MiB), 1,380 reports');
  });

  it('PRG-9: given reading, when Stop is pressed, then the host stops; a stopped snapshot shows the stopped note', () => {
    const m = manualHost();
    mount(m.host);
    m.send({ filesRead: 1 });
    const stop = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Stop',
    ) as HTMLButtonElement;
    act(() => stop.click());
    expect(m.calls).toContain('stop');
    m.send({ phase: 'stopped', filesRead: 1 }, false);
    expect(root.textContent).toContain('Stopped after 1 of 4 files');
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('PRG-4: given reading ends, when 5 s pass, then the done note hides', () => {
    vi.useFakeTimers();
    const m = manualHost();
    mount(m.host);
    m.send({ filesRead: 0 });
    m.send({ phase: 'done', filesRead: 4, reports: 7 }, false);
    const note = () => root.querySelector('.status .done')?.textContent ?? null;
    expect(note()).toBe('Read 4 files, 7 reports');
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(note()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(note()).toBeNull();
  });

  it('PRG-4: given a second run that ends before a reading snapshot is shown, when it ends, then the done note shows again', () => {
    vi.useFakeTimers();
    const m = manualHost();
    mount(m.host);
    const note = () => root.querySelector('.status .done')?.textContent ?? null;
    m.send({ phase: 'done', filesRead: 4, reports: 7 }, false);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(note()).toBeNull();
    m.send({ phase: 'done', filesRead: 6, filesTotal: 6, reports: 9 }, false);
    expect(note()).toBe('Read 6 files, 9 reports');
  });

  it('PRG-3: given a cleared batch, when its empty snapshot arrives, then no done note', () => {
    const m = manualHost();
    mount(m.host);
    m.send({ filesRead: 1 });
    m.send({ phase: 'done', filesRead: 0, filesTotal: 0, reports: 0 }, false);
    expect(root.querySelector('.status .done')).toBeNull();
  });

  it('PRG-6: given reading, when it passes each quarter, then the live region announces start, quarters, and end', () => {
    const m = manualHost();
    mount(m.host);
    const live = () => root.querySelector('[aria-live="polite"]')?.textContent;
    m.send({ filesRead: 0, filesTotal: 8 });
    expect(live()).toBe('Reading 8 files.');
    m.send({ filesRead: 1, filesTotal: 8 });
    expect(live()).toBe('Reading 8 files.');
    m.send({ filesRead: 2, filesTotal: 8 });
    expect(live()).toBe('Read 2 of 8 files.');
    m.send({ filesRead: 3, filesTotal: 8 });
    expect(live()).toBe('Read 2 of 8 files.');
    m.send({ phase: 'done', filesRead: 8, filesTotal: 8, reports: 2 }, false);
    expect(live()).toBe('Read 8 files, 2 reports.');
  });

  it('REQ-DMARC-010: given a worker failure, when reported, then the message is shown', () => {
    const m = manualHost();
    mount(m.host);
    m.fail('boom');
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('boom');
  });
});

describe('App: partial label (PRG-15)', () => {
  it('PRG-15: given a partial View, when shown, then the summary carries the partial label until a final View', () => {
    let listener: (s: Snapshot) => void = () => {};
    const host = {
      ...manualHost().host,
      onSnapshot: (l: (s: Snapshot) => void) => {
        listener = l;
      },
    };
    mount(host);
    const empty = view(new Batch(new Findings()), ALL_FILTERS);
    const snap = (partial: boolean, filesRead: number): Snapshot => ({
      id: null,
      generation: 1,
      filters: ALL_FILTERS,
      focus: null,
      view: empty,
      partial,
      progress: {
        phase: partial ? 'reading' : 'done',
        bytesRead: 0,
        bytesTotal: 0,
        filesRead,
        filesTotal: 400,
        reports: 0,
      },
      changes: {
        filesAdded: [],
        fileStatus: [],
        reportsAdded: [],
        findingsAdded: [],
        policies: null,
      },
    });
    act(() => listener(snap(true, 120)));
    expect(section('Summary').textContent).toContain('Partial: 120 of 400 files');
    act(() => listener(snap(false, 400)));
    expect(section('Summary').textContent).not.toContain('Partial');
  });
});

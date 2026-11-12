import { describe, expect, it } from 'vitest';
import { Job, type JobFile, type Snapshot } from './job.ts';
import { direct, NOW, on, rec, reportXml } from './test/report-xml.ts';
import type { Filters } from './view.ts';

const ALL: Filters = { domain: null, reporters: null, days: null };
const enc = (s: string) => new TextEncoder().encode(s);

const file = (name: string, text: string | Uint8Array, fromFolder = false): JobFile => {
  const bytes = typeof text === 'string' ? enc(text) : text;
  return { name, size: bytes.length, fromFolder, read: async () => bytes };
};
const report = (n: number, o = {}) => reportXml({ id: `id${n}`, ...on(n), ...o });

/**
 * A job with a fake clock that moves 100 ms at each yield, and a yield at every pause (stepMs 0).
 * `onYield` runs inside the yield, where messages from the UI arrive.
 */
function setup(onYield?: (n: number) => void) {
  const sent: Snapshot[] = [];
  let ms = 0;
  let yields = 0;
  const job = new Job({
    send: (s) => sent.push(s),
    clock: () => ms,
    stepMs: 0,
    now: () => NOW + 4000 * 86_400,
    yieldToEvents: async () => {
      ms += 100;
      onYield?.(yields++);
    },
  });
  return { job, sent, last: () => sent[sent.length - 1] as Snapshot };
}

const all = <T>(sent: Snapshot[], pick: (s: Snapshot) => readonly T[]) => sent.flatMap(pick);

describe('Job: reading and snapshots (PRG-1, PRG-4..6)', () => {
  it('PRG-4: given files, when added, then a snapshot before any report, then a final one', async () => {
    const { job, sent, last } = setup();
    job.add([file('a.xml', report(0)), file('b.xml', report(1))]);
    await job.idle;
    expect(sent[0]).toMatchObject({
      partial: true,
      generation: 1,
      id: null,
      progress: { phase: 'reading', reports: 0 },
    });
    expect(sent[0]?.view).not.toBeNull();
    expect(last()).toMatchObject({ partial: false, progress: { phase: 'done', reports: 2 } });
    expect(last().view?.totals.reports).toBe(2);
  });

  it('PRG-6: given files read, when done, then bytes, files, and reports are complete', async () => {
    const { job, last } = setup();
    const a = file('a.xml', report(0));
    const b = file('b.xml', report(1));
    job.add([a, b]);
    await job.idle;
    expect(last().progress).toEqual({
      phase: 'done',
      bytesRead: a.size + b.size,
      bytesTotal: a.size + b.size,
      filesRead: 2,
      filesTotal: 2,
      reports: 2,
    });
  });

  it('PRG-4: given reading that takes time, when read, then a snapshot every 250 ms between the first and last', async () => {
    const { job, sent } = setup();
    job.add(Array.from({ length: 12 }, (_, i) => file(`${i}.xml`, report(i))));
    await job.idle;
    // 12 files, one yield each at 100 ms: snapshots at 0, then at 300, 600, 900, 1200 ms, then the last.
    expect(sent.map((s) => s.partial)).toEqual([true, true, true, true, true, false]);
  });

  it('PRG-1: given an add while reading, when read, then its files join the queue', async () => {
    const { job, last } = setup((n) => {
      if (n === 0) job.add([file('c.xml', report(2))]);
    });
    job.add([file('a.xml', report(0)), file('b.xml', report(1))]);
    await job.idle;
    expect(last().progress).toMatchObject({ filesRead: 3, filesTotal: 3, reports: 3 });
  });
});

describe('Job: requests (PRG-8, PRG-9, PRG-3, PRG-13)', () => {
  it('PRG-8: given a view request while reading, when the step ends, then a snapshot answers it with a View', async () => {
    const { job, sent } = setup((n) => {
      if (n === 0) job.view(7, { ...ALL, domain: 'example.net' }, { path: 'direct' });
    });
    job.add([file('a.xml', report(0)), file('b.xml', report(1)), file('c.xml', report(2))]);
    await job.idle;
    const answer = sent.find((s) => s.id === 7);
    expect(answer).toMatchObject({
      partial: true,
      filters: { domain: 'example.net' },
      focus: { path: 'direct' },
    });
    expect(answer?.view).not.toBeNull();
    expect(sent.indexOf(answer as Snapshot)).toBeLessThan(sent.length - 1);
  });

  it('PRG-8: given a view request while idle, when sent, then it is answered at once with a View', async () => {
    const { job, sent, last } = setup();
    job.add([file('a.xml', report(0))]);
    await job.idle;
    const before = sent.length;
    job.view(9, ALL, null);
    expect(sent.length).toBe(before + 1);
    expect(last()).toMatchObject({ id: 9, partial: false });
    expect(last().view?.totals.reports).toBe(1);
  });

  it('PRG-9: given a stop while reading, when the step ends, then later files are stopped and counted reports stay', async () => {
    // At the first yield, report 0 is still held by the XML sink; stop at the second, inside b.
    const { job, last, sent } = setup((n) => {
      if (n === 1) job.stop();
    });
    job.add([file('a.xml', report(0)), file('b.xml', report(1)), file('c.xml', report(2))]);
    await job.idle;
    expect(last()).toMatchObject({ partial: false, progress: { phase: 'stopped', reports: 1 } });
    expect(
      all(sent, (s) => s.changes.fileStatus)
        .filter((c) => c.status === 'stopped')
        .map((c) => c.index),
    ).toEqual([1, 2]);
  });

  it('PRG-3: given a clear, when sent, then reading stops and an empty snapshot of the next generation follows', async () => {
    const { job, sent, last } = setup((n) => {
      if (n === 0) job.clear();
    });
    job.add([file('a.xml', report(0)), file('b.xml', report(1))]);
    await job.idle;
    expect(last()).toMatchObject({
      generation: 2,
      changes: {
        filesAdded: [],
        reportsAdded: [],
        findingsAdded: [],
        fileStatus: [],
        policies: null,
      },
      progress: { phase: 'done', filesTotal: 0, reports: 0 },
    });
    expect(sent.filter((s) => s.generation === 1).every((s) => s.progress.filesTotal === 2)).toBe(
      true,
    );
    job.add([file('c.xml', report(2))]);
    await job.idle;
    expect(last()).toMatchObject({ generation: 2, progress: { reports: 1 } });
    const gen2 = sent.filter((s) => s.generation === 2);
    expect(all(gen2, (s) => s.changes.reportsAdded).map((r) => r.index)).toEqual([0]);
    expect(all(gen2, (s) => s.changes.fileStatus).map((c) => [c.index, c.status])).toEqual([
      [0, 'read'],
    ]);
    expect(last().progress).toMatchObject({ filesRead: 1, filesTotal: 1 });
  });
});

describe('Job: batch changes (PRG-14, PRG-16)', () => {
  it('PRG-14: given several snapshots, when read, then each report, finding, and file is sent once', async () => {
    const { job, sent } = setup();
    const files = Array.from({ length: 6 }, (_, i) =>
      file(`${i}.xml`, report(i, i === 2 ? { errors: ['oops'] } : {})),
    );
    job.add(files);
    await job.idle;
    expect(all(sent, (s) => s.changes.reportsAdded).map((r) => r.index)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(all(sent, (s) => s.changes.filesAdded).map((f) => f.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(all(sent, (s) => s.changes.findingsAdded).map((f) => f.id)).toEqual([
      'aggregate.report.error',
    ]);
    expect(all(sent, (s) => s.changes.fileStatus).filter((c) => c.status === 'read')).toHaveLength(
      6,
    );
  });

  it('PRG-14: given policies, when snapshots are sent, then the list comes only when it changed', async () => {
    const { job, sent } = setup();
    job.add([file('a.xml', report(0))]);
    await job.idle;
    job.view(1, ALL, null);
    expect(sent.map((s) => s.changes.policies?.length ?? null)).toEqual([null, 1, null]);
  });

  it('PRG-16: given a snapshot with nothing new for the View, when sent, then its View is null', async () => {
    // One file of many chunks: periodic snapshots inside it see no new report and no file finished.
    const big = report(0, { records: direct('192.0.2.1').repeat(4000) });
    const { job, sent } = setup();
    job.add([file('big.xml', big)]);
    await job.idle;
    const middle = sent.slice(1, -1);
    expect(middle.length).toBeGreaterThan(0);
    expect(middle.every((s) => s.view === null)).toBe(true);
    expect(sent[sent.length - 1]?.view).not.toBeNull();
  });
});

describe('Job: files (INP-2, INP-11, REP-1)', () => {
  it('REP-1: given a report and a file with only an error, when read, then read with counts, and failed', async () => {
    const { job, sent } = setup();
    job.add([file('a.xml', report(0)), file('b.bin', 'not a report')]);
    await job.idle;
    const final = all(sent, (s) => s.changes.fileStatus).filter((c) => c.status !== 'queued');
    expect(final).toEqual([
      { index: 0, status: 'read', kind: 'xml', reports: 1, findings: 0 },
      { index: 1, status: 'failed', kind: 'unknown', reports: 0, findings: 1 },
    ]);
    expect(all(sent, (s) => s.changes.findingsAdded)[0]).toMatchObject({
      id: 'aggregate.input.unknown-type',
      file: 1,
      label: 'b.bin',
    });
  });

  it('REP-1: given a file with a report and then an error, when read, then read, not failed', async () => {
    const { job, sent } = setup();
    job.add([file('a.xml', `${report(0)}<broken>`)]);
    await job.idle;
    expect(all(sent, (s) => s.changes.fileStatus)).toEqual([
      { index: 0, status: 'read', kind: 'xml', reports: 1, findings: 1 },
    ]);
  });

  it('PRG-6: given the same file twice, when read, then reports counts only the counted one', async () => {
    const { job, last } = setup();
    job.add([file('a.xml', report(0)), file('copy.xml', report(0))]);
    await job.idle;
    expect(last().progress.reports).toBe(1);
  });

  it('INP-14: given a file that cannot be read, when read, then unreadable, failed, and the next file is read', async () => {
    const { job, sent, last } = setup();
    const gone: JobFile = {
      name: 'gone.xml',
      size: 10,
      fromFolder: false,
      read: () => Promise.reject(new Error('NotReadableError')),
    };
    job.add([gone, file('b.xml', report(1))]);
    await job.idle;
    expect(all(sent, (s) => s.changes.findingsAdded)).toEqual([
      expect.objectContaining({
        id: 'aggregate.input.unreadable',
        severity: 'error',
        file: 0,
        label: 'gone.xml',
      }),
    ]);
    expect(all(sent, (s) => s.changes.fileStatus).map((c) => [c.index, c.status])).toEqual([
      [0, 'failed'],
      [1, 'read'],
    ]);
    expect(last()).toMatchObject({ partial: false, progress: { phase: 'done', reports: 1 } });
  });

  it('PRG-9: given an unexpected error while reading, when it happens, then the run ends with a final snapshot and the job reads again', async () => {
    const { job, last } = setup();
    const broken: JobFile = {
      name: 'x',
      size: 1,
      fromFolder: false,
      read: async () => null as unknown as Uint8Array,
    };
    job.add([broken]);
    await expect(job.idle).rejects.toThrow();
    expect(last()).toMatchObject({ partial: false, progress: { phase: 'stopped' } });
    job.add([file('b.xml', report(1))]);
    await job.idle;
    expect(last()).toMatchObject({ partial: false, progress: { phase: 'done', reports: 1 } });
  });

  it('INP-2: given a loose file over 64 MiB, when added, then too-large, failed, and not read', async () => {
    const { job, sent } = setup();
    let reads = 0;
    const huge: JobFile = {
      name: 'huge.xml',
      size: 64 * 1024 * 1024 + 1,
      fromFolder: false,
      read: async () => {
        reads++;
        return new Uint8Array(0);
      },
    };
    job.add([huge]);
    await job.idle;
    expect(reads).toBe(0);
    expect(all(sent, (s) => s.changes.findingsAdded)).toEqual([
      expect.objectContaining({
        id: 'aggregate.input.too-large',
        severity: 'error',
        file: 0,
        label: 'huge.xml',
      }),
    ]);
    expect(all(sent, (s) => s.changes.fileStatus)).toEqual([
      { index: 0, status: 'failed', kind: null, reports: 0, findings: 1 },
    ]);
  });

  it('INP-2: given more than 20 000 files, when added, then too-many-files once and the rest not listed', async () => {
    const { job, sent, last } = setup();
    const many = Array.from({ length: 20_002 }, (_, i) => ({
      name: `${i}`,
      size: 0,
      fromFolder: false,
      read: async () => new Uint8Array(0),
    }));
    job.add(many);
    job.stop();
    await job.idle;
    expect(last().progress.filesTotal).toBe(20_000);
    const f = all(sent, (s) => s.changes.findingsAdded).filter(
      (x) => x.id === 'aggregate.input.too-many-files',
    );
    expect(f).toEqual([expect.objectContaining({ severity: 'error', file: null, label: null })]);
  });

  it('INP-11: given folder files that are hidden, too large, or of unknown type, when read, then skipped with one finding for the add', async () => {
    const { job, sent } = setup();
    job.add([
      file('r/a.xml', report(0), true),
      file('r/.DS_Store', 'x', true),
      file('r/notes.txt', 'hello', true),
      {
        name: 'r/huge.xml',
        size: 64 * 1024 * 1024 + 1,
        fromFolder: true,
        read: async () => new Uint8Array(0),
      },
      file('loose.txt', 'hello'),
    ]);
    await job.idle;
    const statuses = all(sent, (s) => s.changes.fileStatus).filter((c) => c.status !== 'queued');
    expect(statuses.map((c) => [c.index, c.status])).toEqual([
      [1, 'skipped'],
      [3, 'skipped'],
      [0, 'read'],
      [2, 'skipped'],
      [4, 'failed'],
    ]);
    const findings = all(sent, (s) => s.changes.findingsAdded);
    expect(findings.map((f) => [f.id, f.file])).toEqual([
      ['aggregate.input.skipped', null],
      ['aggregate.input.unknown-type', 4],
    ]);
    expect(findings[0]?.message).toContain('3 files');
    expect(findings[0]?.message).toContain('r/.DS_Store');
  });
});

describe('Job: classification in the View (PRG-7)', () => {
  it('PRG-7: given a later report that reveals a forwarder, when the final snapshot is sent, then its View uses it', async () => {
    const { job, last } = setup();
    const failing = rec({ ip: '198.51.100.7', rawDkim: 'fail', dkimDomain: 'x.example.net' });
    const fwd = rec({ ip: '198.51.100.7', dkim: 'pass', rawDkim: 'pass' });
    job.add([
      file('a.xml', report(0, { records: failing })),
      file('b.xml', report(1, { records: fwd })),
    ]);
    await job.idle;
    expect(last().view?.totals.byCause).toEqual([
      { cause: 'spf-broken-by-forwarding', messages: 1 },
    ]);
  });
});

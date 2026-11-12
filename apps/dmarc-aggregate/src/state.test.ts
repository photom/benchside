import type { Filters, Snapshot, View } from '@benchside/dmarc-aggregate';
import { describe, expect, it } from 'vitest';
import { applySnapshot, initialState, partialLabel, setFilters } from './state.ts';

const ALL: Filters = { domain: null, reporters: null, days: null };
const view = (reports: number) => ({ totals: { reports } }) as unknown as View;

const snap = (
  o: Partial<Snapshot> & { reports?: number[]; findings?: string[] } = {},
): Snapshot => ({
  id: null,
  generation: 1,
  filters: ALL,
  focus: null,
  view: null,
  partial: true,
  progress: {
    phase: 'reading',
    bytesRead: 0,
    bytesTotal: 10,
    filesRead: 0,
    filesTotal: 2,
    reports: 0,
  },
  ...o,
  changes: {
    filesAdded: [],
    fileStatus: [],
    reportsAdded: (o.reports ?? []).map((index) => ({ index }) as never),
    findingsAdded: (o.findings ?? []).map((id) => ({ id }) as never),
    policies: null,
    ...o.changes,
  },
});

describe('UI state (PRG-13..16)', () => {
  it('PRG-14: given snapshots with changes, when applied, then lists grow by each and progress is the newest', () => {
    let s = initialState();
    s = applySnapshot(s, snap({ reports: [0], findings: ['a'] }));
    s = applySnapshot(
      s,
      snap({
        reports: [1],
        changes: {
          filesAdded: [{ index: 0, name: 'a.xml', byteLength: 5, kind: null, status: 'queued' }],
          fileStatus: [],
          reportsAdded: [],
          findingsAdded: [],
          policies: null,
        },
        progress: {
          phase: 'done',
          bytesRead: 10,
          bytesTotal: 10,
          filesRead: 2,
          filesTotal: 2,
          reports: 2,
        },
      }),
    );
    expect(s.reports.map((r) => r.index)).toEqual([0]);
    expect(s.files).toHaveLength(1);
    expect(s.findings.map((f) => f.id)).toEqual(['a']);
    expect(s.progress?.phase).toBe('done');
  });

  it('PRG-14: given file status changes, when applied, then the file takes the status, kind, and counts', () => {
    let s = initialState();
    s = applySnapshot(
      s,
      snap({
        changes: {
          filesAdded: [{ index: 0, name: 'a.xml', byteLength: 5, kind: null, status: 'queued' }],
          fileStatus: [],
          reportsAdded: [],
          findingsAdded: [],
          policies: null,
        },
      }),
    );
    s = applySnapshot(
      s,
      snap({
        changes: {
          filesAdded: [],
          fileStatus: [{ index: 0, status: 'read', kind: 'xml', reports: 1, findings: 2 }],
          reportsAdded: [],
          findingsAdded: [],
          policies: null,
        },
      }),
    );
    expect(s.files[0]).toEqual({
      index: 0,
      name: 'a.xml',
      byteLength: 5,
      kind: 'xml',
      status: 'read',
      reports: 1,
      findings: 2,
    });
  });

  it('PRG-14: given policies in one snapshot and null in the next, when applied, then the list is replaced only when sent', () => {
    let s = initialState();
    const list = [{ domain: 'example.com' }] as never;
    s = applySnapshot(
      s,
      snap({
        changes: {
          filesAdded: [],
          fileStatus: [],
          reportsAdded: [],
          findingsAdded: [],
          policies: list,
        },
      }),
    );
    s = applySnapshot(s, snap());
    expect(s.policies).toBe(list);
  });

  it('PRG-13: given a snapshot of an older generation, when applied, then nothing changes; a newer one starts afresh', () => {
    let s = applySnapshot(initialState(), snap({ generation: 2, reports: [0] }));
    const before = s;
    s = applySnapshot(s, snap({ generation: 1, reports: [5] }));
    expect(s).toBe(before);
    s = applySnapshot(s, snap({ generation: 3, reports: [0] }));
    expect([s.generation, s.reports.length]).toEqual([3, 1]);
  });

  it('PRG-15: given a View for other filters, when applied, then the shown View stays; one for the current filters is shown', () => {
    let s = setFilters(initialState(), { ...ALL, domain: 'example.com' }, null);
    s = applySnapshot(s, snap({ view: view(1) }));
    expect(s.shown).toBeNull();
    s = applySnapshot(s, snap({ view: view(2), filters: { ...ALL, domain: 'example.com' } }));
    expect(s.shown?.view.totals.reports).toBe(2);
    s = applySnapshot(s, snap({ view: null, filters: { ...ALL, domain: 'example.com' } }));
    expect(s.shown?.view.totals.reports).toBe(2);
  });

  it('PRG-15: given a focus, when a View for another focus arrives, then it is not shown', () => {
    let s = setFilters(initialState(), ALL, { path: 'forwarded' });
    s = applySnapshot(s, snap({ view: view(1), focus: { path: 'direct' } }));
    expect(s.shown).toBeNull();
    s = applySnapshot(s, snap({ view: view(1), focus: { path: 'forwarded' } }));
    expect(s.shown).not.toBeNull();
  });

  it('PRG-15: given a partial View, when shown, then the label counts its snapshot; a final View removes it', () => {
    let s = applySnapshot(
      initialState(),
      snap({
        view: view(1),
        progress: {
          phase: 'reading',
          bytesRead: 1,
          bytesTotal: 9,
          filesRead: 120,
          filesTotal: 400,
          reports: 3,
        },
      }),
    );
    expect(partialLabel(s)).toBe('Partial: 120 of 400 files');
    s = applySnapshot(
      s,
      snap({
        view: null,
        progress: {
          phase: 'reading',
          bytesRead: 2,
          bytesTotal: 9,
          filesRead: 200,
          filesTotal: 400,
          reports: 3,
        },
      }),
    );
    expect(partialLabel(s)).toBe('Partial: 120 of 400 files');
    s = applySnapshot(s, snap({ view: view(2), partial: false }));
    expect(partialLabel(s)).toBeNull();
  });
});

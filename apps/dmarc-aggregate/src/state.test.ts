import type { Filters, Names, Snapshot, View } from '@benchside/dmarc-aggregate';
import { describe, expect, it } from 'vitest';
import {
  applyNames,
  applySnapshot,
  hostLabel,
  initialState,
  partialLabel,
  setFilters,
  setLookup,
} from './state.ts';

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

describe('UI state: host names (PRG-11..13, RDNS-5)', () => {
  const names = (o: Partial<Names> & { changes?: Names['changes'] }): Names => ({
    type: 'names',
    generation: 1,
    session: 1,
    changes: {},
    counts: { queued: 0, lookingUp: 0, done: 0, targets: 0 },
    log: [],
    findings: [],
    ...o,
  });
  const on = (s = initialState()) => setLookup(s, true, 'cloudflare');
  const IP = '192.0.2.1';

  it('PRG-11: given the active session, when states arrive, then the cell follows them: waiting, looking up, final', () => {
    let s = on();
    s = applyNames(s, names({ changes: { [IP]: { state: 'queued' } } }));
    expect(hostLabel(s, IP)).toBe('Waiting');
    s = applyNames(s, names({ changes: { [IP]: { state: 'looking-up' } } }));
    expect(hostLabel(s, IP)).toBe('Looking up');
    s = applyNames(
      s,
      names({ changes: { [IP]: { state: 'confirmed', names: ['mx.example.net'] } } }),
    );
    expect(hostLabel(s, IP)).toBe('mx.example.net');
    expect(hostLabel(s, '192.0.2.9')).toBe('Not looked up');
  });

  it('RDNS-5: given each final state, when shown, then confirmed names, unconfirmed names marked, no name, or the error', () => {
    let s = on();
    s = applyNames(
      s,
      names({
        changes: {
          a: { state: 'unconfirmed', names: ['x.example.net', 'y.example.net'] },
          b: { state: 'none' },
          c: { state: 'error', rcode: 'TIMEOUT' },
        },
      }),
    );
    expect([hostLabel(s, 'a'), hostLabel(s, 'b'), hostLabel(s, 'c')]).toEqual([
      'x.example.net, y.example.net (not confirmed)',
      'No host name',
      'Lookup failed (TIMEOUT)',
    ]);
  });

  it('PRG-13: given lookups turned off, when shown, then queued and looking-up sources fall back to their last final state', () => {
    let s = on();
    s = applyNames(s, names({ changes: { [IP]: { state: 'none' } } }));
    s = setLookup(s, false, 'cloudflare');
    s = on(s);
    s = applyNames(s, names({ session: 2, changes: { [IP]: { state: 'queued' } } }));
    expect(hostLabel(s, IP)).toBe('Waiting');
    s = setLookup(s, false, 'cloudflare');
    expect(hostLabel(s, IP)).toBe('No host name');
  });

  it('PRG-13: given an ended session, when its names arrive, then only final states apply, and only where no newer session has a state', () => {
    let s = on();
    s = setLookup(s, false, 'cloudflare');
    s = on(s);
    s = applyNames(s, names({ session: 2, changes: { b: { state: 'none' } } }));
    // A late message from session 1: its queued is ignored, its finals apply where session 2 has nothing.
    s = applyNames(
      s,
      names({
        session: 1,
        changes: {
          a: { state: 'confirmed', names: ['a.example'] },
          b: { state: 'error', rcode: 'SERVFAIL' },
          c: { state: 'queued' },
        },
      }),
    );
    expect([hostLabel(s, 'a'), hostLabel(s, 'b'), hostLabel(s, 'c')]).toEqual([
      'a.example',
      'No host name',
      'Not looked up',
    ]);
  });

  it('PRG-13: given an ended final held back by a newer queued state, when that source is removed, then the held final shows', () => {
    let s = on();
    s = setLookup(s, false, 'cloudflare');
    s = on(s);
    s = applyNames(s, names({ session: 2, changes: { [IP]: { state: 'queued' } } }));
    s = applyNames(
      s,
      names({ session: 1, changes: { [IP]: { state: 'confirmed', names: ['late.example'] } } }),
    );
    expect(hostLabel(s, IP)).toBe('Waiting');
    s = applyNames(s, names({ session: 2, changes: { [IP]: { state: 'removed' } } }));
    expect(hostLabel(s, IP)).toBe('late.example');
  });

  it('PRG-12, PRG-13: given log entries and findings from any session of this generation, when applied, then they are kept; an older generation is dropped', () => {
    let s = applySnapshot(on(), snap({ generation: 2 }));
    const entry = {
      queryId: 'q1',
      name: 'x',
      type: 'PTR',
      rcode: 'NXDOMAIN',
      records: [],
      authenticated: false,
      sensitivity: 'sensitive',
      purpose: '',
      durationMs: 1,
      cacheHit: false,
    } as const;
    s = applyNames(
      s,
      names({
        generation: 2,
        session: 1,
        log: [entry],
        findings: [{ id: 'dns.budget-exhausted', severity: 'warning', message: 'm' }],
      }),
    );
    s = applyNames(
      s,
      names({ generation: 1, session: 1, log: [entry], changes: { [IP]: { state: 'none' } } }),
    );
    expect(s.lookup.log).toHaveLength(1);
    expect(s.lookup.findings).toHaveLength(1);
    expect(hostLabel(s, IP)).toBe('Not looked up');
  });

  it('PRG-13: given a late message from the session just turned off, when applied, then it is an ended session: finals only, counts ignored', () => {
    let s = on();
    s = setLookup(s, false, 'cloudflare');
    s = applyNames(
      s,
      names({
        changes: { a: { state: 'queued' }, b: { state: 'none' } },
        counts: { queued: 1, lookingUp: 0, done: 1, targets: 2 },
      }),
    );
    expect([hostLabel(s, 'a'), hostLabel(s, 'b')]).toEqual(['Not looked up', 'No host name']);
    expect(s.lookup.counts).toEqual({ queued: 0, lookingUp: 0, done: 0, targets: 0 });
  });

  it('PRG-12: given counts from the active session, when applied, then they are the ones shown', () => {
    let s = on();
    s = applyNames(s, names({ counts: { queued: 3, lookingUp: 1, done: 4, targets: 8 } }));
    expect(s.lookup.counts).toEqual({ queued: 3, lookingUp: 1, done: 4, targets: 8 });
  });
});

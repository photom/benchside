/** The reading job: queue, steps, snapshots, stop, clear (PRG-1, PRG-3..9, PRG-13..16; design: job.md). */

import { createDnsCache, type DnsCache, type Transport } from '@benchside/dns';
import { Batch, type PolicyConfig, type ReportSummary } from './batch.ts';
import { type Finding, Findings } from './findings.ts';
import { type Budget, type InputKind, newBudget, readInput } from './input.ts';
import { type HostState, LookupSession, type Names } from './reverse.ts';
import type { Focus } from './sources.ts';
import { type Filters, type View, view } from './view.ts';

/** A file to read; the worker wraps a `File` (INP-1, INP-11). */
export interface JobFile {
  /** The relative path for a folder file. */
  readonly name: string;
  readonly size: number;
  readonly fromFolder: boolean;
  read(): Promise<Uint8Array>;
}

export type FileStatus = 'queued' | 'read' | 'skipped' | 'stopped' | 'failed';

export interface FileResult {
  readonly index: number;
  readonly name: string;
  readonly byteLength: number;
  /** Null until the file is read. */
  readonly kind: InputKind | null;
  readonly status: FileStatus;
}

export interface FileStatusChange {
  readonly index: number;
  readonly status: FileStatus;
  readonly kind: InputKind | null;
  readonly reports: number;
  readonly findings: number;
}

export interface BatchChanges {
  readonly filesAdded: readonly FileResult[];
  readonly fileStatus: readonly FileStatusChange[];
  readonly reportsAdded: readonly ReportSummary[];
  readonly findingsAdded: readonly Finding[];
  /** The whole list when it changed since the previous snapshot, else null (REP-11). */
  readonly policies: readonly PolicyConfig[] | null;
}

export interface Progress {
  readonly phase: 'reading' | 'done' | 'stopped';
  readonly bytesRead: number;
  readonly bytesTotal: number;
  readonly filesRead: number;
  readonly filesTotal: number;
  readonly reports: number;
}

export interface Snapshot {
  /** The `view` request it answers, or null (REP-11). */
  readonly id: number | null;
  readonly generation: number;
  readonly filters: Filters;
  readonly focus: Focus | null;
  readonly changes: BatchChanges;
  /** Null when it did not change (PRG-16). */
  readonly view: View | null;
  readonly progress: Progress;
  readonly partial: boolean;
}

const MAX_FILE = 64 * 1024 * 1024;
const MAX_FILES = 20_000;
const SKIPPED_SHOWN = 20;

interface Entry {
  readonly index: number;
  readonly file: JobFile;
  /** The add it came with, for INP-11. */
  readonly add: AddGroup;
  status: FileStatus;
  kind: InputKind | null;
}

interface AddGroup {
  /** Folder files not yet decided. */
  pending: number;
  readonly skipped: string[];
}

/** The state of one generation: Clear starts a new one (PRG-3, PRG-13). */
class Generation {
  readonly findings = new Findings();
  readonly batch: Batch;
  readonly budget: Budget = newBudget();
  readonly entries: Entry[] = [];
  next = 0;
  bytesRead = 0;
  filesRead = 0;
  counted = 0;
  // What the previous snapshot sent (PRG-14, PRG-16).
  sentFiles = 0;
  sentReports = 0;
  sentFindings = 0;
  sentRevision = 0;
  statusChanges: FileStatusChange[] = [];
  lastViewKey = '';
  /** RDNS-6, RDNS-9: one DNS cache and one set of final host states per generation. */
  readonly dnsCache: DnsCache = createDnsCache();
  readonly hostStates = new Map<string, HostState>();

  constructor(
    readonly number: number,
    now: () => number,
  ) {
    this.batch = new Batch(this.findings, { now });
  }
}

const ALL: Filters = { domain: null, reporters: null, days: null };

export type LookupProvider = 'cloudflare' | 'google';

/** RDNS-2: the first 200 rows of the source table as shown; RDNS-1: valid IPs only. */
const MAX_TARGETS = 200;
const targets = (v: View) =>
  v.sources
    .slice(0, MAX_TARGETS)
    .filter((r) => r.validIp)
    .map((r) => r.sourceIp);

export class Job {
  private readonly send: (s: Snapshot) => void;
  private readonly clock: () => number;
  private readonly yieldToEvents: () => Promise<void>;
  private readonly now: () => number;
  private readonly stepMs: number;
  private readonly snapshotMs: number;
  private gen: Generation;
  private phase: Progress['phase'] = 'done';
  private loop: Promise<void> | null = null;
  private stopping = false;
  private filters: Filters = ALL;
  private focus: Focus | null = null;
  /** A view request not yet answered; a newer one replaces it. */
  private pendingView: number | null = null;
  private readonly transport: ((provider: LookupProvider) => Transport) | null;
  private readonly sendNames: (n: Names) => void;
  private readonly lookupFlushMs: number | undefined;
  private lookupSession: LookupSession | null = null;
  /** PRG-13: grows by one each time lookups are turned on, across generations. */
  private sessions = 0;

  constructor(o: {
    readonly send: (s: Snapshot) => void;
    readonly clock?: () => number;
    readonly yieldToEvents?: () => Promise<void>;
    readonly now?: () => number;
    /** Work per step before yielding, in ms (PRG-8). */
    readonly stepMs?: number;
    /** Time between periodic snapshots, in ms (PRG-4). */
    readonly snapshotMs?: number;
    /** The DoH transport for a provider; the app passes it, so this package never fetches (RDNS-1). */
    readonly transport?: (provider: LookupProvider) => Transport;
    /** `names` messages to the UI (PRG-11, PRG-12). */
    readonly sendNames?: (n: Names) => void;
    /** Time between `names` messages (PRG-12); tests pass 0. */
    readonly lookupFlushMs?: number;
  }) {
    this.transport = o.transport ?? null;
    this.sendNames = o.sendNames ?? (() => {});
    this.lookupFlushMs = o.lookupFlushMs;
    this.send = o.send;
    this.clock = o.clock ?? (() => performance.now());
    this.yieldToEvents = o.yieldToEvents ?? (() => new Promise((r) => setTimeout(r, 0)));
    this.now = o.now ?? (() => Math.floor(Date.now() / 1000));
    this.stepMs = o.stepMs ?? 50;
    this.snapshotMs = o.snapshotMs ?? 250;
    this.gen = new Generation(1, this.now);
  }

  /** Settles when the current reading ends. */
  get idle(): Promise<void> {
    return this.loop ?? Promise.resolve();
  }

  /** INP-1, INP-2, INP-11: lists the files, decides what is known without reading, and starts reading. */
  add(files: readonly JobFile[]): void {
    const g = this.gen;
    const room = Math.max(0, MAX_FILES - g.entries.length);
    const group: AddGroup = { pending: 0, skipped: [] };
    for (const file of files.slice(0, room)) {
      const e: Entry = { index: g.entries.length, file, add: group, status: 'queued', kind: null };
      g.entries.push(e);
      const hidden = file.fromFolder && (file.name.split('/').pop() ?? '').startsWith('.');
      if (file.fromFolder && (hidden || file.size > MAX_FILE)) {
        group.skipped.push(file.name);
        this.finish(g, e, 'skipped');
      } else if (file.size > MAX_FILE) {
        g.findings.add({
          id: 'aggregate.input.too-large',
          severity: 'error',
          message: `The file is over 64 MiB; not read.`,
          file: e.index,
          label: file.name,
        });
        this.finish(g, e, 'failed');
      } else if (file.fromFolder) {
        group.pending++;
      }
    }
    if (files.length > room) {
      g.findings.add({
        id: 'aggregate.input.too-many-files',
        severity: 'error',
        message: `More than ${MAX_FILES} files in the batch; ${files.length - room} not read.`,
        file: null,
        label: null,
      });
    }
    this.maybeSkippedFinding(group);
    if (!this.loop) this.loop = this.run(g);
  }

  /** PRG-8: answered after the current step while reading, at once while idle. */
  view(id: number, filters: Filters, focus: Focus | null): void {
    this.filters = filters;
    this.focus = focus;
    if (this.loop) this.pendingView = id;
    else this.send(this.snapshot(id, false));
  }

  /** Settles when the current lookup session has nothing left to do. */
  get lookupIdle(): Promise<void> {
    return this.lookupSession?.idle ?? Promise.resolve();
  }

  /** RDNS-1, RDNS-9: on starts a session with the targets of the table as shown; off ends it. */
  lookup(on: boolean, provider: LookupProvider): void {
    this.lookupSession?.stop();
    this.lookupSession = null;
    if (!on || !this.transport) return;
    const g = this.gen;
    this.lookupSession = new LookupSession({
      number: ++this.sessions,
      generation: g.number,
      transport: this.transport(provider),
      source: provider,
      cache: g.dnsCache,
      finals: g.hostStates,
      send: this.sendNames,
      ...(this.lookupFlushMs === undefined ? {} : { flushMs: this.lookupFlushMs }),
    });
    this.lookupSession.setTargets(targets(view(g.batch, this.filters, this.focus)));
  }

  /** PRG-9 */
  stop(): void {
    if (this.loop) this.stopping = true;
  }

  /** PRG-3, PRG-13: a new, empty generation, announced by one snapshot. */
  clear(): void {
    // PRG-3: Clear stops both jobs; lookups stay off until turned on again.
    this.lookupSession?.stop();
    this.lookupSession = null;
    this.gen = new Generation(this.gen.number + 1, this.now);
    this.loop = null;
    this.stopping = false;
    this.pendingView = null;
    this.phase = 'done';
    this.send(this.snapshot(null, false));
  }

  /** Reads until the queue is empty; an unexpected error still ends the run, then reaches the worker. */
  private async run(g: Generation): Promise<void> {
    try {
      await this.readQueue(g);
    } catch (err) {
      if (this.gen === g) {
        this.loop = null;
        this.pendingView = null;
        this.phase = 'stopped';
        this.send(this.snapshot(null, false));
      }
      throw err;
    }
  }

  private async readQueue(g: Generation): Promise<void> {
    this.phase = 'reading';
    this.stopping = false;
    this.send(this.snapshot(null, true));
    let stepStart = this.clock();
    let lastSnapshot = stepStart;
    let stopped = false;
    files: while (g.next < g.entries.length) {
      const e = g.entries[g.next++] as Entry;
      if (e.status !== 'queued') continue;
      if (this.stopping) {
        stopped = true;
        g.next--;
        break;
      }
      let bytes: Uint8Array;
      try {
        bytes = await e.file.read();
      } catch {
        if (this.gen !== g) return;
        // INP-14: the browser refused the file; the next one is read.
        g.findings.add({
          id: 'aggregate.input.unreadable',
          severity: 'error',
          message: 'The browser could not read the file. It may have been moved or changed.',
          file: e.index,
          label: e.file.name,
        });
        g.bytesRead += e.file.size;
        this.finish(g, e, 'failed');
        this.decided(e);
        continue;
      }
      if (this.gen !== g) return;
      let reports = 0;
      let error = false;
      let skipped = false;
      for await (const ev of readInput({ name: e.file.name, bytes }, g.budget)) {
        if (ev.type === 'kind') {
          e.kind = ev.kind;
          // INP-11: a folder file of unknown type is skipped without a finding.
          if (ev.kind === 'unknown' && e.file.fromFolder) {
            skipped = true;
            break;
          }
        } else if (ev.type === 'document') {
          const s = g.batch.addDocument(ev, e.index);
          if (s) {
            reports++;
            if (s.status === 'counted') g.counted++;
          }
        } else if (ev.type === 'finding') {
          if (ev.finding.severity === 'error') error = true;
          g.findings.add({ ...ev.finding, file: e.index });
        } else if (this.clock() - stepStart >= this.stepMs) {
          await this.yieldToEvents();
          if (this.gen !== g) return;
          stepStart = this.clock();
          if (this.pendingView !== null) {
            const id = this.pendingView;
            this.pendingView = null;
            this.send(this.snapshot(id, true));
            lastSnapshot = this.clock();
          }
          if (this.stopping) {
            stopped = true;
            g.next--;
            break files;
          }
          if (this.clock() - lastSnapshot >= this.snapshotMs) {
            this.send(this.snapshot(null, true));
            lastSnapshot = this.clock();
          }
        }
      }
      g.bytesRead += e.file.size;
      if (skipped) {
        e.add.skipped.push(e.file.name);
        this.finish(g, e, 'skipped');
      } else {
        this.finish(g, e, error && reports === 0 ? 'failed' : 'read', reports);
      }
      this.decided(e);
    }
    if (stopped) {
      for (let i = g.next; i < g.entries.length; i++) {
        const e = g.entries[i] as Entry;
        if (e.status !== 'queued') continue;
        this.finish(g, e, 'stopped');
        this.decided(e);
      }
      g.next = g.entries.length;
    }
    this.phase = stopped ? 'stopped' : 'done';
    this.loop = null;
    this.pendingView = null;
    this.send(this.snapshot(null, false));
  }

  /** A final status, with the counts of REP-1. */
  private finish(g: Generation, e: Entry, status: FileStatus, reports = 0): void {
    e.status = status;
    g.filesRead++;
    g.statusChanges.push({
      index: e.index,
      status,
      kind: e.kind,
      reports,
      findings: g.findings.countFor(e.index),
    });
  }

  /** A queued folder file was read, skipped, failed, or stopped (INP-11). */
  private decided(e: Entry): void {
    if (!e.file.fromFolder) return;
    e.add.pending--;
    this.maybeSkippedFinding(e.add);
  }

  /** INP-11: one finding per add, once its folder files are all decided. */
  private maybeSkippedFinding(group: AddGroup): void {
    if (group.pending > 0 || group.skipped.length === 0) return;
    const n = group.skipped.length;
    const shown = group.skipped.slice(0, SKIPPED_SHOWN).join(', ');
    this.gen.findings.add({
      id: 'aggregate.input.skipped',
      severity: 'info',
      message: `${n} file${n === 1 ? '' : 's'} from folders skipped (hidden, too large, or not a report): ${shown}${n > SKIPPED_SHOWN ? ', …' : ''}`,
      file: null,
      label: null,
    });
    group.skipped.length = 0;
  }

  private snapshot(id: number | null, partial: boolean): Snapshot {
    const g = this.gen;
    const progress: Progress = {
      phase: this.phase,
      bytesRead: g.bytesRead,
      bytesTotal: g.entries.reduce((n, e) => n + e.file.size, 0),
      filesRead: g.filesRead,
      filesTotal: g.entries.length,
      reports: g.counted,
    };
    const revision = g.batch.policyRevision;
    const changes: BatchChanges = {
      filesAdded: g.entries.slice(g.sentFiles).map((e) => ({
        index: e.index,
        name: e.file.name,
        byteLength: e.file.size,
        kind: e.kind,
        status: e.status,
      })),
      fileStatus: g.statusChanges,
      reportsAdded: g.batch.reports.slice(g.sentReports),
      findingsAdded: g.findings.list.slice(g.sentFindings),
      policies: revision !== g.sentRevision ? g.batch.policies() : null,
    };
    g.sentFiles = g.entries.length;
    g.sentReports = g.batch.reports.length;
    g.sentFindings = g.findings.list.length;
    g.sentRevision = revision;
    g.statusChanges = [];
    const key = JSON.stringify([
      g.counted,
      this.filters,
      this.focus,
      partial,
      g.filesRead,
      g.entries.length,
    ]);
    const fresh = id !== null || !partial || key !== g.lastViewKey;
    g.lastViewKey = key;
    const computed = fresh ? view(g.batch, this.filters, this.focus) : null;
    // RDNS-2: every computed View gives the lookup session its targets.
    if (computed) this.lookupSession?.setTargets(targets(computed));
    return {
      id,
      generation: g.number,
      filters: this.filters,
      focus: this.focus,
      changes,
      view: computed,
      progress,
      partial,
    };
  }
}

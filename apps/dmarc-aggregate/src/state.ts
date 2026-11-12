/** What the UI holds between snapshots (PRG-13..16; design: ui.md, App structure). */
import type {
  BudgetFinding,
  FileResult,
  Filters,
  Finding,
  Focus,
  HostState,
  LookupProvider,
  Names,
  PolicyConfig,
  Progress,
  ReportSummary,
  Snapshot,
  View,
} from '@benchside/dmarc-aggregate';
import type { DnsLogEntry } from '@benchside/dns';

export interface FileRow extends FileResult {
  /** Set once the status is final (REP-1). */
  readonly reports?: number;
  readonly findings?: number;
}

type Final = Exclude<HostState, { state: 'queued' | 'looking-up' | 'removed' }>;

/** What the UI knows about one source IP (ui.md, Host names in state.ts). */
export interface HostEntry {
  readonly current?: { readonly state: 'queued' | 'looking-up'; readonly session: number };
  readonly final?: { readonly state: Final; readonly session: number };
}

export interface LookupState {
  readonly on: boolean;
  readonly provider: LookupProvider;
  /**
   * The active session while `on`. The worker numbers sessions by counting each "lookup on"
   * from page load (PRG-13), and the UI sends every one, so counting here gives the same number.
   */
  readonly session: number;
  readonly counts: Names['counts'];
  readonly hosts: Readonly<Record<string, HostEntry>>;
  readonly log: readonly DnsLogEntry[];
  readonly findings: readonly BudgetFinding[];
}

export interface UiState {
  readonly generation: number;
  readonly files: readonly FileRow[];
  readonly reports: readonly ReportSummary[];
  readonly findings: readonly Finding[];
  readonly policies: readonly PolicyConfig[];
  readonly progress: Progress | null;
  /** The current choices; a `View` is shown only when it was made for them. */
  readonly filters: Filters;
  readonly focus: Focus | null;
  /** The `View` shown, with what the partial label needs from its snapshot (PRG-15). */
  readonly lookup: LookupState;
  readonly shown: {
    readonly view: View;
    readonly partial: boolean;
    readonly filesRead: number;
    readonly filesTotal: number;
  } | null;
}

export const ALL_FILTERS: Filters = { domain: null, reporters: null, days: null };

const initialLookup = (provider: LookupProvider = 'cloudflare'): LookupState => ({
  on: false,
  provider,
  session: 0,
  counts: { queued: 0, lookingUp: 0, done: 0, targets: 0 },
  hosts: {},
  log: [],
  findings: [],
});

export function initialState(): UiState {
  return {
    generation: 1,
    files: [],
    reports: [],
    findings: [],
    policies: [],
    progress: null,
    filters: ALL_FILTERS,
    focus: null,
    lookup: initialLookup(),
    shown: null,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function setFilters(s: UiState, filters: Filters, focus: Focus | null): UiState {
  return { ...s, filters, focus };
}

/** PRG-13 to PRG-16. */
export function applySnapshot(s: UiState, snap: Snapshot): UiState {
  if (snap.generation < s.generation) return s;
  const base: UiState =
    snap.generation > s.generation
      ? {
          ...initialState(),
          generation: snap.generation,
          filters: s.filters,
          focus: s.focus,
          // PRG-3: Clear ends lookups; the provider choice stays.
          lookup: { ...initialLookup(s.lookup.provider), session: s.lookup.session },
        }
      : s;
  const c = snap.changes;
  let files = base.files;
  if (c.filesAdded.length > 0 || c.fileStatus.length > 0) {
    const next: FileRow[] = [...files, ...c.filesAdded];
    for (const ch of c.fileStatus) {
      const f = next[ch.index];
      if (f) {
        next[ch.index] = {
          ...f,
          status: ch.status,
          kind: ch.kind,
          reports: ch.reports,
          findings: ch.findings,
        };
      }
    }
    files = next;
  }
  const matches = same(snap.filters, base.filters) && same(snap.focus, base.focus);
  return {
    ...base,
    files,
    reports: c.reportsAdded.length > 0 ? [...base.reports, ...c.reportsAdded] : base.reports,
    findings: c.findingsAdded.length > 0 ? [...base.findings, ...c.findingsAdded] : base.findings,
    policies: c.policies ?? base.policies,
    progress: snap.progress,
    shown:
      snap.view && matches
        ? {
            view: snap.view,
            partial: snap.partial,
            filesRead: snap.progress.filesRead,
            filesTotal: snap.progress.filesTotal,
          }
        : base.shown,
  };
}

/** PRG-15: follows the `View` shown, not the newest progress. */
export function partialLabel(s: UiState): string | null {
  const v = s.shown;
  return v?.partial ? `Partial: ${v.filesRead} of ${v.filesTotal} files` : null;
}

const isFinal = (h: HostState): h is Final =>
  h.state === 'confirmed' || h.state === 'unconfirmed' || h.state === 'none' || h.state === 'error';

/** `removed` or lookups off: `current` goes and the final state, if any, shows again (PRG-13). */
const release = (e: HostEntry): HostEntry => (e.final ? { final: e.final } : {});

/** RDNS-1, RDNS-9; PRG-13: off clears every `current` at once. */
export function setLookup(s: UiState, on: boolean, provider: LookupProvider): UiState {
  const l = s.lookup;
  if (on) return { ...s, lookup: { ...l, on: true, provider, session: l.session + 1 } };
  const hosts: Record<string, HostEntry> = {};
  for (const [ip, e] of Object.entries(l.hosts)) hosts[ip] = release(e);
  return { ...s, lookup: { ...l, on: false, provider, hosts, counts: initialLookup().counts } };
}

/** PRG-11..13 */
export function applyNames(s: UiState, n: Names): UiState {
  if (n.generation < s.generation) return s;
  const l = s.lookup;
  const active = l.on && n.session === l.session;
  const hosts: Record<string, HostEntry> = { ...l.hosts };
  for (const [ip, h] of Object.entries(n.changes)) {
    const e = hosts[ip] ?? {};
    if (active) {
      if (h.state === 'queued' || h.state === 'looking-up') {
        hosts[ip] = { ...e, current: { state: h.state, session: n.session } };
      } else if (h.state === 'removed') {
        hosts[ip] = release(e);
      } else {
        hosts[ip] = { final: { state: h, session: n.session } };
      }
      continue;
    }
    // An ended session: final states only, where no newer session has a final state. A newer
    // queued or looking-up still shows first, so the final waits behind it until it is removed.
    if (!isFinal(h) || (e.final && e.final.session > n.session)) continue;
    hosts[ip] = { ...e, final: { state: h, session: n.session } };
  }
  return {
    ...s,
    lookup: {
      ...l,
      counts: active ? n.counts : l.counts,
      hosts,
      log: n.log.length > 0 ? [...l.log, ...n.log] : l.log,
      findings: n.findings.length > 0 ? [...l.findings, ...n.findings] : l.findings,
    },
  };
}

/** The host name cell (ui.md, Progress: Host name cells; RDNS-5). */
export function hostLabel(s: UiState, ip: string): string {
  const e = s.lookup.hosts[ip];
  if (e?.current) return e.current.state === 'queued' ? 'Waiting' : 'Looking up';
  const f = e?.final?.state;
  if (!f) return 'Not looked up';
  if (f.state === 'confirmed') return f.names.join(', ');
  if (f.state === 'unconfirmed') return `${f.names.join(', ')} (not confirmed)`;
  if (f.state === 'none') return 'No host name';
  return `Lookup failed (${f.rcode})`;
}

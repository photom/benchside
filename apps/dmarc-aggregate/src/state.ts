/** What the UI holds between snapshots (PRG-13..16; design: ui.md, App structure). */
import type {
  FileResult,
  Filters,
  Finding,
  Focus,
  PolicyConfig,
  Progress,
  ReportSummary,
  Snapshot,
  View,
} from '@benchside/dmarc-aggregate';

export interface FileRow extends FileResult {
  /** Set once the status is final (REP-1). */
  readonly reports?: number;
  readonly findings?: number;
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
  readonly shown: {
    readonly view: View;
    readonly partial: boolean;
    readonly filesRead: number;
    readonly filesTotal: number;
  } | null;
}

export const ALL_FILTERS: Filters = { domain: null, reporters: null, days: null };

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
      ? { ...initialState(), generation: snap.generation, filters: s.filters, focus: s.focus }
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

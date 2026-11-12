/** The finding list of a batch (REP-7, REP-8). */
import type { FormatFinding } from './format/read.ts';
import type { InputFinding } from './input.ts';

export type FindingId =
  | InputFinding['id']
  | FormatFinding['id']
  | 'aggregate.input.too-many-files'
  | 'aggregate.input.skipped'
  | 'aggregate.input.unreadable'
  | 'aggregate.filename.mismatch'
  | 'aggregate.report.duplicate'
  | 'aggregate.report.conflict'
  | 'aggregate.report.overlap'
  | 'aggregate.record.inconsistent'
  | 'aggregate.record.no-reason'
  | 'aggregate.report.long-range'
  | 'aggregate.report.future'
  | 'aggregate.report.error'
  | 'aggregate.policy.changed'
  | 'aggregate.too-many-findings';

export interface Finding {
  readonly id: FindingId;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  /** The top-level file being read when it was found, or null for findings about many files (REP-7). */
  readonly file: number | null;
  /** The label of the part it is about (INP-7). */
  readonly label: string | null;
  readonly report?: number;
  readonly record?: number;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
}

/** Keeps findings in the order found, up to a limit, then one `too-many-findings` (REP-8). */
export class Findings {
  private readonly items: Finding[] = [];
  private readonly perFile = new Map<number, number>();

  constructor(private readonly limit = 10_000) {}

  get list(): readonly Finding[] {
    return this.items;
  }

  add(f: Finding): void {
    if (this.items.length > this.limit) return;
    if (this.items.length === this.limit) {
      this.items.push({
        id: 'aggregate.too-many-findings',
        severity: 'warning',
        message: `More than ${this.limit} findings. Later findings are not shown.`,
        file: null,
        label: null,
      });
      return;
    }
    this.items.push(f);
    if (f.file !== null) this.perFile.set(f.file, (this.perFile.get(f.file) ?? 0) + 1);
  }

  /** Findings kept for one file (REP-1). */
  countFor(file: number): number {
    return this.perFile.get(file) ?? 0;
  }
}

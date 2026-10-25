import type { ArcNotEvaluatedReason, ArcReport, ArcResult } from '../arc/verify.ts';
import type { DkimResult, DkimSignatureResult } from '../dkim/verify.ts';
import type { SpfNotEvaluatedReason, SpfResult, SpfResults } from '../spf/evaluate.ts';

type CouldNotRun = 'internal-error' | 'invalid-input';

/** One line per method (report spec, Summary). */
export interface SummaryLine {
  readonly method: 'spf' | 'dkim' | 'arc';
  /** A method result, or `none` when there is nothing to evaluate. */
  readonly result: SpfResult | DkimResult | ArcResult;
  /** Why the method is not-evaluated (SUM-1, SUM-2, SUM-5). */
  readonly reason?: CouldNotRun | ArcNotEvaluatedReason | SpfNotEvaluatedReason;
  /** DKIM: signatures per result, in precedence order. ARC: `sets`. */
  readonly counts: Readonly<Record<string, number>>;
}

/** SUM-2: precedence, highest first. DKIM itself never yields `neutral`. */
const DKIM_PRECEDENCE: readonly DkimResult[] = [
  'pass',
  'fail',
  'permerror',
  'temperror',
  'not-evaluated',
];

/** SUM-1: the MAIL FROM identity's result. */
export function summarizeSpf(results: SpfResults): SummaryLine {
  const { result, reason } = results.mailFrom;
  return { method: 'spf', result, ...(reason ? { reason } : {}), counts: {} };
}

/** SUM-5: the chain result, and the number of sets when there are any. */
export function summarizeArc(report: ArcReport): SummaryLine {
  return {
    method: 'arc',
    result: report.result,
    ...(report.reason ? { reason: report.reason } : {}),
    counts: report.sets.length > 0 ? { sets: report.sets.length } : {},
  };
}

export function summarizeDkim(
  results: readonly DkimSignatureResult[],
  couldNotRun?: CouldNotRun,
): SummaryLine {
  if (couldNotRun) {
    return { method: 'dkim', result: 'not-evaluated', reason: couldNotRun, counts: {} };
  }
  const counts: Record<string, number> = {};
  for (const result of DKIM_PRECEDENCE) {
    const n = results.filter((r) => r.result === result).length;
    if (n > 0) counts[result] = n;
  }
  const result = DKIM_PRECEDENCE.find((p) => (counts[p] ?? 0) > 0) ?? 'none';
  return { method: 'dkim', result, counts };
}

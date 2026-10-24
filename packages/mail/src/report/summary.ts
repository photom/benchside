import type { DkimResult, DkimSignatureResult } from '../dkim/verify.ts';

/** One line per method (report spec, Summary). */
export interface SummaryLine {
  readonly method: 'dkim';
  /** A method result, or `none` when there is nothing to evaluate. */
  readonly result: DkimResult | 'none';
  /** Why the method could not run at all (SUM-2). */
  readonly reason?: 'internal-error' | 'invalid-input';
  /** Number of signatures per result, in precedence order. */
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

export function summarizeDkim(
  results: readonly DkimSignatureResult[],
  couldNotRun?: 'internal-error' | 'invalid-input',
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

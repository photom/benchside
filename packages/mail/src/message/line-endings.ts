import type { Evidence, Finding } from '../shared/findings.ts';

export interface Normalized {
  /** CRLF wherever the input had a bare LF (IN-7). The input itself when nothing changed. */
  readonly bytes: Uint8Array;
  readonly findings: readonly Finding[];
  /** Maps an offset in `bytes` to an offset in the original input (IN-8). */
  toOriginal(offset: number): number;
}

const CR = 0x0d;
const LF = 0x0a;
const MAX_BARE_CR_EVIDENCE = 100; // IN-13

/**
 * Converts bare LF to CRLF: one pass finds the bare LFs, a second copies the
 * segments between them with native `set` (design: message.md).
 */
export function normalizeLineEndings(input: Uint8Array): Normalized {
  const bareLfs: number[] = [];
  let crlf = 0;
  for (let i = input.indexOf(LF); i >= 0; i = input.indexOf(LF, i + 1)) {
    if (i > 0 && input[i - 1] === CR) crlf++;
    else bareLfs.push(i);
  }
  const bareCr: Evidence[] = [];
  for (let i = input.indexOf(CR); i >= 0 && bareCr.length < MAX_BARE_CR_EVIDENCE; ) {
    if (input[i + 1] !== LF) bareCr.push({ kind: 'bytes', range: { start: i, end: i + 1 } });
    i = input.indexOf(CR, i + 1);
  }

  const findings: Finding[] = [];
  const first = bareLfs[0];
  if (first !== undefined) {
    const mixed = crlf > 0;
    findings.push({
      id: mixed ? 'input.line-endings-mixed' : 'input.lf-converted',
      severity: 'warning',
      message: mixed
        ? 'The message mixes CRLF and bare LF line endings. Bare LFs were converted to CRLF, so hashes may differ from the signer’s.'
        : 'The message uses bare LF line endings. They were converted to CRLF, so hashes may differ from the signer’s.',
      evidence: [{ kind: 'bytes', range: { start: first, end: first + 1 } }],
    });
  }
  if (bareCr.length > 0) {
    findings.push({
      id: 'input.bare-cr',
      severity: 'warning',
      message: 'The message has a CR that is not followed by LF. It was kept as is.',
      evidence: bareCr,
    });
  }
  if (bareLfs.length === 0) return { bytes: input, findings, toOriginal: (o) => o };

  const bytes = new Uint8Array(input.length + bareLfs.length);
  /** Normalized offsets of the inserted CRs, ascending. */
  const inserted = new Int32Array(bareLfs.length);
  let from = 0;
  for (const [k, lf] of bareLfs.entries()) {
    bytes.set(input.subarray(from, lf), from + k);
    inserted[k] = lf + k;
    bytes[lf + k] = CR;
    from = lf; // the LF itself is copied with the next segment
  }
  bytes.set(input.subarray(from), from + bareLfs.length);
  return {
    bytes,
    findings,
    // An inserted CR maps to the LF after it: subtract the insertions strictly before `offset`.
    toOriginal: (offset) => offset - countBelow(inserted, offset),
  };
}

/** Number of values in the sorted array that are < limit (binary search). */
function countBelow(sorted: Int32Array, limit: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

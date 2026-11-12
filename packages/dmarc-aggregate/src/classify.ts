/** Facts, delivery path, and cause of one record (docs/reference/dmarc-aggregate/classify.md). */
import type { ReadRecord } from './format/read.ts';

export type Path = 'direct' | 'forwarded' | 'other';
export type PathRule = 'PATH-1' | 'PATH-2' | 'PATH-3' | 'PATH-4' | 'PATH-5';
export type Cause =
  | 'reported-forwarding'
  | 'dkim-broken'
  | 'spf-broken-by-forwarding'
  | 'spf-not-aligned'
  | 'dkim-not-aligned'
  | 'temporary-error'
  | 'permanent-error'
  | 'no-dkim'
  | 'unauthenticated';

export interface Facts {
  /** FCT-1 */
  readonly dmarc: 'pass' | 'fail';
  /** FCT-3 */
  readonly dkim: {
    readonly aligned: boolean;
    readonly relatedPass: boolean;
    readonly relatedFail: boolean;
    readonly otherPass: boolean;
    readonly temperror: boolean;
    readonly permerror: boolean;
    readonly none: boolean;
  };
  /** FCT-4: `result` is the raw result of the SPF result FMT-9 chose, or null when there is none. */
  readonly spf: {
    readonly aligned: boolean;
    readonly result: string | null;
    readonly related: boolean;
  };
  /** FCT-5 */
  readonly forwardingReason: boolean;
  /** FCT-7; null for DMARC-passing records, which do not use it. */
  readonly forwarderIp: boolean | null;
}

export interface Classification {
  readonly dmarc: 'pass' | 'fail';
  readonly path: Path;
  readonly pathRule: PathRule;
  readonly cause: Cause | null;
  readonly causeRule: string | null;
  readonly alsoMatches: readonly Cause[];
  readonly facts: Facts;
}

const FORWARDING = new Set(['forwarded', 'trusted_forwarder', 'mailing_list']);

/** FCT-2: equal, a subdomain, or a parent, by whole labels. */
function related(d: string, of: string | null): boolean {
  if (!d || !of) return false;
  return d === of || d.endsWith(`.${of}`) || of.endsWith(`.${d}`);
}

/** FCT-1..5, FCT-7: what the record says. Domains come normalized by FMT-14. */
export function recordFacts(
  r: ReadRecord,
  policyDomain: string,
  forwarder: (ip: string) => boolean,
): Facts {
  const rel = (d: string) => related(d, r.headerFrom) || related(d, policyDomain);
  const dmarc = r.dkim === 'pass' || r.spf === 'pass' ? 'pass' : 'fail';
  const used = r.spfResults.find((s) => s.used) ?? null;
  return {
    dmarc,
    dkim: {
      aligned: r.dkim === 'pass',
      relatedPass: r.dkimResults.some((d) => d.result === 'pass' && rel(d.domain)),
      relatedFail: r.dkimResults.some((d) => d.result === 'fail' && rel(d.domain)),
      otherPass: r.dkimResults.some((d) => d.result === 'pass' && !rel(d.domain)),
      temperror: r.dkimResults.some((d) => d.result === 'temperror'),
      permerror: r.dkimResults.some((d) => d.result === 'permerror'),
      none: r.dkimResults.every((d) => d.result === 'none'),
    },
    spf: {
      aligned: r.spf === 'pass',
      result: used ? used.result : null,
      related: used ? rel(used.domain) : false,
    },
    forwardingReason: r.reasons.some((x) => FORWARDING.has(x.type)),
    forwarderIp: dmarc === 'pass' ? null : forwarder(r.sourceIp),
  };
}

/** FCT-6: methods aligned as `pass` with no raw `pass` of that method. */
export function inconsistent(r: ReadRecord): ('dkim' | 'spf')[] {
  const out: ('dkim' | 'spf')[] = [];
  if (r.dkim === 'pass' && !r.dkimResults.some((d) => d.result === 'pass')) out.push('dkim');
  if (r.spf === 'pass' && !r.spfResults.some((s) => s.result === 'pass')) out.push('spf');
  return out;
}

/** CAUSE-1..9 in order: rule, cause, path, condition. */
const CAUSES: readonly (readonly [string, Cause, Path, (f: Facts) => boolean])[] = [
  ['CAUSE-1', 'reported-forwarding', 'forwarded', (f) => f.forwardingReason],
  ['CAUSE-2', 'dkim-broken', 'forwarded', (f) => f.dkim.relatedFail],
  ['CAUSE-3', 'spf-broken-by-forwarding', 'forwarded', (f) => f.forwarderIp === true],
  ['CAUSE-4', 'spf-not-aligned', 'direct', (f) => f.spf.result === 'pass'],
  ['CAUSE-5', 'dkim-not-aligned', 'direct', (f) => f.dkim.relatedPass || f.dkim.otherPass],
  ['CAUSE-6', 'temporary-error', 'other', (f) => f.spf.result === 'temperror' || f.dkim.temperror],
  ['CAUSE-7', 'permanent-error', 'other', (f) => f.spf.result === 'permerror' || f.dkim.permerror],
  ['CAUSE-8', 'no-dkim', 'other', (f) => f.dkim.none],
  ['CAUSE-9', 'unauthenticated', 'other', () => true],
];

/** PATH-1..5 and CAUSE-1..10 from the facts alone. Host names are never an input (CAUSE-11). */
export function classify(facts: Facts): Classification {
  if (facts.dmarc === 'pass') {
    const pathRule: PathRule = facts.spf.aligned
      ? 'PATH-1'
      : facts.forwardingReason
        ? 'PATH-2'
        : facts.spf.result === 'fail' || facts.spf.result === 'softfail'
          ? 'PATH-3'
          : 'PATH-4';
    const path = pathRule === 'PATH-2' || pathRule === 'PATH-3' ? 'forwarded' : 'direct';
    return { dmarc: 'pass', path, pathRule, cause: null, causeRule: null, alsoMatches: [], facts };
  }
  const hits = CAUSES.filter(([, , , when]) => when(facts));
  const [rule, cause, path] = hits[0] as (typeof CAUSES)[number];
  return {
    dmarc: 'fail',
    path,
    pathRule: 'PATH-5',
    cause,
    causeRule: rule,
    alsoMatches: hits.slice(1).map(([, c]) => c),
    facts,
  };
}

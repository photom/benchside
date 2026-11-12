/** What the filtered set says about enforcing each policy domain (ENF-1..7; design: view.md). */
import type { PolicyConfig } from './batch.ts';
import type { Cause, Path } from './classify.ts';
import type { Policy, ReadRecord } from './format/read.ts';
import { bump, type Item, mainCause } from './sources.ts';

export type EnforcementStatus = 'no-data' | 'fix-direct' | 'add-dkim' | 'check-forwarded' | 'clear';

export interface DomainEnforcement {
  readonly domain: string;
  /** ENF-1: the configuration in effect (CMB-8). */
  readonly policy: {
    readonly p: string | null;
    readonly sp: string | null;
    readonly np: string | null;
    readonly testing: string | null;
    readonly pct: number | null;
  } | null;
  /** ENF-3: one entry per path; `share` is failing over the path's messages, null when it has none. */
  readonly failing: readonly {
    readonly path: Path;
    readonly acted: number;
    readonly notActed: number;
    readonly share: number | null;
  }[];
  /** ENF-4 */
  readonly directSources: readonly {
    readonly sourceIp: string;
    readonly messages: number;
    readonly cause: Cause | null;
    readonly spfDomains: readonly string[];
    readonly dkimDomains: readonly string[];
  }[];
  /** ENF-5 */
  readonly spfOnly: {
    readonly messages: number;
    readonly share: number | null;
    readonly sources: readonly { readonly sourceIp: string; readonly messages: number }[];
  };
  /** ENF-6: `type` null is "no reason". */
  readonly overrides: readonly { readonly type: string | null; readonly messages: number }[];
  /** ENF-7 */
  readonly status: EnforcementStatus;
  /** The period of the domain's dated reports in the filtered set (CMB-9). */
  readonly period: { readonly begin: number; readonly end: number } | null;
}

const PATHS: readonly Path[] = ['direct', 'forwarded', 'other'];
/** ENF-6: weak to strong. */
const RANK: Readonly<Record<string, number>> = { none: 0, pass: 0, quarantine: 1, reject: 2 };

/** ENF-2: the policy value that applies to the record; a value not stated counts as `none`. */
export function appliedPolicy(r: ReadRecord, policy: Policy): string {
  const own = r.headerFrom === policy.domain;
  return (own ? policy.p : (policy.sp ?? policy.p)) ?? 'none';
}

/** ENF-6: a failing record whose disposition is weaker than the policy of its own report. */
export function weakerThanPolicy(r: ReadRecord, policy: Policy): boolean {
  if (r.disposition === null) return false;
  const got = RANK[r.disposition];
  const want = RANK[appliedPolicy(r, policy)];
  return got !== undefined && want !== undefined && got < want;
}

interface DirectAcc {
  messages: number;
  readonly byCause: Map<Cause, number>;
  readonly spf: Set<string>;
  readonly dkim: Set<string>;
}

/** ENF-1..7 for one policy domain over its records in the filtered set. */
export function domainEnforcement(
  domain: string,
  items: readonly Item[],
  config: PolicyConfig | undefined,
): DomainEnforcement {
  let messages = 0;
  let passing = 0;
  const pathMessages: Record<Path, number> = { direct: 0, forwarded: 0, other: 0 };
  const acted: Record<Path, number> = { direct: 0, forwarded: 0, other: 0 };
  const notActed: Record<Path, number> = { direct: 0, forwarded: 0, other: 0 };
  const direct = new Map<string, DirectAcc>();
  let spfOnly = 0;
  const spfOnlySources = new Map<string, number>();
  const overrides = new Map<string | null, number>();
  let begin: number | null = null;
  let end: number | null = null;
  const seen = new Set<number>();

  for (const { record: r, cls, report } of items) {
    const s = report.summary;
    if (!seen.has(s.index)) {
      seen.add(s.index);
      if (s.day !== null && s.begin !== null && s.end !== null) {
        if (begin === null || s.begin < begin) begin = s.begin;
        if (end === null || s.end > end) end = s.end;
      }
    }
    const n = r.count;
    messages += n;
    pathMessages[cls.path] += n;
    if (cls.dmarc === 'pass') {
      passing += n;
      if (r.spf === 'pass' && r.dkim !== 'pass') {
        spfOnly += n;
        bump(spfOnlySources, r.sourceIp, n);
      }
      continue;
    }
    if (r.disposition === 'quarantine' || r.disposition === 'reject') acted[cls.path] += n;
    else notActed[cls.path] += n;
    if (cls.path === 'direct') {
      let d = direct.get(r.sourceIp);
      if (!d) {
        d = { messages: 0, byCause: new Map(), spf: new Set(), dkim: new Set() };
        direct.set(r.sourceIp, d);
      }
      d.messages += n;
      if (cls.cause) bump(d.byCause, cls.cause, n);
      for (const x of r.spfResults) d.spf.add(x.domain);
      for (const x of r.dkimResults) d.dkim.add(x.domain);
    }
    if (weakerThanPolicy(r, report.report.policy)) {
      const types = [...new Set(r.reasons.map((x) => x.type))];
      if (types.length === 0) bump(overrides, null, n);
      for (const t of types) bump(overrides, t, n);
    }
  }

  const failing = PATHS.map((path) => ({
    path,
    acted: acted[path],
    notActed: notActed[path],
    share: pathMessages[path] > 0 ? (acted[path] + notActed[path]) / pathMessages[path] : null,
  }));
  const directSources = [...direct]
    .map(([sourceIp, d]) => ({
      sourceIp,
      messages: d.messages,
      cause: mainCause(d.byCause),
      spfDomains: [...d.spf],
      dkimDomains: [...d.dkim],
    }))
    .sort((a, b) => b.messages - a.messages);
  const status: EnforcementStatus =
    messages === 0
      ? 'no-data'
      : directSources.length > 0
        ? 'fix-direct'
        : spfOnly > 0
          ? 'add-dkim'
          : failing[1] && failing[1].acted + failing[1].notActed > 0
            ? 'check-forwarded'
            : 'clear';
  return {
    domain,
    policy: config
      ? { p: config.p, sp: config.sp, np: config.np, testing: config.testing, pct: config.pct }
      : null,
    failing,
    directSources,
    spfOnly: {
      messages: spfOnly,
      share: passing > 0 ? spfOnly / passing : null,
      sources: [...spfOnlySources]
        .map(([sourceIp, m]) => ({ sourceIp, messages: m }))
        .sort((a, b) => b.messages - a.messages),
    },
    overrides: [...overrides].map(([type, m]) => ({ type, messages: m })),
    status,
    period: begin === null || end === null ? null : { begin, end },
  };
}

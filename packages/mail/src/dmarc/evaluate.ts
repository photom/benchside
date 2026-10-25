/**
 * DMARC evaluation (docs/reference/mail/dmarc.md; design: mail-design/dmarc.md).
 * Modes rfc9989 and rfc7489, each on its own (DMARC-27). Never throws on input.
 */
import type { DkimNotEvaluatedReason, DkimSignatureResult } from '../dkim/verify.ts';
import type { DnsAnswer, DnsQuery } from '../dns/types.ts';
import type { HeaderField } from '../message/headers.ts';
import { organizationalDomain, type PublicSuffixList } from '../psl/lookup.ts';
import { guard } from '../shared/abort.ts';
import { isDomainName } from '../shared/domain.ts';
import type { Evidence, Finding, Severity } from '../shared/findings.ts';
import type { SpfNotEvaluatedReason, SpfResults } from '../spf/evaluate.ts';
import { addressDomains } from './author.ts';
import { discover7489 } from './discover-rfc7489.ts';
import { treeWalk, type Walk, type WalkContext } from './discover-rfc9989.ts';

export type DmarcMode = 'rfc9989' | 'rfc7489';
export type DmarcResult = 'pass' | 'fail' | 'none' | 'temperror' | 'permerror' | 'not-evaluated';
export type DmarcPolicy = 'none' | 'quarantine' | 'reject';
/** REP-5; DMARC-24 passes on the reason of an SPF or DKIM input. */
export type DmarcNotEvaluatedReason =
  | 'invalid-input'
  | 'offline'
  | 'sensitive-query-blocked'
  | 'timeout'
  | 'internal-error'
  | SpfNotEvaluatedReason
  | DkimNotEvaluatedReason;

export interface AlignmentRow {
  readonly identifier: 'spf' | 'dkim';
  readonly domain: string;
  readonly authResult: string;
  readonly mode: 'strict' | 'relaxed';
  readonly orgDomain?: string;
  readonly aligned: boolean;
  readonly counts: boolean;
}

export interface WeightedDisposition {
  readonly disposition: DmarcPolicy;
  readonly weight: number;
}

export interface DmarcModeResult {
  readonly result: DmarcResult;
  readonly reason?: DmarcNotEvaluatedReason;
  readonly authorDomain?: string;
  readonly recordAt?: string;
  readonly record?: string;
  readonly orgDomain?: string;
  readonly orgDomainRule?: string;
  /** DMARC-17: the policy as written, before `t=y` lowers it. */
  readonly declaredPolicy?: DmarcPolicy;
  readonly policy?: DmarcPolicy;
  readonly policySource?: 'p' | 'sp' | 'np';
  readonly testing: boolean;
  readonly disposition?: DmarcPolicy;
  /** DMARC-18: `rfc7489` with `pct` below 100 and result `fail`. */
  readonly dispositions?: readonly WeightedDisposition[];
  /** DMARC-7: the PSL snapshot's `VERSION` (`rfc7489`). */
  readonly pslVersion?: string;
  /** DMARC-3: each author domain's own result, when there are several (`rfc7489`). */
  readonly perDomain?: readonly DmarcModeResult[];
  readonly alignment: readonly AlignmentRow[];
  readonly queryIds: readonly string[];
  readonly findings: readonly Finding[];
}

/** REP-6: present for the selected modes. */
export interface DmarcResults {
  readonly rfc9989?: DmarcModeResult;
  readonly rfc7489?: DmarcModeResult;
}

export interface DmarcContext {
  readonly headers: readonly HeaderField[];
  readonly spf: SpfResults;
  readonly dkim: readonly DkimSignatureResult[];
  /** DMARC-24: DKIM could not run at all (REP-7). */
  readonly dkimUnavailable?: 'internal-error';
  readonly resolve: (query: DnsQuery, signal: AbortSignal) => Promise<DnsAnswer>;
  readonly signal: AbortSignal;
  /** DMARC-27; default both. */
  readonly modes?: readonly DmarcMode[];
  /** Required for `rfc7489` (DMARC-7). */
  readonly psl?: PublicSuffixList;
}

/** DMARC-10: tags defined per mode. */
const COMMON_TAGS = ['v', 'p', 'sp', 'adkim', 'aspf', 'rua', 'ruf', 'fo'];
const TAGS: Record<DmarcMode, ReadonlySet<string>> = {
  rfc9989: new Set([...COMMON_TAGS, 'np', 'psd', 't']),
  rfc7489: new Set([...COMMON_TAGS, 'pct', 'rf', 'ri']),
};
const MODE_NAMES: Record<DmarcMode, string> = { rfc9989: 'RFC 9989', rfc7489: 'RFC 7489' };
const POLICIES: readonly string[] = ['none', 'quarantine', 'reject'];
/** DMARC-17, DMARC-18: one level less strict. */
const LOWER: Record<DmarcPolicy, DmarcPolicy> = {
  reject: 'quarantine',
  quarantine: 'none',
  none: 'none',
};
/** DMARC-3: the first of these that any domain has is the mode result. */
const COMBINED: readonly DmarcResult[] = [
  'fail',
  'permerror',
  'temperror',
  'not-evaluated',
  'pass',
  'none',
];
const STRICTNESS: Record<DmarcPolicy, number> = { reject: 2, quarantine: 1, none: 0 };

export async function evaluateDmarc(ctx: DmarcContext): Promise<DmarcResults> {
  const modes = ctx.modes ?? ['rfc9989', 'rfc7489'];
  const [rfc9989, rfc7489] = await Promise.all(
    (['rfc9989', 'rfc7489'] as const).map((mode) =>
      modes.includes(mode) ? guarded(ctx, mode) : undefined,
    ),
  );
  return { ...(rfc9989 ? { rfc9989 } : {}), ...(rfc7489 ? { rfc7489 } : {}) };
}

/** REP-7, REP-8 per mode. */
function guarded(ctx: DmarcContext, mode: DmarcMode): Promise<DmarcModeResult> {
  const from = ctx.headers.filter((h) => h.lname === 'from');
  // Filled as queries are made, so a timeout keeps the ones already answered.
  const queryIds: string[] = [];
  return guard(
    ctx.signal,
    () => evaluateMode(ctx, mode, queryIds),
    (kind, error): DmarcModeResult => ({
      result: 'not-evaluated',
      reason: kind,
      testing: false,
      alignment: [],
      queryIds: [...queryIds],
      findings: [
        {
          id: `analysis.${kind}`,
          severity: 'error',
          message:
            kind === 'timeout'
              ? 'DMARC was not evaluated within the time limit.'
              : `DMARC stopped because of an unexpected error: ${String(error)}`,
          evidence: fieldEvidence(from),
        },
      ],
    }),
  );
}

/** REP-4: the fields, or an empty range at the start when there are none. */
function fieldEvidence(fields: readonly HeaderField[]): Evidence[] {
  return fields.length > 0
    ? fields.map((h) => ({ kind: 'header', index: h.index }))
    : [{ kind: 'bytes', range: { start: 0, end: 0 } }];
}

/** A row and, for DMARC-24, why its identifier could not be evaluated. */
type Row = AlignmentRow & {
  readonly authReason?: DmarcNotEvaluatedReason;
  /** The organizational-domain lookup stopped (DMARC-24). */
  readonly orgError?: NonNullable<Walk['error']>;
};

async function evaluateMode(
  ctx: DmarcContext,
  mode: DmarcMode,
  queryIds: string[],
): Promise<DmarcModeResult> {
  const from = ctx.headers.filter((h) => h.lname === 'from');
  const invalid = (message: string): DmarcModeResult => ({
    result: 'not-evaluated',
    reason: 'invalid-input',
    testing: false,
    alignment: [],
    queryIds,
    findings: [
      { id: 'dmarc.from-invalid', severity: 'error', message, evidence: fieldEvidence(from) },
    ],
  });

  // DMARC-1, DMARC-2, DMARC-3, DMARC-21
  const [fromField] = from;
  if (!fromField || from.length > 1) {
    return invalid(
      from.length === 0 ? 'There is no From field.' : 'There is more than one From field.',
    );
  }
  const domains = addressDomains(fromField.value);
  if (!domains) return invalid('The From field has no usable address.');
  const unique = [...new Set(domains)];
  const [first] = unique;
  if (!first) return invalid('The From field has no usable address.');
  if (mode === 'rfc9989') {
    if (unique.length > 1) {
      return invalid('The From field has addresses in more than one domain (RFC 9989 §5.3.1).');
    }
    const warnings: Finding[] =
      domains.length > 1
        ? [
            {
              id: 'dmarc.from-multiple-addresses',
              severity: 'warning',
              message: 'The From field has several addresses; their one domain is used.',
              evidence: fieldEvidence(from),
            },
          ]
        : [];
    return evaluateDomain(ctx, mode, first, queryIds, warnings);
  }
  if (unique.length === 1) return evaluateDomain(ctx, mode, first, queryIds, []);
  // DMARC-3: each domain on its own, then combined. They share queryIds, so a
  // timeout keeps every answered query.
  const perDomain = await Promise.all(
    unique.map((domain) => evaluateDomain(ctx, mode, domain, queryIds, [])),
  );
  const result = COMBINED.find((c) => perDomain.some((d) => d.result === c)) ?? 'none';
  const candidates = perDomain.filter((d) => d.result === result);
  const deciding =
    result === 'fail'
      ? candidates.reduce((best, d) =>
          STRICTNESS[d.policy ?? 'none'] > STRICTNESS[best.policy ?? 'none'] ? d : best,
        )
      : (candidates[0] as DmarcModeResult);
  // The mode reports every domain's findings, not only the deciding one's.
  return { ...deciding, queryIds, findings: perDomain.flatMap((d) => d.findings), perDomain };
}

async function evaluateDomain(
  ctx: DmarcContext,
  mode: DmarcMode,
  author: string,
  queryIds: string[],
  warnings: readonly Finding[],
): Promise<DmarcModeResult> {
  const findings: Finding[] = [...warnings];
  const add = (id: string, severity: Severity, message: string, evidence: Evidence[]) =>
    findings.push({ id, severity, message, evidence });
  const walkCtx: WalkContext = {
    resolve: ctx.resolve,
    signal: ctx.signal,
    onQuery: (id) => queryIds.push(id),
  };
  const psl = ctx.psl;
  if (mode === 'rfc7489' && !psl) throw new Error('rfc7489 needs the Public Suffix List');
  const pslVersion = mode === 'rfc7489' && psl?.version ? { pslVersion: psl.version } : {};
  const found = {
    testing: false,
    alignment: [],
    queryIds,
    findings,
    authorDomain: author,
    ...pslVersion,
  } as const;

  // DMARC-4..8, DMARC-22, DMARC-23, DMARC-26
  const walk =
    mode === 'rfc9989'
      ? await treeWalk(walkCtx, author)
      : await discover7489(walkCtx, psl as PublicSuffixList, author);
  findings.push(...walk.findings);
  if (walk.error === 'temperror') return { ...found, result: 'temperror' };
  if (walk.error) return { ...found, result: 'not-evaluated', reason: walk.error };
  const org = { orgDomain: walk.orgDomain, orgDomainRule: walk.orgDomainRule };
  const rec = walk.policy;
  if (!rec) return { ...found, ...org, result: 'none' };
  const tags = rec.tags;
  const recordEvidence: Evidence[] = [{ kind: 'dns', queryId: rec.queryId }];
  const withRecord = { ...found, ...org, recordAt: rec.name, record: rec.text };

  // DMARC-10
  const ignored = [...tags.keys()].filter((t) => !TAGS[mode].has(t));
  if (ignored.length > 0) {
    add(
      'dmarc.ignored-tag',
      'info',
      `Not defined in ${MODE_NAMES[mode]}, so ignored: ${ignored.join(', ')}.`,
      recordEvidence,
    );
  }
  let pct = 100;
  const pctTag = mode === 'rfc7489' ? tags.get('pct') : undefined;
  if (pctTag !== undefined) {
    if (/^\d{1,3}$/.test(pctTag) && Number(pctTag) <= 100) {
      pct = Number(pctTag);
    } else {
      add(
        'dmarc.ignored-tag',
        'info',
        `pct=${pctTag} is not an integer from 0 to 100, so it is ignored.`,
        recordEvidence,
      );
    }
  }
  // DMARC-11
  const rua = hasValidRua(tags.get('rua'));
  const read = (tag: string): DmarcPolicy | 'invalid' | undefined => {
    if (!TAGS[mode].has(tag)) return undefined;
    const v = tags.get(tag)?.toLowerCase();
    if (v === undefined) return undefined;
    return POLICIES.includes(v) ? (v as DmarcPolicy) : 'invalid';
  };
  // rfc7489 has no default for p: a record without it is invalid.
  const declared = {
    p: read('p') ?? (mode === 'rfc7489' ? 'invalid' : undefined),
    sp: read('sp'),
    np: read('np'),
  };
  const anyInvalid = Object.values(declared).includes('invalid');
  if (anyInvalid && !rua) {
    add(
      'dmarc.invalid-policy',
      'error',
      'p, sp, or np is missing or not none, quarantine, or reject, and there is no valid rua.',
      recordEvidence,
    );
    return { ...withRecord, result: 'not-evaluated', reason: 'invalid-input' };
  }
  const policyOf = (v: DmarcPolicy | 'invalid' | undefined) => (v === 'invalid' ? undefined : v);
  // With a valid rua, an invalid policy tag makes the record p=none (DMARC-11).
  const p: DmarcPolicy = anyInvalid ? 'none' : (policyOf(declared.p) ?? 'none');
  const sp = anyInvalid ? undefined : policyOf(declared.sp);
  const np = anyInvalid ? undefined : policyOf(declared.np);

  // DMARC-12..14, DMARC-25
  const orgOf: (domain: string) => Promise<OrgLookup> =
    mode === 'rfc9989'
      ? memoOrgDomain(walkCtx, author, walk)
      : async (domain) => ({ org: organizationalDomain(psl as PublicSuffixList, domain).domain });
  const spf = ctx.spf.mailFrom;
  interface Identifier {
    readonly id: 'spf' | 'dkim';
    readonly domain: string;
    readonly result: string;
    readonly reason: DmarcNotEvaluatedReason | undefined;
    readonly tag: 'aspf' | 'adkim';
  }
  const identifiers: Identifier[] = [
    ...(spf.domain !== undefined
      ? [
          {
            id: 'spf',
            domain: spf.domain,
            result: spf.result,
            reason: spf.reason,
            tag: 'aspf',
          } as const,
        ]
      : []),
    ...ctx.dkim.flatMap((sig) =>
      sig.d === undefined
        ? []
        : [
            {
              id: 'dkim',
              domain: sig.d,
              result: sig.result,
              reason: sig.reason,
              tag: 'adkim',
            } as const,
          ],
    ),
  ];
  // Independent lookups overlap; the memo shares walks for the same domain.
  const rows: Row[] = await Promise.all(
    identifiers.map((x) =>
      align(orgOf, author, walk.orgDomain, x.id, x.domain, x.result, tags.get(x.tag), x.reason),
    ),
  );

  // DMARC-24
  const aligned = rows.filter((r) => r.aligned);
  const blocked = rows.filter((r) => r.orgError && r.authResult === 'pass');
  const unevaluated = aligned.find((r) => r.authResult === 'not-evaluated');
  let result: DmarcResult;
  let reason: DmarcNotEvaluatedReason | undefined;
  if (rows.some((r) => r.counts)) {
    result = 'pass';
  } else if (ctx.dkimUnavailable) {
    [result, reason] = ['not-evaluated', ctx.dkimUnavailable];
  } else if (
    aligned.some((r) => r.authResult === 'temperror') ||
    blocked.some((r) => r.orgError === 'temperror')
  ) {
    result = 'temperror';
  } else if (blocked[0]?.orgError) {
    [result, reason] = ['not-evaluated', blocked[0].orgError as DmarcNotEvaluatedReason];
  } else if (unevaluated) {
    [result, reason] = ['not-evaluated', unevaluated.authReason];
  } else {
    result = 'fail';
  }

  // DMARC-15, DMARC-16
  let policy: DmarcPolicy = p;
  let policySource: 'p' | 'sp' | 'np' = 'p';
  if (rec.name !== author && mode === 'rfc7489') {
    if (sp !== undefined) [policy, policySource] = [sp, 'sp'];
  } else if (rec.name !== author) {
    const exists = await ctx.resolve(
      {
        name: author,
        type: 'A',
        sensitivity: 'domain',
        purpose: `Whether ${author} exists (DMARC np)`,
      },
      ctx.signal,
    );
    queryIds.push(exists.queryId);
    const sub = exists.rcode === 'NXDOMAIN' ? np : sp;
    if (sub !== undefined) {
      policy = sub;
      policySource = exists.rcode === 'NXDOMAIN' ? 'np' : 'sp';
    }
  }
  // DMARC-17
  const declaredPolicy = policy;
  const testing = mode === 'rfc9989' && tags.get('t')?.toLowerCase() === 'y';
  if (testing) policy = LOWER[policy];

  if (policy === 'none')
    add(
      'dmarc.policy-none',
      'info',
      'The policy in effect is none: failing mail is not blocked.',
      recordEvidence,
    );
  if (!rua)
    add(
      'dmarc.no-rua',
      'info',
      'The record has no valid rua, so no aggregate reports are sent.',
      recordEvidence,
    );

  // DMARC-18, DMARC-19
  const disposition = result === 'pass' ? 'none' : result === 'fail' ? policy : undefined;
  const dispositions: { dispositions?: readonly WeightedDisposition[] } =
    result === 'fail' && pct < 100 && policy !== 'none'
      ? {
          dispositions: [
            { disposition: policy, weight: pct },
            { disposition: policy === 'reject' ? 'quarantine' : 'none', weight: 100 - pct },
          ],
        }
      : {};
  return {
    ...withRecord,
    result,
    ...(reason ? { reason } : {}),
    declaredPolicy,
    policy,
    policySource,
    testing,
    ...(disposition ? { disposition } : {}),
    ...dispositions,
    alignment: rows.map(({ authReason: _r, orgError: _e, ...row }) => row),
  };
}

type OrgLookup = { readonly org: string } | { readonly error: NonNullable<Walk['error']> };

/** The organizational domain of other domains, walked once each (DMARC-14). */
function memoOrgDomain(
  ctx: WalkContext,
  author: string,
  authorWalk: Walk,
): (domain: string) => Promise<OrgLookup> {
  const known = new Map<string, Promise<OrgLookup>>([
    [author, Promise.resolve({ org: authorWalk.orgDomain })],
  ]);
  return (domain) => {
    let pending = known.get(domain);
    if (!pending) {
      pending = treeWalk(ctx, domain).then((w) =>
        w.error ? { error: w.error } : { org: w.orgDomain },
      );
      known.set(domain, pending);
    }
    return pending;
  };
}

async function align(
  orgOf: (domain: string) => Promise<OrgLookup>,
  author: string,
  authorOrg: string,
  identifier: 'spf' | 'dkim',
  rawDomain: string,
  authResult: string,
  modeTag: string | undefined,
  authReason: DmarcNotEvaluatedReason | undefined,
): Promise<Row> {
  const domain = rawDomain.toLowerCase().replace(/\.$/, '');
  const mode = modeTag?.toLowerCase() === 's' ? 'strict' : 'relaxed';
  const base = {
    identifier,
    domain,
    authResult,
    mode,
    ...(authReason ? { authReason } : {}),
  } as const;
  // DMARC-25: only the author's organizational domain or its subdomains can align relaxed.
  const related = domain === authorOrg || domain.endsWith(`.${authorOrg}`);
  if (mode === 'strict' || domain === author || !related || !isDomainName(domain)) {
    const aligned = domain === author;
    const orgDomain = mode === 'relaxed' && aligned ? { orgDomain: authorOrg } : {};
    return { ...base, ...orgDomain, aligned, counts: aligned && authResult === 'pass' };
  }
  const org = await orgOf(domain);
  if ('error' in org) return { ...base, aligned: false, counts: false, orgError: org.error };
  const aligned = org.org === authorOrg;
  return { ...base, orgDomain: org.org, aligned, counts: aligned && authResult === 'pass' };
}

/** DMARC-11: at least one `rua` entry is a URI (a size suffix `!10m` is allowed). */
function hasValidRua(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value.split(',').some((entry) => {
    const uri = entry.trim().replace(/!\d+[kmgt]?$/i, '');
    try {
      return new URL(uri).protocol.length > 1;
    } catch {
      return false;
    }
  });
}

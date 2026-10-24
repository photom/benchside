/**
 * ARC chain validation (docs/reference/mail/arc.md; design: mail-design/arc.md).
 * Never throws on input.
 */
import { type AuthResultEntry, parseAuthResults } from '../authres/parse.ts';
import type { DnsAnswer, DnsQuery } from '../dns/types.ts';
import type { HeaderField } from '../message/headers.ts';
import { isTimeout, untilAborted } from '../shared/abort.ts';
import { decodeBase64 } from '../shared/base64.ts';
import type { ByteRange } from '../shared/bytes.ts';
import { verifySignature } from '../shared/crypto.ts';
import { isDomainName } from '../shared/domain.ts';
import type { Evidence, Finding, Severity } from '../shared/findings.ts';
import {
  ALGORITHMS,
  bodyHash,
  bytesEqual,
  createSignatureMemo,
  FUTURE_SLACK_SECONDS,
  fetchKey,
  headerHashData,
  isAlgorithm,
  isCanon,
  type KeyResult,
  type SignatureMemo,
  selectHeaders,
} from '../shared/signature-core.ts';
import { parseTagList, type TagList } from '../shared/tag-list.ts';
import { type ArcGroup, groupSets, isArcField } from './sets.ts';

export type ArcResult = 'none' | 'pass' | 'fail' | 'not-evaluated';
export type ArcNotEvaluatedReason =
  | 'no-body'
  | 'offline'
  | 'sensitive-query-blocked'
  | 'budget-exhausted'
  | 'timeout'
  | 'internal-error'
  | 'invalid-input';

export interface ArcSignatureTrace {
  /** Header field index of the AMS or AS. */
  readonly field: number;
  readonly result: 'pass' | 'fail' | 'not-evaluated' | 'not-checked';
  readonly reason?: ArcNotEvaluatedReason;
  readonly d?: string;
  readonly s?: string;
  readonly t?: string;
  /** AS only. */
  readonly cv?: string;
  readonly keyQueryId?: string;
}

export interface ArcSetTrace {
  readonly instance: number;
  readonly aar?: {
    readonly field: number;
    readonly authservId: string;
    readonly entries: readonly AuthResultEntry[];
  };
  readonly ams?: ArcSignatureTrace;
  readonly seal?: ArcSignatureTrace;
}

export interface ArcReport {
  readonly result: ArcResult;
  readonly reason?: ArcNotEvaluatedReason;
  /** ARC-6; 0 when every AMS passes. */
  readonly oldestPass?: number;
  /** ARC-10: one row per instance, lowest first. */
  readonly sets: readonly ArcSetTrace[];
  readonly findings: readonly Finding[];
}

export interface ArcContext {
  /** CRLF-normalized message bytes (IN-7). */
  readonly bytes: Uint8Array;
  readonly headers: readonly HeaderField[];
  readonly body: ByteRange | null;
  readonly resolve: (query: DnsQuery, signal: AbortSignal) => Promise<DnsAnswer>;
  readonly referenceTime: Date;
  readonly signal: AbortSignal;
  readonly memo?: SignatureMemo;
}

const MAX_INSTANCE = 50; // RFC 8617 §4.2.1

const evidence = (fields: readonly HeaderField[], queryId?: string): Evidence[] => [
  ...fields.map((h) => ({ kind: 'header', index: h.index }) as const),
  ...(queryId === undefined ? [] : [{ kind: 'dns', queryId } as const]),
];
const finding = (
  id: string,
  severity: Severity,
  message: string,
  fields: readonly HeaderField[],
  queryId?: string,
): Finding => ({ id, severity, message, evidence: evidence(fields, queryId) });

export async function verifyArc(ctx: ArcContext): Promise<ArcReport> {
  const fields = ctx.headers.filter(isArcField);
  if (fields.length === 0) return { result: 'none', sets: [], findings: [] };
  // ARC-12: one guard for the whole method.
  try {
    return await untilAborted(validate(ctx, fields, ctx.memo ?? createSignatureMemo()), ctx.signal);
  } catch (error) {
    if (ctx.signal.aborted && !isTimeout(ctx.signal)) throw ctx.signal.reason;
    const timedOut = isTimeout(ctx.signal);
    return {
      result: 'not-evaluated',
      reason: timedOut ? 'timeout' : 'internal-error',
      sets: [],
      findings: [
        timedOut
          ? finding(
              'analysis.timeout',
              'error',
              'ARC was not validated within the time limit.',
              fields,
            )
          : finding(
              'analysis.internal-error',
              'error',
              `ARC validation stopped because of an unexpected error: ${String(error)}`,
              fields,
            ),
      ],
    };
  }
}

/** One signature's outcome, before it is combined (ARC-11). */
interface Outcome {
  readonly result: 'pass' | 'fail' | 'not-evaluated';
  readonly reason?: ArcNotEvaluatedReason;
  readonly keyQueryId?: string;
  readonly findings: readonly Finding[];
}

type Tags = ReadonlyMap<string, string>;

async function validate(
  ctx: ArcContext,
  fields: readonly HeaderField[],
  memo: SignatureMemo,
): Promise<ArcReport> {
  const { groups, withoutInstance } = groupSets(fields);
  const parsed = new Map<HeaderField, TagList>();
  for (const g of groups) for (const h of [...g.ams, ...g.as]) parsed.set(h, parseTagList(h.value));
  const tagsOf = new Map([...parsed].map(([h, list]) => [h, list.tags as Tags]));
  const unchecked = () => rows(groups, tagsOf, new Map());
  const fail = (...findings: Finding[]): ArcReport => ({
    result: 'fail',
    sets: unchecked(),
    findings,
  });

  // ARC-1
  const top = groups.at(-1);
  if (top && top.instance > MAX_INSTANCE) {
    return fail(
      finding(
        'arc.too-many-sets',
        'error',
        `The chain has instance ${top.instance}; at most ${MAX_INSTANCE} are allowed.`,
        [...top.aar, ...top.ams, ...top.as],
      ),
    );
  }
  // ARC-2
  const cvOf = (h: HeaderField) => tagsOf.get(h)?.get('cv')?.toLowerCase();
  if (top?.as.some((h) => cvOf(h) === 'fail')) {
    return fail(
      finding(
        'arc.cv-fail',
        'error',
        'The last hop marked the chain as failed (cv=fail).',
        top.as.filter((h) => cvOf(h) === 'fail'),
      ),
    );
  }
  // ARC-3
  const problems = structureProblems(groups, withoutInstance, parsed, cvOf);
  if (problems.length > 0) return fail(...problems);

  // Structure is sound: exactly one of each per instance, 1..N.
  const sets = groups.map((g) => ({
    aar: g.aar[0] as HeaderField,
    ams: g.ams[0] as HeaderField,
    as: g.as[0] as HeaderField,
  }));
  const [amsOutcomes, sealOutcomes] = await Promise.all([
    Promise.all(sets.map((set) => verifyAms(ctx, set.ams, tagsOf.get(set.ams) as Tags, memo))),
    Promise.all(
      sets.map((set, n) => verifySeal(ctx, sets.slice(0, n + 1), tagsOf.get(set.as) as Tags, memo)),
    ),
  ]);

  const findings: Finding[] = [];
  // ARC-9
  const now = ctx.referenceTime.getTime() / 1000;
  for (const set of sets) {
    for (const h of [set.ams, set.as]) {
      const t = tagsOf.get(h)?.get('t');
      if (t !== undefined && Number(t) > now + FUTURE_SLACK_SECONDS) {
        findings.push(
          finding('arc.future-timestamp', 'warning', 'The signature time (t=) is in the future.', [
            h,
          ]),
        );
      }
    }
  }

  // ARC-11: AMS N and every AS, highest first.
  const last = amsOutcomes.at(-1) as Outcome;
  const decisive = [last, ...sealOutcomes.toReversed()];
  for (const o of decisive) findings.push(...o.findings);
  const failed = decisive.some((o) => o.result === 'fail');
  const notEvaluated = decisive.find((o) => o.result === 'not-evaluated');

  // ARC-6
  let oldestPass: number | undefined;
  if (last.result === 'pass') {
    oldestPass = 0;
    for (let m = amsOutcomes.length - 1; m >= 1; m--) {
      const o = amsOutcomes[m - 1] as Outcome;
      if (o.result === 'pass') continue;
      oldestPass = o.result === 'fail' ? m + 1 : undefined;
      break;
    }
    if (oldestPass !== undefined && oldestPass > 1) {
      const changed = sets[oldestPass - 2] as { ams: HeaderField };
      findings.push(
        finding(
          'arc.modified-after',
          'info',
          `The message was changed after hop ${oldestPass - 1}; its signature no longer verifies.`,
          [changed.ams],
        ),
      );
    }
  }

  const outcomes = new Map<HeaderField, Outcome>();
  sets.forEach((set, n) => {
    outcomes.set(set.ams, amsOutcomes[n] as Outcome);
    outcomes.set(set.as, sealOutcomes[n] as Outcome);
  });
  return {
    result: failed ? 'fail' : notEvaluated ? 'not-evaluated' : 'pass',
    ...(!failed && notEvaluated?.reason ? { reason: notEvaluated.reason } : {}),
    ...(oldestPass !== undefined ? { oldestPass } : {}),
    sets: rows(groups, tagsOf, outcomes),
    findings,
  };
}

/** ARC-3, including the AMS and AS tag checks of ARC-5 and ARC-7. */
function structureProblems(
  groups: readonly ArcGroup[],
  withoutInstance: readonly HeaderField[],
  parsed: ReadonlyMap<HeaderField, TagList>,
  cvOf: (h: HeaderField) => string | undefined,
): Finding[] {
  const problems: Finding[] = [];
  const add = (message: string, fields: readonly HeaderField[]) =>
    problems.push(finding('arc.structure', 'error', message, fields));
  if (withoutInstance.length > 0) add('Some ARC fields have no valid i= tag.', withoutInstance);
  groups.forEach((g, n) => {
    const all = [...g.aar, ...g.ams, ...g.as];
    if (g.instance !== n + 1) {
      add(`Instance ${n + 1} is missing; the next is ${g.instance}.`, all);
    }
    for (const [name, list] of [
      ['ARC-Authentication-Results', g.aar],
      ['ARC-Message-Signature', g.ams],
      ['ARC-Seal', g.as],
    ] as const) {
      if (list.length !== 1) {
        // A missing field has no evidence of its own; point at the rest of its set.
        add(
          `Instance ${g.instance} has ${list.length} ${name} fields; exactly 1 is required.`,
          list.length > 0 ? list : all,
        );
      }
    }
    for (const h of g.as) {
      const cv = cvOf(h);
      const expected = g.instance === 1 ? 'none' : 'pass';
      if (cv === 'fail') {
        problems.push(
          finding('arc.cv-fail', 'error', `Hop ${g.instance} marked the chain as failed.`, [h]),
        );
      } else if (cv !== expected) {
        add(`Instance ${g.instance} must have cv=${expected}.`, [h]);
      }
    }
    for (const h of g.ams) {
      const why = tagProblem(parsed.get(h) as TagList, 'ams');
      if (why) add(why, [h]);
    }
    for (const h of g.as) {
      const why = tagProblem(parsed.get(h) as TagList, 'as');
      if (why) add(why, [h]);
    }
  });
  return problems;
}

const REQUIRED = {
  ams: ['i', 'a', 'b', 'bh', 'd', 'h', 's'],
  as: ['i', 'cv', 'a', 'b', 'd', 's'],
} as const;

/** ARC-5, ARC-7: why a signature's tags are unusable, or null. */
function tagProblem(list: TagList, kind: 'ams' | 'as'): string | null {
  const tags = list.tags;
  if (list.errors.length > 0 || list.duplicates.length > 0) {
    return `The ${kind === 'ams' ? 'AMS' : 'AS'} tag list is invalid.`;
  }
  const missing = REQUIRED[kind].filter((t) => !tags.has(t));
  if (missing.length > 0) return `Missing tags: ${missing.join(', ')}.`;
  if (kind === 'as' && tags.has('h')) return 'An ARC-Seal must not have h=.';
  if (!isAlgorithm((tags.get('a') ?? '').toLowerCase())) {
    return `The algorithm "${tags.get('a')}" is not supported.`;
  }
  if (!isDomainName(tags.get('d') ?? '')) return 'd= is not a domain name.';
  if (!isDomainName(tags.get('s') ?? '')) return 's= is not a valid selector.';
  const [hc = 'simple', bc = 'simple', ...extra] = (tags.get('c') ?? 'simple/simple')
    .toLowerCase()
    .split('/');
  if (kind === 'ams' && (extra.length > 0 || !isCanon(hc) || !isCanon(bc))) {
    return 'c= must be simple or relaxed.';
  }
  if (['t', 'x', 'l'].some((t) => tags.has(t) && !/^\d{1,76}$/.test(tags.get(t) as string))) {
    return 't=, x=, and l= must be numbers.';
  }
  if (
    !decodeBase64(tags.get('b') ?? '') ||
    (kind === 'ams' && !decodeBase64(tags.get('bh') ?? ''))
  ) {
    return 'b= or bh= is not valid base64.';
  }
  return null;
}

/** ARC-8: a key problem is a chain failure; limits of this tool are not (ARC-11). */
function keyOutcome(fetched: Extract<KeyResult, { ok: false }>, field: HeaderField): Outcome {
  const queryId = fetched.queryId;
  const notEvaluated = (reason: ArcNotEvaluatedReason): Outcome => ({
    result: 'not-evaluated',
    reason,
    keyQueryId: queryId,
    findings: [],
  });
  switch (fetched.problem) {
    case 'OFFLINE':
      return notEvaluated('offline');
    case 'BLOCKED':
      return notEvaluated('sensitive-query-blocked');
    case 'BUDGET':
      return notEvaluated('budget-exhausted');
    default:
      return {
        result: 'fail',
        keyQueryId: queryId,
        findings: [finding('arc.key', 'error', fetched.message, [field], queryId)],
      };
  }
}

/** ARC-5 */
async function verifyAms(
  ctx: ArcContext,
  ams: HeaderField,
  tags: Tags,
  memo: SignatureMemo,
): Promise<Outcome> {
  if (!ctx.body) return { result: 'not-evaluated', reason: 'no-body', findings: [] };
  const a = (tags.get('a') ?? '').toLowerCase();
  if (!isAlgorithm(a)) throw new Error('unreachable: checked by ARC-3');
  const fetched = await fetchKey(
    { resolve: ctx.resolve, signal: ctx.signal, memo },
    tags.get('s') ?? '',
    (tags.get('d') ?? '').toLowerCase(),
    a,
    true,
  );
  if (!fetched.ok) return keyOutcome(fetched, ams);
  const queryId = fetched.queryId;
  const mismatch = (message: string): Outcome => ({
    result: 'fail',
    keyQueryId: queryId,
    findings: [finding('arc.ams-mismatch', 'error', message, [ams], queryId)],
  });
  const [hc, bc] = (tags.get('c') ?? 'simple/simple').toLowerCase().split('/') as [
    'simple' | 'relaxed',
    ('simple' | 'relaxed')?,
  ];
  const l = tags.get('l');
  const { computed } = await bodyHash(
    memo,
    ctx.bytes,
    ctx.body,
    bc ?? 'simple',
    ALGORITHMS[a].hash,
    l === undefined ? undefined : Number(l),
  );
  const bh = decodeBase64(tags.get('bh') ?? '') as Uint8Array;
  if (!computed) return mismatch(`l=${l} is longer than the body.`);
  if (!bytesEqual(computed, bh)) {
    return mismatch('The body hash does not match bh=: the body was changed.');
  }
  const names = (tags.get('h') ?? '')
    .split(':')
    .map((n) => n.replace(/[ \t\r\n]/g, '').toLowerCase());
  const selected = selectHeaders(ctx.headers, names, ams);
  const data = headerHashData(ctx.bytes, selected, ams, hc);
  const b = decodeBase64(tags.get('b') ?? '') as Uint8Array;
  if (!(await verifySignature(fetched.key, data, b))) {
    return mismatch('The signature does not match the signed header fields.');
  }
  return { result: 'pass', keyQueryId: queryId, findings: [] };
}

/** ARC-7: the seal of the last set in `sets` covers every set up to it. */
async function verifySeal(
  ctx: ArcContext,
  sets: readonly { aar: HeaderField; ams: HeaderField; as: HeaderField }[],
  tags: Tags,
  memo: SignatureMemo,
): Promise<Outcome> {
  const seal = (sets.at(-1) as { as: HeaderField }).as;
  const a = (tags.get('a') ?? '').toLowerCase();
  if (!isAlgorithm(a)) throw new Error('unreachable: checked by ARC-3');
  const fetched = await fetchKey(
    { resolve: ctx.resolve, signal: ctx.signal, memo },
    tags.get('s') ?? '',
    (tags.get('d') ?? '').toLowerCase(),
    a,
    true,
  );
  if (!fetched.ok) return keyOutcome(fetched, seal);
  const covered = sets.flatMap((s) => [s.aar, s.ams, s.as]).slice(0, -1);
  const data = headerHashData(ctx.bytes, covered, seal, 'relaxed');
  const b = decodeBase64(tags.get('b') ?? '') as Uint8Array;
  if (!(await verifySignature(fetched.key, data, b))) {
    return {
      result: 'fail',
      keyQueryId: fetched.queryId,
      findings: [
        finding(
          'arc.seal-mismatch',
          'error',
          'The seal does not match: an ARC field was changed after sealing.',
          [seal],
          fetched.queryId,
        ),
      ],
    };
  }
  return { result: 'pass', keyQueryId: fetched.queryId, findings: [] };
}

/** ARC-10: one row per instance; signatures without an outcome are not-checked. */
function rows(
  groups: readonly ArcGroup[],
  tagsOf: ReadonlyMap<HeaderField, Tags>,
  outcomes: ReadonlyMap<HeaderField, Outcome>,
): ArcSetTrace[] {
  const signature = (h: HeaderField | undefined, withCv: boolean): ArcSignatureTrace | null => {
    if (!h) return null;
    const tags = tagsOf.get(h);
    const o = outcomes.get(h);
    const pick = (t: string) => {
      const v = tags?.get(t);
      return v === undefined ? {} : { [t]: v };
    };
    return {
      field: h.index,
      result: o?.result ?? 'not-checked',
      ...(o?.reason ? { reason: o.reason } : {}),
      ...pick('d'),
      ...pick('s'),
      ...pick('t'),
      ...(withCv ? pick('cv') : {}),
      ...(o?.keyQueryId !== undefined ? { keyQueryId: o.keyQueryId } : {}),
    };
  };
  return groups.map((g) => {
    const aarField = g.aar[0];
    const ams = signature(g.ams[0], false);
    const seal = signature(g.as[0], true);
    let aar: ArcSetTrace['aar'];
    if (aarField) {
      const semicolon = aarField.value.indexOf(';');
      const rest = semicolon < 0 ? '' : aarField.value.slice(semicolon + 1);
      const parsed = parseAuthResults(aarField.index, rest);
      aar = { field: aarField.index, authservId: parsed.authservId, entries: parsed.entries };
    }
    return {
      instance: g.instance,
      ...(aar ? { aar } : {}),
      ...(ams ? { ams } : {}),
      ...(seal ? { seal } : {}),
    };
  });
}

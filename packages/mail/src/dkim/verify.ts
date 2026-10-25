/**
 * DKIM verification (docs/reference/mail/dkim.md; design: mail-design/dkim.md).
 * One result per DKIM-Signature field, top to bottom. Never throws on input.
 */
import type { DnsAnswer, DnsQuery } from '../dns/types.ts';
import type { HeaderField } from '../message/headers.ts';
import { guard } from '../shared/abort.ts';
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
  type SignatureMemo,
  selectHeaders,
  toBase64,
} from '../shared/signature-core.ts';
import { parseTagList } from '../shared/tag-list.ts';

export type DkimResult = 'pass' | 'fail' | 'temperror' | 'permerror' | 'not-evaluated';
export type DkimNotEvaluatedReason =
  | 'no-body'
  | 'offline'
  | 'sensitive-query-blocked'
  | 'limit'
  | 'timeout'
  | 'internal-error';

export interface DkimTrace {
  /** Parsed tags in order (DKIM-16). */
  readonly tags: readonly (readonly [string, string])[];
  /** Header field indexes in hash order. */
  readonly selectedHeaders: readonly number[];
  /** Canonicalized header hash input, decoded for display. */
  readonly headerData?: string;
  readonly body?: {
    /** The canonicalized body, first 64 KiB, decoded for display. */
    readonly canonical: string;
    /** Length of the whole canonicalized body in bytes. */
    readonly length: number;
    readonly computed: string;
    readonly expected: string;
  };
}

export interface DkimSignatureResult {
  /** Header field index of the DKIM-Signature field. */
  readonly field: number;
  readonly result: DkimResult;
  readonly reason?: DkimNotEvaluatedReason;
  readonly d?: string;
  readonly s?: string;
  readonly keyQueryId?: string;
  readonly findings: readonly Finding[];
  readonly trace: DkimTrace;
}

export interface DkimContext {
  /** CRLF-normalized message bytes (IN-7). */
  readonly bytes: Uint8Array;
  readonly headers: readonly HeaderField[];
  /** Null for header-only input (DKIM-13). */
  readonly body: ByteRange | null;
  readonly resolve: (query: DnsQuery, signal: AbortSignal) => Promise<DnsAnswer>;
  /** TIME-1..3 */
  readonly referenceTime: Date;
  readonly signal: AbortSignal;
  /** Shared with ARC by `analyze`; a fresh one when absent. */
  readonly memo?: SignatureMemo;
}

const MAX_SIGNATURES = 20; // DKIM-1
const TRACE_BODY_BYTES = 64 * 1024; // DKIM-16
/** dkim.unsigned-header: fields an attacker could add or change if left unsigned. */
const SHOULD_SIGN = ['subject', 'date', 'to', 'cc', 'reply-to', 'message-id', 'content-type'];

const utf8 = new TextDecoder('utf-8', { fatal: false });

export async function verifyDkim(ctx: DkimContext): Promise<DkimSignatureResult[]> {
  const memo = ctx.memo ?? createSignatureMemo();
  const signatures = ctx.headers.filter((h) => h.lname === 'dkim-signature');
  return Promise.all(
    signatures.map((sig, n) =>
      n < MAX_SIGNATURES ? guarded(ctx, sig, () => verifyOne(ctx, sig, memo)) : tooMany(sig),
    ),
  );
}

/**
 * REP-7, REP-8 per signature: a throw gives internal-error, the deadline gives
 * timeout, and the caller's cancel propagates. Other signatures keep their results.
 */
async function guarded(
  ctx: DkimContext,
  sig: HeaderField,
  verify: () => Promise<DkimSignatureResult>,
): Promise<DkimSignatureResult> {
  return guard(ctx.signal, verify, (kind, error) => {
    const timedOut = kind === 'timeout';
    const tags = parseTagList(sig.value).tags;
    const d = tags.get('d');
    const s = tags.get('s');
    return {
      field: sig.index,
      result: 'not-evaluated',
      reason: timedOut ? 'timeout' : 'internal-error',
      ...(d !== undefined ? { d } : {}),
      ...(s !== undefined ? { s } : {}),
      findings: [
        make(
          sig,
          timedOut ? 'analysis.timeout' : 'analysis.internal-error',
          'error',
          timedOut
            ? 'This signature was not verified within the time limit.'
            : `Verification stopped because of an unexpected error: ${String(error)}`,
        ),
      ],
      trace: { tags: [...tags], selectedHeaders: [] },
    };
  });
}

function tooMany(sig: HeaderField): DkimSignatureResult {
  const finding = make(
    sig,
    'dkim.too-many-signatures',
    'warning',
    'Only the first 20 signatures are verified.',
  );
  return {
    field: sig.index,
    result: 'not-evaluated',
    reason: 'limit',
    findings: [finding],
    trace: { tags: [], selectedHeaders: [] },
  };
}

function make(
  sig: HeaderField,
  id: string,
  severity: Severity,
  message: string,
  extra: Evidence[] = [],
): Finding {
  return { id, severity, message, evidence: [{ kind: 'header', index: sig.index }, ...extra] };
}

async function verifyOne(
  ctx: DkimContext,
  sig: HeaderField,
  memo: SignatureMemo,
): Promise<DkimSignatureResult> {
  const findings: Finding[] = [];
  const list = parseTagList(sig.value);
  const tags = list.tags;
  /** Filled in as verification proceeds; a mutable view of DkimTrace. */
  const trace: { -readonly [K in keyof DkimTrace]: DkimTrace[K] } = {
    tags: [...tags],
    selectedHeaders: [],
  };
  const d = tags.get('d');
  const s = tags.get('s');
  let keyQueryId: string | undefined;
  const done = (result: DkimResult, reason?: DkimNotEvaluatedReason): DkimSignatureResult => ({
    field: sig.index,
    result,
    ...(reason ? { reason } : {}),
    ...(d !== undefined ? { d } : {}),
    ...(s !== undefined ? { s } : {}),
    ...(keyQueryId !== undefined ? { keyQueryId } : {}),
    findings,
    trace,
  });
  const fail = (result: DkimResult, id: string, message: string, extra: Evidence[] = []) => {
    findings.push(make(sig, id, 'error', message, extra));
    return done(result);
  };

  // DKIM-2
  if (list.errors.length > 0 || list.duplicates.length > 0) {
    const why =
      list.duplicates.length > 0
        ? `Duplicate tags: ${list.duplicates.join(', ')}.`
        : list.errors[0];
    return fail('permerror', 'dkim.syntax', `The signature's tag list is invalid. ${why}`);
  }
  // DKIM-3
  const missing = ['v', 'a', 'b', 'bh', 'd', 'h', 's'].filter((t) => !tags.has(t));
  if (missing.length > 0 || tags.get('v') !== '1') {
    const why = missing.length > 0 ? `Missing: ${missing.join(', ')}.` : 'v= must be 1.';
    return fail('permerror', 'dkim.missing-tag', `A required tag is missing or wrong. ${why}`);
  }
  // DKIM-4
  const a = (tags.get('a') ?? '').toLowerCase();
  if (!isAlgorithm(a)) {
    return fail('permerror', 'dkim.unknown-algorithm', `The algorithm "${a}" is not supported.`);
  }
  const algorithm = ALGORITHMS[a];

  // DKIM-5
  const domain = (d ?? '').toLowerCase();
  const signedNames = (tags.get('h') ?? '')
    .split(':')
    .map((n) => n.replace(/[ \t\r\n]/g, '').toLowerCase());
  const [hc = 'simple', bc = 'simple', ...extraC] = (tags.get('c') ?? 'simple/simple')
    .toLowerCase()
    .split('/');
  const i = tags.get('i');
  const iDomain = i === undefined ? domain : i.slice(i.lastIndexOf('@') + 1).toLowerCase();
  const t = tags.get('t');
  const x = tags.get('x');
  const l = tags.get('l');
  const checks: [boolean, string][] = [
    [!isDomainName(domain), 'd= is not a domain name.'],
    [!isDomainName(s ?? ''), 's= is not a valid selector.'],
    [!signedNames.includes('from'), 'h= does not include from.'],
    [i !== undefined && !i.includes('@'), 'i= must contain "@".'],
    [
      i !== undefined && iDomain !== domain && !iDomain.endsWith(`.${domain}`),
      'i= is not d= or a subdomain of it.',
    ],
    [extraC.length > 0 || !isCanon(hc) || !isCanon(bc), 'c= must be simple or relaxed.'],
    [
      [t, x, l].some((v) => v !== undefined && !/^\d{1,76}$/.test(v)),
      't=, x=, and l= must be numbers.',
    ],
    [t !== undefined && x !== undefined && Number(x) <= Number(t), 'x= must be after t=.'],
  ];
  const invalid = checks.find(([bad]) => bad)?.[1];
  if (invalid) return fail('permerror', 'dkim.invalid-tag', invalid);
  // DKIM-17
  const b = decodeBase64(tags.get('b') ?? '');
  const bh = decodeBase64(tags.get('bh') ?? '');
  if (!b || !bh) return fail('permerror', 'dkim.syntax', 'b= or bh= is not valid base64.');

  // Warnings about how the signature could be abused (REQ-MAIL-004).
  if (l !== undefined) {
    findings.push(
      make(
        sig,
        'dkim.body-length',
        'warning',
        'l= signs only part of the body; text can be appended.',
      ),
    );
  }
  const fromFields = ctx.headers.filter((h) => h.lname === 'from').length;
  if (fromFields > 0 && signedNames.filter((n) => n === 'from').length <= fromFields) {
    findings.push(
      make(
        sig,
        'dkim.from-not-oversigned',
        'warning',
        'From is not oversigned, so another From field could be added.',
      ),
    );
  }
  const unsigned = ctx.headers.filter(
    (h) => SHOULD_SIGN.includes(h.lname) && !signedNames.includes(h.lname),
  );
  if (unsigned.length > 0) {
    const names = [...new Set(unsigned.map((h) => h.name))].join(', ');
    findings.push(
      make(
        sig,
        'dkim.unsigned-header',
        'warning',
        `Not signed: ${names}.`,
        unsigned.map((h) => ({ kind: 'header', index: h.index })),
      ),
    );
  }

  // DKIM-6
  const now = ctx.referenceTime.getTime() / 1000;
  if (x !== undefined && Number(x) < now) {
    return fail('fail', 'dkim.expired', 'The signature expired (x=) before the reference time.');
  }
  if (t !== undefined && Number(t) > now + FUTURE_SLACK_SECONDS) {
    findings.push(
      make(sig, 'dkim.future-timestamp', 'warning', 'The signature time (t=) is in the future.'),
    );
  }

  // DKIM-7..10
  const fetched = await fetchKey(
    { resolve: ctx.resolve, signal: ctx.signal, memo },
    s ?? '',
    domain,
    a,
    iDomain === domain,
  );
  keyQueryId = fetched.queryId;
  const dns: Evidence[] = [{ kind: 'dns', queryId: fetched.queryId }];
  for (const note of fetched.notes) {
    findings.push(make(sig, `dkim.${note.id}`, note.severity, note.message, dns));
  }
  if (!fetched.ok) {
    switch (fetched.problem) {
      case 'SERVFAIL':
      case 'TIMEOUT':
      case 'BUDGET':
        return done('temperror'); // DNS-3
      case 'BLOCKED':
        return done('not-evaluated', 'sensitive-query-blocked'); // DNS-4
      case 'OFFLINE':
        return done('not-evaluated', 'offline'); // DNS-4
      default:
        return fail('permerror', `dkim.${fetched.problem}`, fetched.message, dns);
    }
  }

  // DKIM-11..13
  if (!ctx.body) return done('not-evaluated', 'no-body');
  const { canonical, computed } = await bodyHash(
    memo,
    ctx.bytes,
    ctx.body,
    bc as 'simple' | 'relaxed',
    algorithm.hash,
    l === undefined ? undefined : Number(l),
  );
  if (!computed) {
    return fail(
      'permerror',
      'dkim.invalid-tag',
      `l=${l} is longer than the body (${canonical.length} bytes).`,
    );
  }
  trace.body = {
    canonical: utf8.decode(canonical.subarray(0, TRACE_BODY_BYTES)),
    length: canonical.length,
    computed: toBase64(computed),
    expected: toBase64(bh),
  };
  if (!bytesEqual(computed, bh)) {
    return fail(
      'fail',
      'dkim.body-hash-mismatch',
      'The body hash does not match bh=: the body was changed.',
    );
  }

  // DKIM-14
  const selected = selectHeaders(ctx.headers, signedNames, sig);
  trace.selectedHeaders = selected.map((h) => h.index);
  const data = headerHashData(ctx.bytes, selected, sig, hc as 'simple' | 'relaxed');
  trace.headerData = utf8.decode(data);
  if (!(await verifySignature(fetched.key, data, b))) {
    return fail(
      'fail',
      'dkim.signature-mismatch',
      'The signature does not match the signed header fields.',
      dns,
    );
  }
  // DKIM-4: rsa-sha1 is verified but not acceptable (RFC 8301 §3.1).
  if (a === 'rsa-sha1')
    return fail('fail', 'dkim.sha1', 'rsa-sha1 is no longer acceptable (RFC 8301).');
  return done('pass');
}

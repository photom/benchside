/**
 * DKIM verification (docs/reference/mail/dkim.md; design: mail-design/dkim.md).
 * One result per DKIM-Signature field, top to bottom. Never throws on input.
 */
import type { DnsAnswer, DnsQuery } from '../dns/types.ts';
import type { HeaderField } from '../message/headers.ts';
import { isTimeout, untilAborted } from '../shared/abort.ts';
import { decodeBase64 } from '../shared/base64.ts';
import type { ByteRange } from '../shared/bytes.ts';
import { bodyRelaxed, bodySimple } from '../shared/canonicalize.ts';
import { type DkimKey, importDkimKey, verifySignature } from '../shared/crypto.ts';
import type { Evidence, Finding, Severity } from '../shared/findings.ts';
import { headerHashData, selectHeaders } from '../shared/signature-core.ts';
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
}

const MAX_SIGNATURES = 20; // DKIM-1
const FUTURE_SLACK_SECONDS = 300; // DKIM-6
const TRACE_BODY_BYTES = 64 * 1024; // DKIM-16
const ALGORITHMS = {
  'rsa-sha256': { k: 'rsa', hash: 'SHA-256', h: 'sha256' },
  'rsa-sha1': { k: 'rsa', hash: 'SHA-1', h: 'sha1' },
  'ed25519-sha256': { k: 'ed25519', hash: 'SHA-256', h: 'sha256' },
} as const;
type Algorithm = keyof typeof ALGORITHMS;
/** dkim.unsigned-header: fields an attacker could add or change if left unsigned. */
const SHOULD_SIGN = ['subject', 'date', 'to', 'cc', 'reply-to', 'message-id', 'content-type'];

const utf8 = new TextDecoder('utf-8', { fatal: false });
const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

/** Memos shared by the signatures of one message (design: mail-design/dkim.md). */
interface Memo {
  readonly keys: Map<string, Promise<DnsAnswer>>;
  readonly imported: Map<string, Promise<DkimKey>>;
  /** Canonical body per body canonicalization. */
  readonly bodies: Map<string, Promise<Uint8Array>>;
  /** Body hash per (canon, hash, l). */
  readonly digests: Map<string, Promise<Uint8Array>>;
}

export async function verifyDkim(ctx: DkimContext): Promise<DkimSignatureResult[]> {
  const memo: Memo = {
    keys: new Map(),
    imported: new Map(),
    bodies: new Map(),
    digests: new Map(),
  };
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
  try {
    return await untilAborted(verify(), ctx.signal);
  } catch (error) {
    if (ctx.signal.aborted && !isTimeout(ctx.signal)) throw ctx.signal.reason;
    const timedOut = isTimeout(ctx.signal);
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
  }
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
  memo: Memo,
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
  if (!(a in ALGORITHMS)) {
    return fail('permerror', 'dkim.unknown-algorithm', `The algorithm "${a}" is not supported.`);
  }
  const algorithm = ALGORITHMS[a as Algorithm];

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

  // DKIM-7, DKIM-8
  const name = `${s}._domainkey.${d}`;
  const keyKey = name.toLowerCase();
  let pending = memo.keys.get(keyKey);
  if (!pending) {
    pending = ctx.resolve(
      { name, type: 'TXT', sensitivity: 'domain', purpose: `DKIM key for ${name}` },
      ctx.signal,
    );
    memo.keys.set(keyKey, pending);
  }
  const answer = await pending;
  keyQueryId = answer.queryId;
  const dns: Evidence[] = [{ kind: 'dns', queryId: answer.queryId }];
  switch (answer.rcode) {
    case 'NOERROR':
      if (answer.records.length > 0) break;
      return fail('permerror', 'dkim.no-key', `No key record at ${name}.`, dns);
    case 'NXDOMAIN':
      return fail('permerror', 'dkim.no-key', `No key record at ${name}.`, dns);
    case 'SERVFAIL':
    case 'TIMEOUT':
    case 'BUDGET':
      return done('temperror'); // DNS-3
    case 'BLOCKED':
      return done('not-evaluated', 'sensitive-query-blocked'); // DNS-4
    case 'OFFLINE':
      return done('not-evaluated', 'offline'); // DNS-4
  }

  // DKIM-9, DKIM-10
  const keyRecord = answer.records.find((r) => {
    const parsed = parseTagList(r);
    return parsed.errors.length === 0 && parsed.duplicates.length === 0;
  });
  if (answer.records.length > 1 && keyRecord !== undefined) {
    findings.push(
      make(
        sig,
        'dkim.multiple-keys',
        'warning',
        'Several key records were found; the first valid one was used.',
        dns,
      ),
    );
  }
  const keyTags = keyRecord === undefined ? null : parseTagList(keyRecord).tags;
  const p = keyTags?.get('p');
  if (!keyTags || p === undefined || (keyTags.has('v') && keyTags.get('v') !== 'DKIM1')) {
    return fail('permerror', 'dkim.key-syntax', 'The key record is not valid.', dns);
  }
  if (p === '')
    return fail('permerror', 'dkim.key-revoked', 'The key has been revoked (empty p=).', dns);
  const list2 = (tag: string) =>
    keyTags
      .get(tag)
      ?.split(':')
      .map((v) => v.trim().toLowerCase());
  const k = (keyTags.get('k') ?? 'rsa').toLowerCase();
  const keyFlags = list2('t') ?? [];
  const mismatch =
    k !== algorithm.k
      ? `The key type k=${k} does not match a=${a}.`
      : list2('h') && !list2('h')?.includes(algorithm.h)
        ? `The key does not allow ${algorithm.h}.`
        : !(list2('s') ?? ['*']).some((v) => v === 'email' || v === '*')
          ? 'The key is not for email (s=).'
          : keyFlags.includes('s') && iDomain !== domain
            ? 'The key requires i= to be exactly d= (t=s).'
            : null;
  if (mismatch) return fail('permerror', 'dkim.key-mismatch', mismatch, dns);
  const pBytes = decodeBase64(p);
  const importKey = `${algorithm.hash} ${keyRecord}`;
  let importing = memo.imported.get(importKey);
  if (!importing) {
    importing = pBytes
      ? importDkimKey(k, pBytes, algorithm.hash)
      : Promise.resolve({ ok: false } as const);
    memo.imported.set(importKey, importing);
  }
  const key = await importing;
  if (!key.ok) return fail('permerror', 'dkim.key-syntax', 'The key could not be read.', dns);
  if (key.bits !== undefined && key.bits < 1024) {
    return fail(
      'permerror',
      'dkim.key-too-short',
      `The RSA key has only ${key.bits} bits (RFC 8301 §3.2).`,
      dns,
    );
  }
  if (key.bits !== undefined && key.bits < 2048) {
    findings.push(
      make(
        sig,
        'dkim.weak-key',
        'warning',
        `The RSA key has ${key.bits} bits; 2048 or more is recommended.`,
        dns,
      ),
    );
  }
  if (keyFlags.includes('y')) {
    findings.push(
      make(sig, 'dkim.testing', 'info', 'The domain says it is testing DKIM (t=y).', dns),
    );
  }

  // DKIM-11..13
  if (!ctx.body) return done('not-evaluated', 'no-body');
  const canonical = await canonicalBody(ctx, ctx.body, bc as 'simple' | 'relaxed', memo);
  if (l !== undefined && Number(l) > canonical.length) {
    return fail(
      'permerror',
      'dkim.invalid-tag',
      `l=${l} is longer than the body (${canonical.length} bytes).`,
    );
  }
  const digestKey = `${bc}/${algorithm.hash}/${l ?? ''}`;
  let digesting = memo.digests.get(digestKey);
  if (!digesting) {
    const hashed = l === undefined ? canonical : canonical.subarray(0, Number(l));
    digesting = crypto.subtle.digest(algorithm.hash, hashed.slice()).then((h) => new Uint8Array(h));
    memo.digests.set(digestKey, digesting);
  }
  const computed = await digesting;
  trace.body = {
    canonical: utf8.decode(canonical.subarray(0, TRACE_BODY_BYTES)),
    length: canonical.length,
    computed: toB64(computed),
    expected: toB64(bh),
  };
  if (!equal(computed, bh)) {
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
  if (!(await verifySignature(key, data, b))) {
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

/**
 * RFC 6376 §3.5 domain-name / selector: dot-separated labels of letters, digits,
 * "-", and "_" (non-ASCII labels are converted later, DNS-18). Anything else
 * must never reach a DNS query.
 */
function isDomainName(name: string): boolean {
  return name.length > 0 && name.length <= 253 && name.split('.').every(isLabel);
}

function isLabel(label: string): boolean {
  if (label.length === 0 || label.length > 63 || label.startsWith('-') || label.endsWith('-')) {
    return false;
  }
  // ASCII characters must be letters, digits, "-", or "_"; non-ASCII is left to DNS-18.
  return [...label].every((c) => c.charCodeAt(0) >= 0x80 || /[A-Za-z0-9_-]/.test(c));
}

function isCanon(c: string): boolean {
  return c === 'simple' || c === 'relaxed';
}

function equal(x: Uint8Array, y: Uint8Array): boolean {
  return x.length === y.length && x.every((v, n) => v === y[n]);
}

/** Canonicalized once per body canonicalization; `l=` and the hash are applied by the caller. */
function canonicalBody(
  ctx: DkimContext,
  body: ByteRange,
  canon: 'simple' | 'relaxed',
  memo: Memo,
): Promise<Uint8Array> {
  let pending = memo.bodies.get(canon);
  if (!pending) {
    const bytes = ctx.bytes.subarray(body.start, body.end);
    pending = Promise.resolve(canon === 'simple' ? bodySimple(bytes) : bodyRelaxed(bytes));
    memo.bodies.set(canon, pending);
  }
  return pending;
}

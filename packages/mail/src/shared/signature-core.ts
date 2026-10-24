/**
 * Shared by DKIM signatures and ARC-Message-Signatures (design: mail-design/dkim.md).
 * Works on the CRLF-normalized bytes; header `raw` ranges point into them.
 */
import type { DnsAnswer, DnsQuery } from '../dns/types.ts';
import type { HeaderField } from '../message/headers.ts';
import { decodeBase64 } from './base64.ts';
import type { ByteRange } from './bytes.ts';
import { bodyRelaxed, bodySimple, headerRelaxed, headerSimple } from './canonicalize.ts';
import { type DkimKey, importDkimKey } from './crypto.ts';
import type { Severity } from './findings.ts';
import { parseTagList } from './tag-list.ts';

const CR = 0x0d;
const LF = 0x0a;
const SEMI = 0x3b;
const EQ = 0x3d;
const COLON = 0x3a;

/**
 * RFC 6376 §5.4.2: for each name in `h=`, the next unused field with that name,
 * from the bottom up. Names with no field left select nothing (oversigning).
 * The signature field itself is never selected.
 */
export function selectHeaders(
  headers: readonly HeaderField[],
  signedNames: readonly string[],
  signature: HeaderField,
): HeaderField[] {
  const used = new Set<number>([signature.index]);
  const selected: HeaderField[] = [];
  for (const name of signedNames) {
    const lname = name.toLowerCase();
    for (let i = headers.length - 1; i >= 0; i--) {
      const h = headers[i] as HeaderField;
      if (h.lname === lname && !used.has(h.index)) {
        used.add(h.index);
        selected.push(h);
        break;
      }
    }
  }
  return selected;
}

/**
 * The signature field with the value of tag `tag` (and the whitespace around it)
 * removed, and without the final CRLF (RFC 6376 §3.7, step 2). Other bytes stay exact.
 */
export function signatureFieldWithoutValue(raw: Uint8Array, tag: string): Uint8Array {
  let end = raw.length;
  if (end >= 2 && raw[end - 2] === CR && raw[end - 1] === LF) end -= 2;
  const colon = raw.indexOf(COLON);
  let specStart = colon + 1;
  while (specStart > 0 && specStart <= end) {
    let specEnd = raw.indexOf(SEMI, specStart);
    if (specEnd < 0 || specEnd > end) specEnd = end;
    const eq = raw.indexOf(EQ, specStart);
    if (eq >= 0 && eq < specEnd && isTagName(raw.subarray(specStart, eq), tag)) {
      const out = new Uint8Array(eq + 1 + (end - specEnd));
      out.set(raw.subarray(0, eq + 1));
      out.set(raw.subarray(specEnd, end), eq + 1);
      return out;
    }
    specStart = specEnd + 1;
  }
  return raw.slice(0, end);
}

const isFws = (b: number | undefined) => b === 0x20 || b === 0x09 || b === CR || b === LF;

/** Whether `bytes` is `tag` with optional FWS around it. Compares bytes, so any length is safe. */
function isTagName(bytes: Uint8Array, tag: string): boolean {
  let start = 0;
  let end = bytes.length;
  while (start < end && isFws(bytes[start])) start++;
  while (end > start && isFws(bytes[end - 1])) end--;
  if (end - start !== tag.length) return false;
  for (let i = 0; i < tag.length; i++) if (bytes[start + i] !== tag.charCodeAt(i)) return false;
  return true;
}

/**
 * Hash input for the header signature (RFC 6376 §3.7, step 2): the `selected`
 * fields (from `selectHeaders`) canonicalized, each ending in CRLF, then the
 * signature field without its `b=` value and without a final CRLF.
 */
export function headerHashData(
  bytes: Uint8Array,
  selected: readonly HeaderField[],
  signature: HeaderField,
  canon: 'simple' | 'relaxed',
): Uint8Array {
  const canonicalize = canon === 'simple' ? headerSimple : headerRelaxed;
  const raw = (h: HeaderField) => bytes.subarray(h.raw.start, h.raw.end);
  const parts = selected.map((h) => withCrlf(canonicalize(raw(h))));
  parts.push(canonicalize(signatureFieldWithoutValue(raw(signature), 'b')));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** "Each header field MUST be terminated with a single CRLF" (§3.7); the last field of header-only input has none. */
function withCrlf(field: Uint8Array): Uint8Array {
  if (field.length >= 2 && field[field.length - 2] === CR && field[field.length - 1] === LF)
    return field;
  const out = new Uint8Array(field.length + 2);
  out.set(field);
  out[field.length] = CR;
  out[field.length + 1] = LF;
  return out;
}

/** DKIM-6, ARC-9: a `t=` this far after the reference time is "in the future". */
export const FUTURE_SLACK_SECONDS = 300;

export function isCanon(c: string): c is 'simple' | 'relaxed' {
  return c === 'simple' || c === 'relaxed';
}

export function bytesEqual(x: Uint8Array, y: Uint8Array): boolean {
  return x.length === y.length && x.every((v, n) => v === y[n]);
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** DKIM-4: algorithms shared by DKIM signatures and ARC (ARC-8). */
export const ALGORITHMS = {
  'rsa-sha256': { k: 'rsa', hash: 'SHA-256', h: 'sha256' },
  'rsa-sha1': { k: 'rsa', hash: 'SHA-1', h: 'sha1' },
  'ed25519-sha256': { k: 'ed25519', hash: 'SHA-256', h: 'sha256' },
} as const;
export type Algorithm = keyof typeof ALGORITHMS;

export function isAlgorithm(a: string): a is Algorithm {
  return a in ALGORITHMS;
}

/** Memos shared by every signature of one analysis, DKIM and ARC alike. */
export interface SignatureMemo {
  readonly keys: Map<string, Promise<DnsAnswer>>;
  readonly imported: Map<string, Promise<DkimKey>>;
  /** Canonical body per body canonicalization. */
  readonly bodies: Map<string, Promise<Uint8Array>>;
  /** Body hash per (canon, hash, l). */
  readonly digests: Map<string, Promise<Uint8Array>>;
}

export function createSignatureMemo(): SignatureMemo {
  return { keys: new Map(), imported: new Map(), bodies: new Map(), digests: new Map() };
}

export interface KeyContext {
  readonly resolve: (query: DnsQuery, signal: AbortSignal) => Promise<DnsAnswer>;
  readonly signal: AbortSignal;
  readonly memo: SignatureMemo;
}

export type KeyProblem = 'no-key' | 'key-syntax' | 'key-revoked' | 'key-mismatch' | 'key-too-short';
/** DNS answers that carry no key (DNS-3, DNS-4). */
export type KeyDnsFailure = 'SERVFAIL' | 'TIMEOUT' | 'BUDGET' | 'BLOCKED' | 'OFFLINE';

/** Remarks about a usable key; each method turns them into its own findings. */
export interface KeyNote {
  readonly id: 'multiple-keys' | 'weak-key' | 'testing';
  readonly severity: Severity;
  readonly message: string;
}

export type KeyResult =
  | {
      readonly ok: true;
      readonly key: Extract<DkimKey, { ok: true }>;
      readonly queryId: string;
      readonly notes: readonly KeyNote[];
    }
  | {
      readonly ok: false;
      readonly queryId: string;
      readonly problem: KeyProblem | KeyDnsFailure;
      readonly message: string;
      /** Remarks gathered before the problem, such as which record was used. */
      readonly notes: readonly KeyNote[];
    };

/**
 * DKIM-7..10: fetches, checks, and imports the key for `s=` and `d=`.
 * `identityMatches` is false when `i=` is a subdomain of `d=` (key flag t=s).
 */
export async function fetchKey(
  ctx: KeyContext,
  s: string,
  d: string,
  a: Algorithm,
  identityMatches: boolean,
): Promise<KeyResult> {
  const algorithm = ALGORITHMS[a];
  const name = `${s}._domainkey.${d}`;
  const memoKey = name.toLowerCase();
  let pending = ctx.memo.keys.get(memoKey);
  if (!pending) {
    pending = ctx.resolve(
      { name, type: 'TXT', sensitivity: 'domain', purpose: `DKIM key for ${name}` },
      ctx.signal,
    );
    ctx.memo.keys.set(memoKey, pending);
  }
  const answer = await pending;
  const queryId = answer.queryId;
  const notes: KeyNote[] = [];
  const problem = (p: KeyProblem | KeyDnsFailure, message: string): KeyResult => ({
    ok: false,
    queryId,
    problem: p,
    message,
    notes,
  });
  switch (answer.rcode) {
    case 'NOERROR':
      if (answer.records.length > 0) break;
      return problem('no-key', `No key record at ${name}.`);
    case 'NXDOMAIN':
      return problem('no-key', `No key record at ${name}.`);
    default:
      return problem(answer.rcode, `The key lookup for ${name} returned ${answer.rcode}.`);
  }

  // DKIM-9, DKIM-10
  const keyRecord = answer.records.find((r) => {
    const parsed = parseTagList(r);
    return parsed.errors.length === 0 && parsed.duplicates.length === 0;
  });
  if (answer.records.length > 1 && keyRecord !== undefined) {
    notes.push({
      id: 'multiple-keys',
      severity: 'warning',
      message: 'Several key records were found; the first valid one was used.',
    });
  }
  const keyTags = keyRecord === undefined ? null : parseTagList(keyRecord).tags;
  const p = keyTags?.get('p');
  if (!keyTags || p === undefined || (keyTags.has('v') && keyTags.get('v') !== 'DKIM1')) {
    return problem('key-syntax', 'The key record is not valid.');
  }
  if (p === '') return problem('key-revoked', 'The key has been revoked (empty p=).');
  const list = (tag: string) =>
    keyTags
      .get(tag)
      ?.split(':')
      .map((v) => v.trim().toLowerCase());
  const k = (keyTags.get('k') ?? 'rsa').toLowerCase();
  const flags = list('t') ?? [];
  const mismatch =
    k !== algorithm.k
      ? `The key type k=${k} does not match a=${a}.`
      : list('h') && !list('h')?.includes(algorithm.h)
        ? `The key does not allow ${algorithm.h}.`
        : !(list('s') ?? ['*']).some((v) => v === 'email' || v === '*')
          ? 'The key is not for email (s=).'
          : flags.includes('s') && !identityMatches
            ? 'The key requires i= to be exactly d= (t=s).'
            : null;
  if (mismatch) return problem('key-mismatch', mismatch);
  const pBytes = decodeBase64(p);
  const importKey = `${algorithm.hash} ${keyRecord}`;
  let importing = ctx.memo.imported.get(importKey);
  if (!importing) {
    importing = pBytes
      ? importDkimKey(k, pBytes, algorithm.hash)
      : Promise.resolve({ ok: false } as const);
    ctx.memo.imported.set(importKey, importing);
  }
  const key = await importing;
  if (!key.ok) return problem('key-syntax', 'The key could not be read.');
  if (key.bits !== undefined && key.bits < 1024) {
    return problem('key-too-short', `The RSA key has only ${key.bits} bits (RFC 8301 §3.2).`);
  }
  if (key.bits !== undefined && key.bits < 2048) {
    notes.push({
      id: 'weak-key',
      severity: 'warning',
      message: `The RSA key has ${key.bits} bits; 2048 or more is recommended.`,
    });
  }
  if (flags.includes('y')) {
    notes.push({
      id: 'testing',
      severity: 'info',
      message: 'The domain says it is testing DKIM (t=y).',
    });
  }
  return { ok: true, key, queryId, notes };
}

/**
 * DKIM-11..13: the canonical body (memoized per canonicalization) and its hash
 * over the first `l` bytes (memoized per canon, hash, l). `computed` is null
 * when `l` is longer than the canonical body.
 */
export async function bodyHash(
  memo: SignatureMemo,
  bytes: Uint8Array,
  body: ByteRange,
  canon: 'simple' | 'relaxed',
  hash: 'SHA-256' | 'SHA-1',
  l?: number,
): Promise<{ readonly canonical: Uint8Array; readonly computed: Uint8Array | null }> {
  let canonicalizing = memo.bodies.get(canon);
  if (!canonicalizing) {
    const raw = bytes.subarray(body.start, body.end);
    canonicalizing = Promise.resolve(canon === 'simple' ? bodySimple(raw) : bodyRelaxed(raw));
    memo.bodies.set(canon, canonicalizing);
  }
  const canonical = await canonicalizing;
  if (l !== undefined && l > canonical.length) return { canonical, computed: null };
  const digestKey = `${canon}/${hash}/${l ?? ''}`;
  let digesting = memo.digests.get(digestKey);
  if (!digesting) {
    const hashed = l === undefined ? canonical : canonical.subarray(0, l);
    digesting = crypto.subtle.digest(hash, hashed.slice()).then((h) => new Uint8Array(h));
    memo.digests.set(digestKey, digesting);
  }
  return { canonical, computed: await digesting };
}

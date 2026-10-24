/**
 * Test-only DKIM signer. It builds the hash input by hand from the fields the
 * test lists, so header-selection bugs in the verifier are not masked.
 */
import {
  bodyRelaxed,
  bodySimple,
  headerRelaxed,
  headerSimple,
} from '../../src/shared/canonicalize.ts';
import type { TestKey } from './keys.ts';

const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export interface SignOptions {
  readonly key: TestKey;
  readonly d: string;
  readonly s: string;
  /** Header fields as they will appear in the message, top to bottom, each ending in CRLF. */
  readonly headers: readonly string[];
  readonly body: string;
  /** Field lines to hash, in h= order, each ending in CRLF (bottom-up choice is the test's job). */
  readonly signed: readonly string[];
  /** The h= value. */
  readonly h: string;
  readonly a?: 'rsa-sha256' | 'rsa-sha1' | 'ed25519-sha256';
  readonly c?: `${'simple' | 'relaxed'}/${'simple' | 'relaxed'}`;
  readonly l?: number;
  /** Extra tags, written as is before b=, for example `t=…; x=…`. */
  readonly extra?: string;
  /** Replace the computed bh= (to build mismatches). */
  readonly bh?: string;
}

/** Returns the whole message: DKIM-Signature on top, then the headers, an empty line, the body. */
export async function signMessage(o: SignOptions): Promise<string> {
  const a = o.a ?? (o.key.algorithm === 'rsa' ? 'rsa-sha256' : 'ed25519-sha256');
  const [hc, bc] = (o.c ?? 'relaxed/relaxed').split('/') as [
    'simple' | 'relaxed',
    'simple' | 'relaxed',
  ];
  const hash = a === 'rsa-sha1' ? 'SHA-1' : 'SHA-256';

  let canonBody = (bc === 'simple' ? bodySimple : bodyRelaxed)(enc.encode(o.body));
  if (o.l !== undefined) canonBody = canonBody.subarray(0, o.l);
  const bh = o.bh ?? b64(new Uint8Array(await crypto.subtle.digest(hash, canonBody.slice())));

  const tags = [
    'v=1',
    `a=${a}`,
    `c=${hc}/${bc}`,
    `d=${o.d}`,
    `s=${o.s}`,
    `h=${o.h}`,
    ...(o.l !== undefined ? [`l=${o.l}`] : []),
    ...(o.extra ? [o.extra] : []),
    `bh=${bh}`,
  ].join('; ');
  const unsigned = `DKIM-Signature: ${tags}; b=`;
  const canonHeader = hc === 'simple' ? headerSimple : headerRelaxed;
  const parts = [
    ...o.signed.map((f) => canonHeader(enc.encode(f))),
    canonHeader(enc.encode(unsigned)),
  ];
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    data.set(p, off);
    off += p.length;
  }

  let signature: ArrayBuffer;
  if (o.key.algorithm === 'rsa') {
    signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', o.key.privateKey, data);
  } else {
    // RFC 8463 §3: Ed25519 signs the SHA-256 hash of the data.
    const digest = await crypto.subtle.digest('SHA-256', data);
    signature = await crypto.subtle.sign('Ed25519', o.key.privateKey, digest);
  }
  // Fold the signature to show that whitespace in b= is ignored.
  const b = b64(new Uint8Array(signature)).replace(/(.{60})/g, '$1\r\n\t');
  return `${unsigned}${b}\r\n${o.headers.join('')}\r\n${o.body}`;
}

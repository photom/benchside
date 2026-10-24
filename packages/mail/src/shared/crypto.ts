/** DKIM key import and signature verification with Web Crypto (detailed design §7). */

export type DkimKey =
  | {
      readonly ok: true;
      readonly key: CryptoKey;
      readonly kind: 'rsa' | 'ed25519';
      readonly bits?: number;
    }
  | { readonly ok: false };

/**
 * Imports a key record's `p=` bytes. RSA may be SPKI or a bare PKCS#1 RSAPublicKey
 * (wrapped here); Ed25519 is 32 raw bytes (RFC 8463 §4). The RSA hash is fixed at import.
 */
export async function importDkimKey(
  k: string,
  p: Uint8Array,
  hash: 'SHA-256' | 'SHA-1',
): Promise<DkimKey> {
  // RFC 6376 ABNF quoted strings ("rsa") are case-insensitive.
  const kind = k.toLowerCase();
  try {
    if (kind === 'ed25519') {
      if (p.length !== 32) return { ok: false };
      const key = await crypto.subtle.importKey('raw', p.slice(), { name: 'Ed25519' }, false, [
        'verify',
      ]);
      return { ok: true, key, kind: 'ed25519' };
    }
    if (kind !== 'rsa') return { ok: false };
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash };
    // slice(): Web Crypto takes ArrayBuffer-backed views only.
    const der = isSpki(p) ? p.slice() : wrapPkcs1(p);
    const key = await crypto.subtle.importKey('spki', der, algorithm, false, ['verify']);
    return {
      ok: true,
      key,
      kind: 'rsa',
      bits: (key.algorithm as RsaHashedKeyAlgorithm).modulusLength,
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Verifies `signature` over the header hash input. Ed25519 signs the SHA-256
 * of the data (RFC 8463 §3); RSA hashes inside the algorithm.
 */
export async function verifySignature(
  key: DkimKey & { ok: true },
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    if (key.kind === 'ed25519') {
      const digest = await crypto.subtle.digest('SHA-256', data.slice());
      return await crypto.subtle.verify('Ed25519', key.key, signature.slice(), digest);
    }
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key.key,
      signature.slice(),
      data.slice(),
    );
  } catch {
    return false;
  }
}

/** DER of the rsaEncryption AlgorithmIdentifier: SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }. */
const RSA_ALGORITHM_ID = [
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
];

/** SPKI starts SEQUENCE { SEQUENCE { OID rsaEncryption …; PKCS#1 starts SEQUENCE { INTEGER … */
function isSpki(der: Uint8Array): boolean {
  const inner = der[0] === 0x30 ? headerLength(der, 0) : -1;
  return inner > 0 && der[inner] === 0x30;
}

/** Offset just after the tag and length of the element at `at`, or -1. */
function headerLength(der: Uint8Array, at: number): number {
  const len = der[at + 1];
  if (len === undefined) return -1;
  return len & 0x80 ? at + 2 + (len & 0x7f) : at + 2;
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** SPKI = SEQUENCE { AlgorithmIdentifier, BIT STRING { 0 unused bits, RSAPublicKey } }. */
function wrapPkcs1(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const bitString = [0x03, ...derLength(pkcs1.length + 1), 0x00];
  const body = RSA_ALGORITHM_ID.length + bitString.length + pkcs1.length;
  const head = [0x30, ...derLength(body), ...RSA_ALGORITHM_ID, ...bitString];
  const out = new Uint8Array(head.length + pkcs1.length);
  out.set(head);
  out.set(pkcs1, head.length);
  return out;
}

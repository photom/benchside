/** Test-only key generation. Signing is out of scope for the shipped code. */

export interface TestKey {
  readonly algorithm: 'rsa' | 'ed25519';
  readonly privateKey: CryptoKey;
  /** The DNS key record `p=` value (base64). */
  readonly p: string;
  /** For RSA: the same public key as PKCS#1 RSAPublicKey (base64), which some publishers use. */
  readonly pkcs1?: string;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function rsaKey(bits = 2048, hash: 'SHA-256' | 'SHA-1' = 'SHA-256'): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: bits,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash,
    },
    true,
    ['sign', 'verify'],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return {
    algorithm: 'rsa',
    privateKey: pair.privateKey,
    p: b64(spki),
    pkcs1: b64(pkcs1FromSpki(spki)),
  };
}

export async function ed25519Key(): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { algorithm: 'ed25519', privateKey: pair.privateKey, p: b64(raw) };
}

/** SPKI = SEQUENCE { AlgorithmIdentifier, BIT STRING { 0x00, RSAPublicKey } }. */
function pkcs1FromSpki(spki: Uint8Array): Uint8Array {
  let i = 0;
  const readHeader = () => {
    const tag = spki[i++];
    let len = spki[i++] as number;
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let k = 0; k < n; k++) len = (len << 8) | (spki[i++] as number);
    }
    return { tag, len };
  };
  readHeader(); // outer SEQUENCE
  const alg = readHeader(); // AlgorithmIdentifier
  i += alg.len;
  readHeader(); // BIT STRING
  i++; // unused-bits byte
  return spki.slice(i);
}

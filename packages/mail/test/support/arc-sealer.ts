/**
 * Test-only ARC sealer (RFC 8617 §5.1). Adds one ARC set on top of a message.
 * The AMS picks its fields bottom-up here, independently of the verifier's code.
 */
import { bodyRelaxed, headerRelaxed } from '../../src/shared/canonicalize.ts';
import type { TestKey } from './keys.ts';

const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export interface TestMessage {
  /** Header fields top to bottom, each ending in CRLF. */
  readonly headers: readonly string[];
  readonly body: string;
}

export interface Hop {
  readonly key: TestKey;
  readonly d: string;
  readonly s: string;
  /** Default: `none` for instance 1, `pass` after. */
  readonly cv?: string;
  /** Default 1_790_000_000. */
  readonly t?: number;
  /** AMS h=; default `from:subject`. */
  readonly h?: string;
  /** The AAR content after `i=N;`. */
  readonly results?: string;
  /** Extra AS tags written before b=, for example `h=from`. */
  readonly sealExtra?: string;
}

export function messageText(m: TestMessage): string {
  return `${m.headers.join('')}\r\n${m.body}`;
}

const instanceOf = (field: string) => Number(/^[^:]*:\s*i=(\d+)/.exec(field)?.[1] ?? 0);
const nameOf = (field: string) => field.slice(0, field.indexOf(':')).toLowerCase();

/** Returns the message with AS, AMS, AAR of the next instance added on top. */
export async function seal(m: TestMessage, hop: Hop): Promise<TestMessage> {
  const i = m.headers.filter((f) => nameOf(f) === 'arc-seal').length + 1;
  const a = hop.key.algorithm === 'rsa' ? 'rsa-sha256' : 'ed25519-sha256';
  const t = hop.t ?? 1_790_000_000;
  const aar = `ARC-Authentication-Results: i=${i}; ${hop.results ?? 'mx.example.org; spf=pass'}\r\n`;

  // AMS: like a DKIM signature without v=, with i= the instance.
  const h = hop.h ?? 'from:subject';
  const bh = b64(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bodyRelaxed(enc.encode(m.body)).slice())),
  );
  const amsUnsigned = `ARC-Message-Signature: i=${i}; a=${a}; c=relaxed/relaxed; d=${hop.d}; s=${hop.s}; t=${t}; h=${h}; bh=${bh}; b=`;
  const withAar = [aar, ...m.headers];
  const used = new Set<number>();
  const selected: string[] = [];
  for (const name of h.split(':')) {
    for (let n = withAar.length - 1; n >= 0; n--) {
      if (!used.has(n) && nameOf(withAar[n] as string) === name.toLowerCase()) {
        used.add(n);
        selected.push(withAar[n] as string);
        break;
      }
    }
  }
  const ams = `${amsUnsigned}${await sign(hop.key, [...selected, amsUnsigned])}\r\n`;

  // AS: every earlier set's AAR, AMS, AS in instance order, then this set.
  const arcFields = (n: number) =>
    ['arc-authentication-results', 'arc-message-signature', 'arc-seal'].map(
      (name) => m.headers.find((f) => nameOf(f) === name && instanceOf(f) === n) as string,
    );
  const earlier = Array.from({ length: i - 1 }, (_, n) => arcFields(n + 1)).flat();
  const cv = hop.cv ?? (i === 1 ? 'none' : 'pass');
  const extra = hop.sealExtra ? `${hop.sealExtra}; ` : '';
  const asUnsigned = `ARC-Seal: i=${i}; a=${a}; cv=${cv}; d=${hop.d}; s=${hop.s}; t=${t}; ${extra}b=`;
  const as = `${asUnsigned}${await sign(hop.key, [...earlier, aar, ams, asUnsigned])}\r\n`;
  return { headers: [as, ams, aar, ...m.headers], body: m.body };
}

/** Relaxed canonicalization of each field, concatenated; the last one has no CRLF. */
async function sign(key: TestKey, fields: readonly string[]): Promise<string> {
  const parts = fields.map((f) => headerRelaxed(enc.encode(f)));
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    data.set(p, off);
    off += p.length;
  }
  const signature =
    key.algorithm === 'rsa'
      ? await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, data)
      : // RFC 8463 §3: Ed25519 signs the SHA-256 hash of the data.
        await crypto.subtle.sign(
          'Ed25519',
          key.privateKey,
          await crypto.subtle.digest('SHA-256', data),
        );
  return b64(new Uint8Array(signature));
}

import { beforeAll, describe, expect, it } from 'vitest';
import { type SignOptions, signMessage } from '../../test/support/dkim-signer.ts';
import { ed25519Key, rsaKey, type TestKey, withHash } from '../../test/support/keys.ts';
import { createDnsCache } from '../dns/cache.ts';
import { composeResolver } from '../dns/compose.ts';
import { type ManualRecord, offlineTransport } from '../dns/offline.ts';
import type { Lookup, Transport } from '../dns/types.ts';
import { splitHeaders } from '../message/headers.ts';
import { type DkimSignatureResult, verifyDkim } from './verify.ts';

const enc = new TextEncoder();
const NOW = new Date('2026-10-24T00:00:00Z');
const NOW_S = NOW.getTime() / 1000;

const HEADERS = [
  'From: Alice <a@example.com>\r\n',
  'To: b@example.org\r\n',
  'Subject: Hi\r\n',
  'Date: Fri, 23 Oct 2026 10:00:00 +0000\r\n',
  'Message-ID: <x@example.com>\r\n',
];
const [FROM, TO, SUBJECT, DATE, MSGID] = HEADERS as [string, string, string, string, string];
/** Oversigned From, so the default message has no warnings. */
const DEFAULT_SIGN = {
  h: 'from:from:to:subject:date:message-id',
  signed: [FROM, '', TO, SUBJECT, DATE, MSGID],
};

let rsa: TestKey;
let ed: TestKey;
let rsa1024: TestKey;

beforeAll(async () => {
  [rsa, ed, rsa1024] = await Promise.all([rsaKey(2048), ed25519Key(), rsaKey(1024)]);
});

const record = (key: TestKey, extra = ''): ManualRecord => ({
  name: 'sel._domainkey.example.com',
  type: 'TXT',
  data: `v=DKIM1; k=${key.algorithm}; ${extra}p=${key.p}`,
});
const rawRecord = (data: string): ManualRecord => ({
  name: 'sel._domainkey.example.com',
  type: 'TXT',
  data,
});

function sign(key: TestKey, o: Partial<SignOptions> = {}): Promise<string> {
  return signMessage({
    key,
    d: 'example.com',
    s: 'sel',
    headers: HEADERS,
    body: 'Hello\r\n',
    ...DEFAULT_SIGN,
    ...o,
  });
}

async function verify(
  text: string,
  dns: readonly ManualRecord[] | Transport = [],
  signal: AbortSignal = new AbortController().signal,
): Promise<DkimSignatureResult[]> {
  const bytes = enc.encode(text);
  const { headers, body } = splitHeaders(bytes);
  const transport = typeof dns === 'function' ? dns : offlineTransport(dns);
  const r = composeResolver({
    transport,
    source: 'offline',
    cache: createDnsCache(),
    budget: 200,
    allowSensitive: false,
  });
  return verifyDkim({
    bytes,
    headers,
    body,
    resolve: (q, s) => r.resolve(q, s),
    referenceTime: NOW,
    signal,
  });
}

const ids = (r: DkimSignatureResult | undefined) => r?.findings.map((f) => f.id) ?? [];
const answer =
  (rcode: Lookup['rcode']): Transport =>
  async () => ({ rcode, records: [], authenticated: false });
/** The DKIM-Signature field of a signed message, with its CRLF. */
const signatureOf = (text: string) => text.slice(0, text.indexOf('\r\nFrom:') + 2);

describe('DKIM: results', () => {
  it('DKIM-1: given no DKIM-Signature, when verified, then there are no results', async () => {
    expect(await verify(`${HEADERS.join('')}\r\nbody\r\n`)).toEqual([]);
  });

  for (const c of [
    'simple/simple',
    'simple/relaxed',
    'relaxed/simple',
    'relaxed/relaxed',
  ] as const) {
    for (const alg of ['rsa', 'ed25519'] as const) {
      it(`REQ-MAIL-004: given an ${alg} signature with c=${c}, when verified, then it passes without findings`, async () => {
        const key = alg === 'rsa' ? rsa : ed;
        const [r] = await verify(await sign(key, { c }), [record(key)]);
        expect(r).toMatchObject({ field: 0, result: 'pass', d: 'example.com', s: 'sel' });
        expect(ids(r)).toEqual([]);
      });
    }
  }

  it('DKIM-4: given a valid rsa-sha1 signature, when verified, then the result is fail with dkim.sha1 only', async () => {
    const sha1 = await withHash(rsa, 'SHA-1');
    const [r] = await verify(await sign(sha1, { a: 'rsa-sha1' }), [record(rsa)]);
    expect(r?.result).toBe('fail');
    expect(ids(r)).toEqual(['dkim.sha1']);
  });

  it('DKIM-4: given rsa-sha1 and rsa-sha256 signatures with the same key, when verified, then each uses its own hash', async () => {
    const sha1 = await withHash(rsa, 'SHA-1');
    const first = signatureOf(await sign(sha1, { a: 'rsa-sha1' }));
    const results = await verify(first + (await sign(rsa)), [record(rsa)]);
    expect(results.map((r) => [r.result, ids(r)])).toEqual([
      ['fail', ['dkim.sha1']],
      ['pass', []],
    ]);
  });
});

describe('DKIM: signature field', () => {
  it('DKIM-2: given a duplicate tag, when verified, then permerror with dkim.syntax', async () => {
    const text = (await sign(rsa)).replace('d=example.com;', 'd=example.com; d=example.com;');
    const [r] = await verify(text, [record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.syntax']]);
  });

  it('DKIM-17: given bh that is not base64, when verified, then permerror with dkim.syntax', async () => {
    const [r] = await verify(await sign(rsa, { bh: '***' }), [record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.syntax']]);
  });

  it('DKIM-3: given a missing bh or v=2, when verified, then permerror with dkim.missing-tag', async () => {
    const text = await sign(rsa);
    for (const broken of [text.replace(/bh=[^;]*; /, ''), text.replace('v=1', 'v=2')]) {
      const [r] = await verify(broken, [record(rsa)]);
      expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.missing-tag']]);
    }
  });

  it('DKIM-4: given an unknown algorithm, when verified, then permerror with dkim.unknown-algorithm', async () => {
    const text = (await sign(rsa)).replace('a=rsa-sha256', 'a=rsa-sha512');
    const [r] = await verify(text, [record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.unknown-algorithm']]);
  });

  it('DKIM-5: given h without from, i outside d, a bad c, or x not after t, when verified, then permerror with dkim.invalid-tag', async () => {
    const cases = [
      await sign(rsa, { h: 'to:subject', signed: [TO, SUBJECT] }),
      await sign(rsa, { extra: 'i=@other.example' }),
      (await sign(rsa)).replace('c=relaxed/relaxed', 'c=foo/relaxed'),
      await sign(rsa, { extra: `t=${NOW_S - 10}; x=${NOW_S - 20}` }),
    ];
    for (const text of cases) {
      const [r] = await verify(text, [record(rsa)]);
      expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.invalid-tag']]);
    }
  });

  it('DKIM-5: given d= or s= that is not a domain name, when verified, then permerror with dkim.invalid-tag and no DNS query', async () => {
    const text = await sign(rsa);
    const queried: string[] = [];
    const spy: Transport = async (q) => {
      queried.push(q.name);
      return { rcode: 'NXDOMAIN', records: [], authenticated: false };
    };
    for (const broken of [
      text.replace('d=example.com;', 'd=exa mple.com/x@y;'),
      text.replace('s=sel;', 's=foo bar;'),
    ]) {
      const [r] = await verify(broken, spy);
      expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.invalid-tag']]);
    }
    expect(queried).toEqual([]);
  });

  it('DKIM-5: given i= without @, when verified, then permerror with dkim.invalid-tag', async () => {
    const [r] = await verify(await sign(rsa, { extra: 'i=example.com' }), [record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.invalid-tag']]);
  });

  it('DKIM-5: given i in a subdomain of d, when verified, then it passes', async () => {
    const [r] = await verify(await sign(rsa, { extra: 'i=news@mail.example.com' }), [record(rsa)]);
    expect(r?.result).toBe('pass');
  });
});

describe('DKIM: time', () => {
  it('DKIM-6: given x before the reference time, when verified, then fail with dkim.expired', async () => {
    const text = await sign(rsa, { extra: `t=${NOW_S - 100}; x=${NOW_S - 1}` });
    const [r] = await verify(text, [record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['fail', ['dkim.expired']]);
  });

  it('DKIM-6: given t more than 5 minutes after the reference time, when verified, then it passes with dkim.future-timestamp', async () => {
    const [r] = await verify(await sign(rsa, { extra: `t=${NOW_S + 600}` }), [record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['pass', ['dkim.future-timestamp']]);
  });
});

describe('DKIM: key', () => {
  it('DKIM-8: given NXDOMAIN or NODATA, when verified, then permerror with dkim.no-key', async () => {
    const text = await sign(rsa);
    for (const t of [answer('NXDOMAIN'), answer('NOERROR')]) {
      const [r] = await verify(text, t);
      expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.no-key']]);
    }
  });

  it('DKIM-7: given SERVFAIL, when verified, then temperror', async () => {
    const [r] = await verify(await sign(rsa), answer('SERVFAIL'));
    expect(r?.result).toBe('temperror');
  });

  it('DNS-4: given offline mode without a record, when verified, then not-evaluated with reason offline', async () => {
    const [r] = await verify(await sign(rsa), []);
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'offline' });
  });

  it('DKIM-9: given an empty p=, when verified, then permerror with dkim.key-revoked', async () => {
    const [r] = await verify(await sign(rsa), [rawRecord('v=DKIM1; p=')]);
    expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.key-revoked']]);
  });

  it('DKIM-9: given a key that does not import or v other than DKIM1, when verified, then permerror with dkim.key-syntax', async () => {
    for (const data of ['v=DKIM1; p=AAAA', `v=DKIM2; p=${rsa.p}`]) {
      const [r] = await verify(await sign(rsa), [rawRecord(data)]);
      expect([r?.result, ids(r)], data).toEqual(['permerror', ['dkim.key-syntax']]);
    }
  });

  it('DKIM-9: given a PKCS#1 key record, when verified, then it passes', async () => {
    const [r] = await verify(await sign(rsa), [rawRecord(`v=DKIM1; k=rsa; p=${rsa.pkcs1}`)]);
    expect(r?.result).toBe('pass');
  });

  it('DKIM-10: given k, h, s, or t=s that do not fit, when verified, then permerror with dkim.key-mismatch', async () => {
    const cases: [string, Partial<SignOptions>][] = [
      [`v=DKIM1; k=ed25519; p=${ed.p}`, {}],
      [`v=DKIM1; k=rsa; h=sha1; p=${rsa.p}`, {}],
      [`v=DKIM1; k=rsa; s=other; p=${rsa.p}`, {}],
      [`v=DKIM1; k=rsa; t=s; p=${rsa.p}`, { extra: 'i=@mail.example.com' }],
    ];
    for (const [data, o] of cases) {
      const [r] = await verify(await sign(rsa, o), [rawRecord(data)]);
      expect([r?.result, ids(r)], data).toEqual(['permerror', ['dkim.key-mismatch']]);
    }
  });

  it('DKIM-10: given a 1024-bit RSA key, when verified, then it passes with dkim.weak-key', async () => {
    const [r] = await verify(await sign(rsa1024), [record(rsa1024)]);
    expect([r?.result, ids(r)]).toEqual(['pass', ['dkim.weak-key']]);
  });

  it('DKIM-10: given an RSA key under 1024 bits, when verified, then permerror with dkim.key-too-short', async () => {
    const small = await rsaKey(512);
    const [r] = await verify(await sign(small), [record(small)]);
    expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.key-too-short']]);
  });

  it('DKIM-10: given several key records where the first that parses is revoked, when verified, then both dkim.multiple-keys and dkim.key-revoked are reported', async () => {
    const [r] = await verify(await sign(rsa), [rawRecord('v=DKIM1; p='), record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.multiple-keys', 'dkim.key-revoked']]);
  });

  it('DKIM-10: given several key records, when verified, then the first that parses is used with dkim.multiple-keys', async () => {
    const [r] = await verify(await sign(rsa), [rawRecord('not a key'), record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['pass', ['dkim.multiple-keys']]);
  });

  it('DKIM-15: given a key with t=y, when verified, then the result is unchanged with dkim.testing', async () => {
    const [r] = await verify(await sign(rsa), [record(rsa, 't=y; ')]);
    expect([r?.result, ids(r)]).toEqual(['pass', ['dkim.testing']]);
  });
});

describe('DKIM: hashes and signature', () => {
  it('DKIM-13: given a changed body, when verified, then fail with dkim.body-hash-mismatch', async () => {
    const [r] = await verify((await sign(rsa)).replace('Hello', 'Hallo'), [record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['fail', ['dkim.body-hash-mismatch']]);
  });

  it('DKIM-14: given a changed signed header, when verified, then fail with dkim.signature-mismatch', async () => {
    const [r] = await verify((await sign(rsa)).replace('Subject: Hi', 'Subject: Ho'), [
      record(rsa),
    ]);
    expect([r?.result, ids(r)]).toEqual(['fail', ['dkim.signature-mismatch']]);
  });

  it('DKIM-12: given l= and text appended after it, when verified, then it passes with dkim.body-length', async () => {
    const [r] = await verify(`${await sign(rsa, { l: 7 })}appended\r\n`, [record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['pass', ['dkim.body-length']]);
  });

  it('DKIM-12: given l= larger than the body, when verified, then permerror with dkim.invalid-tag', async () => {
    const [r] = await verify(await sign(rsa, { l: 100 }), [record(rsa)]);
    expect([r?.result, ids(r)]).toEqual(['permerror', ['dkim.body-length', 'dkim.invalid-tag']]);
  });

  it('DKIM-13: given header-only input, when verified, then not-evaluated with reason no-body', async () => {
    const text = await sign(rsa);
    const [r] = await verify(text.slice(0, text.indexOf('\r\n\r\n') + 2), [record(rsa)]);
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'no-body' });
  });
});

describe('DKIM: limits, warnings, and trace', () => {
  it('DKIM-1: given more than 20 signatures, when verified, then the rest are not-evaluated with dkim.too-many-signatures', async () => {
    const text = await sign(rsa);
    const results = await verify(signatureOf(text).repeat(20) + text, [record(rsa)]);
    expect(results).toHaveLength(21);
    expect(results.slice(0, 20).every((r) => r.result === 'pass')).toBe(true);
    expect(results[20]).toMatchObject({ result: 'not-evaluated', reason: 'limit' });
    expect(ids(results[20])).toEqual(['dkim.too-many-signatures']);
  });

  it('DKIM: given From signed once and Subject not signed, when verified, then dkim.from-not-oversigned and dkim.unsigned-header', async () => {
    const text = await sign(rsa, { h: 'from:to:date:message-id', signed: [FROM, TO, DATE, MSGID] });
    const [r] = await verify(text, [record(rsa)]);
    expect(r?.result).toBe('pass');
    expect(ids(r)).toEqual(['dkim.from-not-oversigned', 'dkim.unsigned-header']);
  });

  it('DKIM-16: given a passing signature, when verified, then the trace has tags, key query, selected fields, header data, and body hashes', async () => {
    const [r] = await verify(await sign(rsa), [record(rsa)]);
    expect(r?.keyQueryId).toBe('q1');
    expect(r?.trace.tags).toContainEqual(['d', 'example.com']);
    expect(r?.trace.selectedHeaders).toEqual([1, 2, 3, 4, 5]);
    expect(r?.trace.headerData).toContain('subject:Hi\r\n');
    expect(r?.trace.body).toMatchObject({ canonical: 'Hello\r\n', length: 7 });
    expect(r?.trace.body?.computed).toBe(r?.trace.body?.expected);
  });

  it('REP-4: given any finding, when verified, then it has evidence pointing at the signature field', async () => {
    const [r] = await verify((await sign(rsa)).replace('Hello', 'Hallo'), [record(rsa)]);
    expect(r?.findings[0]?.evidence).toContainEqual({ kind: 'header', index: 0 });
  });
});

describe('DKIM: one signature failing does not affect the others', () => {
  /** Signed by `sel` (answered) and by `bad` (handled by `onBad`). */
  async function twoSignatures(onBad: Transport): Promise<[string, Transport]> {
    const good = signatureOf(await sign(rsa));
    const text = good + (await sign(rsa, { s: 'bad' }));
    const offline = offlineTransport([record(rsa)]);
    const transport: Transport = (q, s) =>
      q.name.startsWith('bad.') ? onBad(q, s) : offline(q, s);
    return [text, transport];
  }

  it('REP-7: given an unexpected error for one signature, when verified, then only that one is not-evaluated with internal-error', async () => {
    const [text, transport] = await twoSignatures(async () => {
      throw new TypeError('bug');
    });
    const results = await verify(text, transport);
    expect(results[0]?.result).toBe('pass');
    expect(results[1]).toMatchObject({
      result: 'not-evaluated',
      reason: 'internal-error',
      d: 'example.com',
      s: 'bad',
    });
    expect(ids(results[1])).toEqual(['analysis.internal-error']);
  });

  it('REP-8: given one key lookup that never answers, when the deadline passes, then only that signature is not-evaluated with timeout', async () => {
    const [text, transport] = await twoSignatures(
      (_q, s) => new Promise((_, reject) => s.addEventListener('abort', () => reject(s.reason))),
    );
    const results = await verify(text, transport, AbortSignal.timeout(50));
    expect(results[0]?.result).toBe('pass');
    expect(results[1]).toMatchObject({ result: 'not-evaluated', reason: 'timeout', s: 'bad' });
    expect(ids(results[1])).toEqual(['analysis.timeout']);
  });

  it('given the caller cancels, when verifying, then verifyDkim rejects with AbortError', async () => {
    const [text, transport] = await twoSignatures(
      (_q, s) => new Promise((_, reject) => s.addEventListener('abort', () => reject(s.reason))),
    );
    const controller = new AbortController();
    const pending = verify(text, transport, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('DKIM-1: given more than 20 signatures and a deadline, when it passes, then signatures past 20 keep reason limit', async () => {
    const sig = signatureOf(await sign(rsa, { s: 'bad' }));
    const hang: Transport = (_q, s) =>
      new Promise((_, reject) => s.addEventListener('abort', () => reject(s.reason)));
    const results = await verify(sig.repeat(21) + (await sign(rsa)), hang, AbortSignal.timeout(50));
    expect(results.slice(0, 20).every((r) => r.reason === 'timeout')).toBe(true);
    expect(results.slice(20).every((r) => r.reason === 'limit')).toBe(true);
  });
});

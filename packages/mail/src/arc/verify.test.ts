import { beforeAll, describe, expect, it } from 'vitest';
import { type Hop, messageText, seal, type TestMessage } from '../../test/support/arc-sealer.ts';
import { ed25519Key, rsaKey, type TestKey } from '../../test/support/keys.ts';
import { createDnsCache } from '../dns/cache.ts';
import { composeResolver } from '../dns/compose.ts';
import { type ManualRecord, offlineTransport } from '../dns/offline.ts';
import type { Lookup, Transport } from '../dns/types.ts';
import { splitHeaders } from '../message/headers.ts';
import { type ArcReport, verifyArc } from './verify.ts';

const enc = new TextEncoder();
const NOW = new Date('2026-10-24T00:00:00Z');
const NOW_S = NOW.getTime() / 1000;
const BASE: TestMessage = {
  headers: ['From: a@example.com\r\n', 'Subject: Hi\r\n'],
  body: 'Hello\r\n',
};

let rsa: TestKey;
let ed: TestKey;
beforeAll(async () => {
  [rsa, ed] = await Promise.all([rsaKey(2048), ed25519Key()]);
});

const record = (key: TestKey, s = 'arc', d = 'forwarder.example'): ManualRecord => ({
  name: `${s}._domainkey.${d}`,
  type: 'TXT',
  data: `v=DKIM1; k=${key.algorithm}; p=${key.p}`,
});
const hop = (o: Partial<Hop> = {}): Hop => ({ key: rsa, d: 'forwarder.example', s: 'arc', ...o });

async function chain(n: number, o: Partial<Hop> = {}, from = BASE): Promise<TestMessage> {
  let m = from;
  for (let i = 0; i < n; i++) m = await seal(m, hop(o));
  return m;
}

/** Applies `edit` to every header field; return null to drop one. */
const edit = (m: TestMessage, f: (field: string) => string | null): TestMessage => ({
  ...m,
  headers: m.headers.map(f).filter((x): x is string => x !== null),
});
const isArc = (name: string, i: number) => (f: string) =>
  f.toLowerCase().startsWith(`${name.toLowerCase()}:`) && f.includes(`i=${i};`);

async function verify(
  text: string,
  dns: readonly ManualRecord[] | Transport = [record(rsa)],
  signal: AbortSignal = new AbortController().signal,
): Promise<ArcReport> {
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
  return verifyArc({
    bytes,
    headers,
    body,
    resolve: (q, s) => r.resolve(q, s),
    referenceTime: NOW,
    signal,
  });
}

const ids = (r: ArcReport) => r.findings.map((f) => f.id);
const answer =
  (rcode: Lookup['rcode']): Transport =>
  async () => ({ rcode, records: [], authenticated: false });
const hang: Transport = (_q, s) =>
  new Promise((_, reject) => s.addEventListener('abort', () => reject(s.reason)));

describe('ARC: chains', () => {
  it('ARC-1: given no ARC fields, when validated, then the result is none', async () => {
    expect(await verify(messageText(BASE))).toEqual({ result: 'none', sets: [], findings: [] });
  });

  it('REQ-MAIL-007: given a chain of 1 set, when validated, then it passes with one trace row', async () => {
    const r = await verify(messageText(await chain(1)));
    expect(r).toMatchObject({ result: 'pass', oldestPass: 0, findings: [] });
    expect(r.sets).toEqual([
      {
        instance: 1,
        aar: {
          field: 2,
          authservId: 'mx.example.org',
          entries: [{ method: 'spf', result: 'pass', props: {} }],
        },
        ams: {
          field: 1,
          result: 'pass',
          d: 'forwarder.example',
          s: 'arc',
          t: '1790000000',
          keyQueryId: 'q1',
        },
        seal: {
          field: 0,
          result: 'pass',
          d: 'forwarder.example',
          s: 'arc',
          t: '1790000000',
          cv: 'none',
          keyQueryId: 'q1',
        },
      },
    ]);
  });

  it('REQ-MAIL-007: given a chain of 2 sets from different domains, when validated, then it passes', async () => {
    const one = await seal(BASE, hop());
    const two = await seal(one, hop({ key: ed, d: 'list.example', s: 'k2' }));
    const r = await verify(messageText(two), [record(rsa), record(ed, 'k2', 'list.example')]);
    expect(r.result).toBe('pass');
    expect(r.sets.map((s) => [s.instance, s.seal?.d, s.seal?.cv])).toEqual([
      [1, 'forwarder.example', 'none'],
      [2, 'list.example', 'pass'],
    ]);
  });

  it('REQ-MAIL-007: given a chain of 50 sets, when validated, then it passes', async () => {
    const m = await chain(50, { key: ed });
    const r = await verify(messageText(m), [record(ed)]);
    expect(r.result).toBe('pass');
    expect(r.sets).toHaveLength(50);
  });
});

describe('ARC: structure', () => {
  it('ARC-1: given an instance over 50, when validated, then it fails with arc.too-many-sets', async () => {
    const m = edit(await chain(1), (f) => f.replace(/: i=1;/, ': i=51;'));
    const r = await verify(messageText(m));
    expect(r.result).toBe('fail');
    expect(ids(r)).toContain('arc.too-many-sets');
  });

  it('ARC-2: given the highest seal with cv=fail, when validated, then it fails with arc.cv-fail', async () => {
    const m = await seal(await chain(1), hop({ cv: 'fail' }));
    const r = await verify(messageText(m));
    expect(r.result).toBe('fail');
    expect(ids(r)).toEqual(['arc.cv-fail']);
  });

  const broken: [string, () => Promise<TestMessage>][] = [
    [
      'a set without its AAR',
      async () =>
        edit(await chain(1), (f) => (isArc('ARC-Authentication-Results', 1)(f) ? null : f)),
    ],
    [
      'a gap between instances',
      async () => edit(await chain(2), (f) => f.replace(/: i=2;/, ': i=3;')),
    ],
    [
      'two AMS in one set',
      async () => {
        const m = await chain(1);
        const ams = m.headers.find(isArc('ARC-Message-Signature', 1)) as string;
        return { ...m, headers: [ams, ...m.headers] };
      },
    ],
    ['set 1 with cv=pass', () => chain(1, { cv: 'pass' })],
    ['a set above 1 with cv=none', async () => seal(await chain(1), hop({ cv: 'none' }))],
    ['a cv that is not none, pass, or fail', () => chain(1, { cv: 'maybe' })],
    [
      'a field without i=',
      async () => {
        const m = await chain(1);
        return {
          ...m,
          headers: ['ARC-Authentication-Results: mx.example.org; spf=pass\r\n', ...m.headers],
        };
      },
    ],
    ['an AS with h=', () => chain(1, { sealExtra: 'h=from' })],
    [
      'an AMS without bh=',
      async () =>
        edit(await chain(1), (f) =>
          isArc('ARC-Message-Signature', 1)(f) ? f.replace(/ bh=[^;]*;/, '') : f,
        ),
    ],
    [
      'an AMS with an unknown algorithm',
      async () =>
        edit(await chain(1), (f) =>
          isArc('ARC-Message-Signature', 1)(f) ? f.replace('a=rsa-sha256', 'a=rsa-md5') : f,
        ),
    ],
    [
      'an AS with a bad d=',
      async () =>
        edit(await chain(1), (f) =>
          isArc('ARC-Seal', 1)(f) ? f.replace('d=forwarder.example', 'd=a/b') : f,
        ),
    ],
  ];
  for (const [what, build] of broken) {
    it(`ARC-3: given ${what}, when validated, then it fails with arc.structure and no key is fetched`, async () => {
      let queries = 0;
      const counting: Transport = async () => {
        queries++;
        return { rcode: 'NXDOMAIN', records: [], authenticated: false };
      };
      const r = await verify(messageText(await build()), counting);
      expect(r.result).toBe('fail');
      expect(ids(r)).toContain('arc.structure');
      expect(queries).toBe(0);
      expect(r.sets.flatMap((s) => [s.ams?.result, s.seal?.result]).filter(Boolean)).not.toContain(
        'pass',
      );
    });
  }
});

describe('ARC: malformed fields', () => {
  it('ARC-3: given fields with i=0, when validated, then those fields are the structure error and no gap is claimed', async () => {
    const m = await chain(1);
    const zero = m.headers.map((f) => f.replace(/: i=1;/, ': i=0;'));
    const r = await verify(messageText({ ...m, headers: [...zero, ...m.headers] }));
    expect(r.result).toBe('fail');
    expect(r.findings).toEqual([
      expect.objectContaining({
        id: 'arc.structure',
        evidence: [
          { kind: 'header', index: 0 },
          { kind: 'header', index: 1 },
          { kind: 'header', index: 2 },
        ],
      }),
    ]);
  });

  it('ARC-10: given an AAR with only its i= tag, when validated, then its authserv-id is empty', async () => {
    const m = edit(await chain(1), (f) =>
      isArc('ARC-Authentication-Results', 1)(f) ? 'ARC-Authentication-Results: i=1\r\n' : f,
    );
    const r = await verify(messageText(m));
    expect(r.sets[0]?.aar).toEqual({ field: 2, authservId: '', entries: [] });
  });

  it('ARC-5: given an AMS whose l= is longer than the body, when validated, then it fails with arc.ams-mismatch saying so', async () => {
    const m = edit(await chain(1), (f) =>
      isArc('ARC-Message-Signature', 1)(f) ? f.replace(' t=', ' l=999999; t=') : f,
    );
    const r = await verify(messageText(m));
    expect(r.result).toBe('fail');
    // Editing the AMS also breaks the seal over it.
    expect(r.findings).toContainEqual(
      expect.objectContaining({ id: 'arc.ams-mismatch', message: expect.stringContaining('l=') }),
    );
  });
});

describe('ARC: signatures', () => {
  it('ARC-5: given a body changed after the last hop, when validated, then it fails with arc.ams-mismatch', async () => {
    const m = { ...(await chain(1)), body: 'Changed\r\n' };
    const r = await verify(messageText(m));
    expect(r.result).toBe('fail');
    expect(ids(r)).toEqual(['arc.ams-mismatch']);
    expect(r.sets[0]?.ams?.result).toBe('fail');
    expect(r.sets[0]?.seal?.result).toBe('pass');
  });

  it('ARC-7: given an earlier AAR changed after sealing, when validated, then it fails with arc.seal-mismatch', async () => {
    const m = edit(await chain(2), (f) =>
      isArc('ARC-Authentication-Results', 1)(f) ? f.replace('spf=pass', 'spf=fail') : f,
    );
    const r = await verify(messageText(m));
    expect(r.result).toBe('fail');
    expect(ids(r)).toEqual(['arc.seal-mismatch', 'arc.seal-mismatch']);
    expect(r.sets.map((s) => s.seal?.result)).toEqual(['fail', 'fail']);
  });

  it('ARC-6: given a hop that changed the body, when validated, then oldestPass points after it and arc.modified-after is reported', async () => {
    const one = await seal(BASE, hop());
    const two = await seal({ ...one, body: 'Hello, list\r\n' }, hop());
    const r = await verify(messageText(two));
    expect(r).toMatchObject({ result: 'pass', oldestPass: 2 });
    expect(ids(r)).toEqual(['arc.modified-after']);
    expect(r.sets.map((s) => s.ams?.result)).toEqual(['fail', 'pass']);
  });

  it('ARC-6: given the last AMS fails, when validated, then there is no oldestPass', async () => {
    const r = await verify(messageText({ ...(await chain(2)), body: 'x\r\n' }));
    expect(r.result).toBe('fail');
    expect(r.oldestPass).toBeUndefined();
  });

  it('ARC-8: given no key record, when validated, then it fails with arc.key pointing at the query', async () => {
    const r = await verify(messageText(await chain(1)), answer('NXDOMAIN'));
    expect(r.result).toBe('fail');
    expect(r.findings[0]).toMatchObject({ id: 'arc.key', severity: 'error' });
    expect(r.findings[0]?.evidence).toContainEqual({ kind: 'dns', queryId: 'q1' });
  });

  it('ARC-8: given SERVFAIL for the key, when validated, then it fails with arc.key', async () => {
    const r = await verify(messageText(await chain(1)), answer('SERVFAIL'));
    expect(r.result).toBe('fail');
    expect(ids(r)).toContain('arc.key');
  });

  it('ARC-9: given a seal time in the future, when validated, then it passes with arc.future-timestamp', async () => {
    const r = await verify(messageText(await chain(1, { t: NOW_S + 3600 })));
    expect(r.result).toBe('pass');
    expect(ids(r)).toContain('arc.future-timestamp');
  });
});

describe('ARC: not evaluated', () => {
  it('ARC-11: given offline mode without the key, when validated, then it is not-evaluated with offline', async () => {
    const r = await verify(messageText(await chain(1)), []);
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'offline' });
    expect(r.sets[0]?.seal).toMatchObject({ result: 'not-evaluated', reason: 'offline' });
  });

  it('ARC-11: given the DNS budget is spent, when validated, then it is not-evaluated with budget-exhausted', async () => {
    const r = await verify(messageText(await chain(1)), answer('BUDGET'));
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'budget-exhausted' });
  });

  it('ARC-11: given header-only input, when validated, then the AMS is not-evaluated with no-body and the seals are verified', async () => {
    const m = await chain(1);
    const r = await verify(m.headers.join(''));
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'no-body' });
    expect(r.sets[0]?.seal?.result).toBe('pass');
  });

  it('ARC-11: given header-only input and a broken seal, when validated, then fail wins', async () => {
    const m = edit(await chain(1), (f) =>
      isArc('ARC-Authentication-Results', 1)(f) ? f.replace('spf=pass', 'spf=fail') : f,
    );
    const r = await verify(m.headers.join(''));
    expect(r.result).toBe('fail');
  });

  it('ARC-12: given an unexpected error, when validated, then it is not-evaluated with internal-error pointing at the ARC fields', async () => {
    const broken: Transport = async () => {
      throw new TypeError('bug');
    };
    const r = await verify(messageText(await chain(1)), broken);
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'internal-error' });
    expect(r.findings).toEqual([
      expect.objectContaining({
        id: 'analysis.internal-error',
        evidence: [
          { kind: 'header', index: 0 },
          { kind: 'header', index: 1 },
          { kind: 'header', index: 2 },
        ],
      }),
    ]);
  });

  it('ARC-12: given DNS that never answers, when the deadline passes, then it is not-evaluated with timeout', async () => {
    const r = await verify(messageText(await chain(1)), hang, AbortSignal.timeout(50));
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'timeout' });
    expect(ids(r)).toEqual(['analysis.timeout']);
  });

  it('given the caller cancels, when validating, then it rejects with AbortError', async () => {
    const controller = new AbortController();
    const pending = verify(messageText(await chain(1)), hang, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

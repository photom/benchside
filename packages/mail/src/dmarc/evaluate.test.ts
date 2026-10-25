import { describe, expect, it } from 'vitest';
import type { DkimSignatureResult } from '../dkim/verify.ts';
import { createDnsCache } from '../dns/cache.ts';
import { composeResolver } from '../dns/compose.ts';
import type { DnsType, Lookup, Transport } from '../dns/types.ts';
import { splitHeaders } from '../message/headers.ts';
import type { SpfIdentityResult, SpfResults } from '../spf/evaluate.ts';
import { type DmarcModeResult, evaluateDmarc } from './evaluate.ts';

type Zone = Record<string, Partial<Record<DnsType, string[]>> | Lookup['rcode']>;

function zoneTransport(zone: Zone): Transport {
  return async (q) => {
    const entry = zone[q.name];
    if (entry === undefined) return { rcode: 'NXDOMAIN', records: [], authenticated: false };
    if (typeof entry === 'string') return { rcode: entry, records: [], authenticated: false };
    return { rcode: 'NOERROR', records: entry[q.type] ?? [], authenticated: false };
  };
}

const identity = (o: Partial<SpfIdentityResult>): SpfIdentityResult => ({
  result: 'none',
  counters: { dnsTerms: 0, voids: 0 },
  findings: [],
  ...o,
});
const spfFor = (domain: string, result: SpfIdentityResult['result']): SpfResults => ({
  mailFrom: identity({ result, domain }),
  helo: identity({}),
});
const NO_SPF: SpfResults = { mailFrom: identity({}), helo: identity({}) };
const dkimSig = (
  d: string,
  result: DkimSignatureResult['result'],
  reason?: DkimSignatureResult['reason'],
): DkimSignatureResult => ({
  field: 0,
  result,
  ...(reason ? { reason } : {}),
  d,
  findings: [],
  trace: { tags: [], selectedHeaders: [] },
});

async function dmarc(
  o: {
    from?: string[];
    zone?: Zone | Transport;
    spf?: SpfResults;
    dkim?: DkimSignatureResult[];
    dkimUnavailable?: 'internal-error';
    signal?: AbortSignal;
  } = {},
): Promise<DmarcModeResult> {
  const lines = (o.from ?? ['a@example.com']).map((f) => `From: ${f}`);
  const { headers } = splitHeaders(new TextEncoder().encode(`${lines.join('\r\n')}\r\n\r\nx\r\n`));
  const zone = o.zone ?? {};
  const r = composeResolver({
    transport: typeof zone === 'function' ? zone : zoneTransport(zone),
    source: 'offline',
    cache: createDnsCache(),
    budget: 200,
    allowSensitive: false,
  });
  const results = await evaluateDmarc({
    headers,
    spf: o.spf ?? NO_SPF,
    dkim: o.dkim ?? [],
    ...(o.dkimUnavailable ? { dkimUnavailable: o.dkimUnavailable } : {}),
    resolve: r.resolve,
    signal: o.signal ?? new AbortController().signal,
  });
  return results.rfc9989;
}
const ids = (r: DmarcModeResult) => r.findings.map((f) => f.id);
const record = (text: string): Zone => ({ '_dmarc.example.com': { TXT: [text] } });

describe('DMARC: author domain', () => {
  it('DMARC-1: given no From field or two, when evaluated, then not-evaluated with dmarc.from-invalid', async () => {
    for (const from of [[], ['a@example.com', 'b@example.com']]) {
      const r = await dmarc({ from });
      expect([r.result, ids(r)]).toEqual(['not-evaluated', ['dmarc.from-invalid']]);
    }
  });

  it('DMARC-2: given addresses in two domains, when evaluated, then not-evaluated with dmarc.from-invalid', async () => {
    const r = await dmarc({ from: ['a@example.com, b@example.org'] });
    expect([r.result, r.reason, ids(r)]).toEqual([
      'not-evaluated',
      'invalid-input',
      ['dmarc.from-invalid'],
    ]);
  });

  it('DMARC-2: given two addresses in one domain, when evaluated, then that domain is used with dmarc.from-multiple-addresses', async () => {
    const r = await dmarc({
      from: ['a@example.com, b@Example.com'],
      zone: record('v=DMARC1; p=none'),
    });
    expect(r.authorDomain).toBe('example.com');
    expect(ids(r)).toContain('dmarc.from-multiple-addresses');
  });
});

describe('DMARC: result and alignment', () => {
  it('DMARC-9: given no DMARC record, when evaluated, then none', async () => {
    expect((await dmarc({ spf: spfFor('example.com', 'pass') })).result).toBe('none');
  });

  it('DMARC-12, DMARC-14: given SPF pass for the author domain, when evaluated, then pass with disposition none', async () => {
    const r = await dmarc({
      zone: record('v=DMARC1; p=reject; rua=mailto:d@example.com'),
      spf: spfFor('example.com', 'pass'),
    });
    expect(r).toMatchObject({ result: 'pass', disposition: 'none', policy: 'reject' });
    expect(r.alignment).toEqual([
      {
        identifier: 'spf',
        domain: 'example.com',
        authResult: 'pass',
        mode: 'relaxed',
        orgDomain: 'example.com',
        aligned: true,
        counts: true,
      },
    ]);
  });

  it('DMARC-13, DMARC-14: given DKIM pass for a subdomain, when relaxed, then it is aligned through the organizational domain', async () => {
    const r = await dmarc({
      zone: record('v=DMARC1; p=reject; rua=mailto:d@example.com'),
      dkim: [dkimSig('mail.example.com', 'pass')],
    });
    expect(r.result).toBe('pass');
    expect(r.alignment[0]).toMatchObject({
      identifier: 'dkim',
      domain: 'mail.example.com',
      orgDomain: 'example.com',
      aligned: true,
    });
  });

  it('DMARC-14: given adkim=s and DKIM pass for a subdomain, when evaluated, then not aligned and fail with the policy as disposition', async () => {
    const r = await dmarc({
      zone: record('v=DMARC1; p=reject; adkim=s; rua=mailto:d@example.com'),
      dkim: [dkimSig('mail.example.com', 'pass')],
    });
    expect(r).toMatchObject({ result: 'fail', disposition: 'reject' });
    expect(r.alignment[0]).toMatchObject({ mode: 'strict', aligned: false, counts: false });
  });

  it('DMARC-12: given SPF pass for another domain, when evaluated, then fail', async () => {
    const r = await dmarc({
      zone: record('v=DMARC1; p=quarantine; rua=mailto:d@example.com'),
      spf: spfFor('other.example', 'pass'),
    });
    expect(r).toMatchObject({ result: 'fail', disposition: 'quarantine' });
  });

  it('DMARC-24: given an aligned DKIM signature not evaluated offline and nothing passing, when evaluated, then not-evaluated with offline', async () => {
    const r = await dmarc({
      zone: record('v=DMARC1; p=reject; rua=mailto:d@example.com'),
      dkim: [dkimSig('example.com', 'not-evaluated', 'offline')],
    });
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'offline' });
    expect(r.disposition).toBeUndefined();
  });

  it('DMARC-24: given an aligned SPF temperror and nothing passing, when evaluated, then temperror', async () => {
    const r = await dmarc({
      zone: record('v=DMARC1; p=reject'),
      spf: spfFor('example.com', 'temperror'),
    });
    expect(r.result).toBe('temperror');
  });

  it('DMARC-23: given SERVFAIL on discovery, when evaluated, then temperror; offline, then not-evaluated', async () => {
    expect((await dmarc({ zone: { '_dmarc.example.com': 'SERVFAIL' } })).result).toBe('temperror');
    expect(await dmarc({ zone: { '_dmarc.example.com': 'OFFLINE' } })).toMatchObject({
      result: 'not-evaluated',
      reason: 'offline',
    });
  });
});

describe('DMARC: incomplete inputs', () => {
  it('DMARC-24: given DKIM could not run and nothing passing, when evaluated, then not-evaluated with internal-error', async () => {
    const r = await dmarc({
      zone: record('v=DMARC1; p=reject; rua=mailto:d@example.com'),
      dkimUnavailable: 'internal-error',
    });
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'internal-error' });
    expect(r.disposition).toBeUndefined();
  });

  it('DMARC-24: given a failed signature from another domain whose walk is offline, when evaluated, then the result is still fail', async () => {
    const r = await dmarc({
      zone: {
        ...record('v=DMARC1; p=reject; rua=mailto:d@example.com'),
        '_dmarc.mail.example.com': 'OFFLINE',
      },
      dkim: [dkimSig('mail.example.com', 'fail')],
    });
    expect(r.result).toBe('fail');
  });

  it('DMARC-24: given a passing subdomain signature whose walk is offline, when evaluated, then not-evaluated with offline', async () => {
    const r = await dmarc({
      zone: {
        ...record('v=DMARC1; p=reject; rua=mailto:d@example.com'),
        '_dmarc.mail.example.com': 'OFFLINE',
      },
      dkim: [dkimSig('mail.example.com', 'pass')],
    });
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'offline' });
  });

  it('DMARC-25: given signatures from unrelated domains, when relaxed, then their organizational domains are not looked up', async () => {
    const asked: string[] = [];
    const zone = zoneTransport(record('v=DMARC1; p=reject; rua=mailto:d@example.com'));
    const r = await dmarc({
      zone: async (q, s) => {
        asked.push(q.name);
        return zone(q, s);
      },
      dkim: [dkimSig('esp.example.net', 'pass'), dkimSig('other.example.org', 'fail')],
    });
    expect(r.result).toBe('fail');
    expect(asked.filter((n) => n.includes('example.net') || n.includes('example.org'))).toEqual([]);
  });

  it('REP-8: given a lookup that never answers, when the deadline passes, then the queries made so far are kept', async () => {
    const zone = zoneTransport({ '_dmarc.example.com': { TXT: ['v=DMARC1; p=reject'] } });
    const r = await dmarc({
      from: ['a@sub.example.com'],
      zone: (q, s) =>
        q.type === 'A'
          ? new Promise((_, reject) => s.addEventListener('abort', () => reject(s.reason)))
          : zone(q, s),
      signal: AbortSignal.timeout(50),
    });
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'timeout' });
    expect(r.queryIds.length).toBeGreaterThanOrEqual(2);
  });
});

describe('DMARC: policy', () => {
  const parent = (text: string, authorExists: boolean): Zone => ({
    '_dmarc.example.com': { TXT: [text] },
    ...(authorExists ? { 'sub.example.com': {} } : {}),
  });

  it('DMARC-15, DMARC-16: given a record at the organizational domain and an existing author domain, when evaluated, then sp applies', async () => {
    const r = await dmarc({
      from: ['a@sub.example.com'],
      zone: parent('v=DMARC1; p=reject; sp=quarantine; np=none; rua=mailto:d@example.com', true),
    });
    expect(r).toMatchObject({
      result: 'fail',
      policy: 'quarantine',
      policySource: 'sp',
      recordAt: 'example.com',
    });
  });

  it('DMARC-15, DMARC-16: given an author domain that does not exist, when evaluated, then np applies', async () => {
    const r = await dmarc({
      from: ['a@sub.example.com'],
      zone: parent(
        'v=DMARC1; p=quarantine; sp=quarantine; np=reject; rua=mailto:d@example.com',
        false,
      ),
    });
    expect(r).toMatchObject({ policy: 'reject', policySource: 'np' });
  });

  it('DMARC-17: given t=y, when evaluated, then reject is lowered to quarantine', async () => {
    const r = await dmarc({ zone: record('v=DMARC1; p=reject; t=y; rua=mailto:d@example.com') });
    expect(r).toMatchObject({
      result: 'fail',
      declaredPolicy: 'reject',
      policy: 'quarantine',
      testing: true,
      disposition: 'quarantine',
    });
  });

  it('DMARC-11: given no p, when evaluated, then the policy is none', async () => {
    expect((await dmarc({ zone: record('v=DMARC1; rua=mailto:d@example.com') })).policy).toBe(
      'none',
    );
  });

  it('DMARC-11: given an invalid p with a valid rua, when evaluated, then the policy is none; without rua, not-evaluated with dmarc.invalid-policy', async () => {
    expect(
      (await dmarc({ zone: record('v=DMARC1; p=block; rua=mailto:d@example.com') })).policy,
    ).toBe('none');
    const r = await dmarc({ zone: record('v=DMARC1; p=block') });
    expect([r.result, ids(r)]).toEqual(['not-evaluated', ['dmarc.invalid-policy']]);
  });

  it('DMARC-10: given tags of RFC 7489 only, when evaluated in rfc9989 mode, then dmarc.ignored-tag', async () => {
    const r = await dmarc({ zone: record('v=DMARC1; p=reject; pct=50; rua=mailto:d@example.com') });
    expect(ids(r)).toContain('dmarc.ignored-tag');
  });

  it('DMARC findings: given p=none without rua, when evaluated, then dmarc.policy-none and dmarc.no-rua', async () => {
    const r = await dmarc({ zone: record('v=DMARC1; p=none') });
    expect(ids(r)).toEqual(expect.arrayContaining(['dmarc.policy-none', 'dmarc.no-rua']));
  });
});

describe('DMARC: guards', () => {
  it('REP-7: given an unexpected error, when evaluated, then not-evaluated with internal-error', async () => {
    const broken: Transport = async () => {
      throw new TypeError('bug');
    };
    const r = await dmarc({ zone: broken });
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'internal-error' });
    expect(ids(r)).toEqual(['analysis.internal-error']);
  });
});

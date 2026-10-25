import { describe, expect, it } from 'vitest';
import { createDnsCache } from '../dns/cache.ts';
import { composeResolver } from '../dns/compose.ts';
import type { DnsType, Lookup, Transport } from '../dns/types.ts';
import type { Envelope } from '../envelope/values.ts';
import { evaluateSpf, type SpfIdentityResult } from './evaluate.ts';

type Zone = Record<string, Partial<Record<DnsType, string[]>> | Lookup['rcode']>;

/** Answers from `zone`; a name without records of the type is NODATA, an unknown name NXDOMAIN. */
function zoneTransport(zone: Zone): Transport {
  return async (q) => {
    const entry = zone[q.name.toLowerCase()];
    if (entry === undefined) return { rcode: 'NXDOMAIN', records: [], authenticated: false };
    if (typeof entry === 'string') return { rcode: entry, records: [], authenticated: false };
    return { rcode: 'NOERROR', records: entry[q.type] ?? [], authenticated: false };
  };
}

const at = (field: number, rule: string) => ({ field, rule });
const ENVELOPE: Envelope = {
  clientIp: { value: '192.0.2.10', source: at(3, 'ENV-11') },
  helo: { value: 'mx.example.com', source: at(3, 'ENV-12') },
  mailFrom: { value: 'bounce@example.com', source: at(1, 'ENV-13') },
};

async function spf(
  zone: Zone | Transport,
  o: { envelope?: Envelope; allowSensitive?: boolean; signal?: AbortSignal } = {},
) {
  const r = composeResolver({
    transport: typeof zone === 'function' ? zone : zoneTransport(zone),
    source: 'offline',
    cache: createDnsCache(),
    budget: 200,
    allowSensitive: o.allowSensitive ?? false,
  });
  const results = await evaluateSpf({
    envelope: o.envelope ?? ENVELOPE,
    resolve: r.resolve,
    signal: o.signal ?? new AbortController().signal,
    referenceTime: new Date('2026-10-24T00:00:00Z'),
    receiver: 'mx.example.org',
  });
  return { ...results, log: r.log };
}
const mailFrom = async (record: string | string[], zone: Zone = {}, o = {}) =>
  (await spf({ 'example.com': { TXT: [record].flat() }, ...zone }, o)).mailFrom;
const ids = (r: SpfIdentityResult) => r.findings.map((f) => f.id);

describe('SPF: identities', () => {
  it('SPF-1, SPF-2: given a record that lists the client, when evaluated, then MAIL FROM and HELO are checked with their own domains', async () => {
    const r = await spf({
      'example.com': { TXT: ['v=spf1 ip4:192.0.2.0/24 -all'] },
      'mx.example.com': { TXT: ['v=spf1 a -all'], A: ['192.0.2.10'] },
    });
    expect(r.mailFrom).toMatchObject({
      result: 'pass',
      domain: 'example.com',
      sender: 'bounce@example.com',
    });
    expect(r.helo).toMatchObject({
      result: 'pass',
      domain: 'mx.example.com',
      sender: 'postmaster@mx.example.com',
    });
  });

  it('SPF-1, DNS-13: given a null MAIL FROM, when evaluated, then the HELO check is done once and reused', async () => {
    const r = await spf(
      { 'mx.example.com': { TXT: ['v=spf1 +all'] } },
      { envelope: { ...ENVELOPE, mailFrom: { value: '', source: at(1, 'ENV-13') } } },
    );
    expect(r.log).toHaveLength(1);
    expect(r.mailFrom.result).toBe('pass');
    expect(r.helo.result).toBe('pass');
  });

  it('SPF-1: given a null MAIL FROM, when evaluated, then postmaster@HELO is used with spf.helo-only', async () => {
    const r = await spf(
      { 'mx.example.com': { TXT: ['v=spf1 +all'] } },
      { envelope: { ...ENVELOPE, mailFrom: { value: '', source: at(1, 'ENV-13') } } },
    );
    expect(r.mailFrom).toMatchObject({
      domain: 'mx.example.com',
      sender: 'postmaster@mx.example.com',
    });
    expect(ids(r.mailFrom)).toContain('spf.helo-only');
  });

  it('SPF-3: given no client IP, when evaluated, then both identities are not-evaluated with missing-delivery-detail', async () => {
    const { clientIp: _, ...envelope } = ENVELOPE;
    const r = await spf({}, { envelope });
    for (const id of [r.mailFrom, r.helo]) {
      expect(id).toMatchObject({ result: 'not-evaluated', reason: 'missing-delivery-detail' });
    }
  });

  it('SPF-3: given no MAIL FROM, when evaluated, then MAIL FROM is not-evaluated and HELO is still checked', async () => {
    const { mailFrom: _, ...envelope } = ENVELOPE;
    const r = await spf({ 'mx.example.com': { TXT: ['v=spf1 -all'] } }, { envelope });
    expect(r.mailFrom).toMatchObject({
      result: 'not-evaluated',
      reason: 'missing-delivery-detail',
    });
    expect(r.helo.result).toBe('fail');
  });

  it('SPF-3: given a HELO that is an address literal, when evaluated, then the HELO result is none', async () => {
    const r = await spf(
      { 'example.com': { TXT: ['v=spf1 -all'] } },
      { envelope: { ...ENVELOPE, helo: { value: '[192.0.2.10]', source: at(3, 'ENV-12') } } },
    );
    expect(r.helo.result).toBe('none');
  });

  it('SPF-20: given a MAIL FROM without a local part, when evaluated, then the sender is postmaster@domain', async () => {
    const r = await spf(
      { 'example.com': { TXT: ['v=spf1 -all'] } },
      { envelope: { ...ENVELOPE, mailFrom: { value: '@example.com', source: at(1, 'ENV-13') } } },
    );
    expect(r.mailFrom.sender).toBe('postmaster@example.com');
  });
});

describe('SPF: record selection', () => {
  it('SPF-6: given no SPF record, when evaluated, then none', async () => {
    expect((await mailFrom('some other text')).result).toBe('none');
  });

  it('SPF-6: given two SPF records, when evaluated, then permerror with spf.multiple-records', async () => {
    const r = await mailFrom(['v=spf1 -all', 'v=spf1 +all']);
    expect([r.result, ids(r)]).toEqual(['permerror', ['spf.multiple-records']]);
  });

  it('SPF-5: given v=spf10 and a record starting V=SPF1, when evaluated, then only the second is an SPF record', async () => {
    expect((await mailFrom(['v=spf10 +all', 'V=SPF1 -all'])).result).toBe('fail');
  });

  it('SPF-7: given NXDOMAIN, when evaluated, then none', async () => {
    expect((await spf({})).mailFrom.result).toBe('none');
  });

  it('SPF-7: given a MAIL FROM domain that is not a domain name, when evaluated, then none without a query', async () => {
    const r = await spf(
      {},
      { envelope: { ...ENVELOPE, mailFrom: { value: 'a@localhost', source: at(1, 'ENV-13') } } },
    );
    expect(r.mailFrom.result).toBe('none');
    expect(r.mailFrom.trace?.queryId).toBeUndefined();
  });

  it('SPF-21: given SERVFAIL for the record, when evaluated, then temperror; offline without the record, not-evaluated', async () => {
    expect((await spf({ 'example.com': 'SERVFAIL' })).mailFrom.result).toBe('temperror');
    expect((await spf({ 'example.com': 'OFFLINE' })).mailFrom).toMatchObject({
      result: 'not-evaluated',
      reason: 'offline',
    });
  });

  it('SPF-8: given a syntax error after a matching term, when evaluated, then permerror with spf.syntax', async () => {
    const r = await mailFrom('v=spf1 +all foo:bar');
    expect([r.result, ids(r)]).toEqual(['permerror', ['spf.syntax']]);
  });
});

describe('SPF: mechanisms', () => {
  it('SPF-4: given each qualifier on all, when evaluated, then pass, fail, softfail, neutral', async () => {
    const results = [];
    for (const q of ['+', '-', '~', '?']) results.push((await mailFrom(`v=spf1 ${q}all`)).result);
    expect(results).toEqual(['pass', 'fail', 'softfail', 'neutral']);
  });

  it('SPF-4: given no term matches and no redirect, when evaluated, then neutral', async () => {
    expect((await mailFrom('v=spf1 ip4:198.51.100.1')).result).toBe('neutral');
  });

  it('SPF-22: given ip6 and an IPv4 client, when evaluated, then it does not match', async () => {
    expect((await mailFrom('v=spf1 ip6:::/0 -all')).result).toBe('fail');
  });

  it('SPF-22: given a with a CIDR length, when the client is in that network, then pass', async () => {
    const r = await mailFrom('v=spf1 a:web.example.com/24 -all', {
      'web.example.com': { A: ['192.0.2.200'] },
    });
    expect(r.result).toBe('pass');
  });

  it('SPF-22: given an IPv6 client and a, when evaluated, then AAAA is queried', async () => {
    const r = await spf(
      { 'example.com': { TXT: ['v=spf1 a -all'], AAAA: ['2001:db8::10'] } },
      { envelope: { ...ENVELOPE, clientIp: { value: '2001:db8::10', source: at(3, 'ENV-11') } } },
    );
    expect(r.mailFrom.result).toBe('pass');
  });

  it('SPF-22: given mx, when the client is one of the MX hosts, then pass', async () => {
    const r = await mailFrom('v=spf1 mx -all', {
      'example.com': {
        TXT: ['v=spf1 mx -all'],
        MX: ['10 mx1.example.com.', '20 mx2.example.com.'],
      },
      'mx1.example.com': { A: ['198.51.100.1'] },
      'mx2.example.com': { A: ['192.0.2.10'] },
    });
    expect(r.result).toBe('pass');
  });

  it('SPF-22: given exists, when the name has an A record, then pass', async () => {
    const r = await mailFrom('v=spf1 exists:ok.example.net -all', {
      'ok.example.net': { A: ['127.0.0.2'] },
    });
    expect(r.result).toBe('pass');
  });

  it('SPF-11: given include whose record passes, when evaluated, then the include matches and the trace nests', async () => {
    const r = await mailFrom('v=spf1 include:_spf.example.net -all', {
      '_spf.example.net': { TXT: ['v=spf1 ip4:192.0.2.10 -all'] },
    });
    expect(r.result).toBe('pass');
    expect(r.trace?.terms[0]).toMatchObject({
      term: 'include:_spf.example.net',
      outcome: 'match',
      child: { domain: '_spf.example.net', result: 'pass' },
    });
    expect(r.trace?.terms[1]?.outcome).toBe('not-reached');
  });

  it('SPF-11: given include whose record fails, when evaluated, then the include does not match', async () => {
    const r = await mailFrom('v=spf1 include:_spf.example.net ~all', {
      '_spf.example.net': { TXT: ['v=spf1 -all'] },
    });
    expect(r.result).toBe('softfail');
  });

  it('SPF-11: given include of a domain without a record, when evaluated, then permerror', async () => {
    expect((await mailFrom('v=spf1 include:none.example.net -all')).result).toBe('permerror');
  });

  it('SPF-10: given no match and redirect, when evaluated, then the redirect target decides', async () => {
    const r = await mailFrom('v=spf1 ip4:198.51.100.1 redirect=_spf.example.net', {
      '_spf.example.net': { TXT: ['v=spf1 ip4:192.0.2.10 -all'] },
    });
    expect(r.result).toBe('pass');
  });

  it('SPF-10: given a redirect target without a record, when evaluated, then permerror', async () => {
    expect((await mailFrom('v=spf1 redirect=none.example.net')).result).toBe('permerror');
  });

  it('SPF-10: given all and redirect, when evaluated, then redirect is ignored', async () => {
    const r = await mailFrom('v=spf1 -all redirect=_spf.example.net', {
      '_spf.example.net': { TXT: ['v=spf1 +all'] },
    });
    expect(r.result).toBe('fail');
  });

  it('SPF-23: given SERVFAIL inside a term, when evaluated, then temperror', async () => {
    expect(
      (await mailFrom('v=spf1 a:broken.example.net -all', { 'broken.example.net': 'SERVFAIL' }))
        .result,
    ).toBe('temperror');
  });

  it('SPF-11: given include whose lookup fails temporarily, when evaluated, then temperror', async () => {
    expect(
      (
        await mailFrom('v=spf1 include:broken.example.net -all', {
          'broken.example.net': 'SERVFAIL',
        })
      ).result,
    ).toBe('temperror');
  });
});

describe('SPF: ptr and macros', () => {
  const ptrZone: Zone = {
    '10.2.0.192.in-addr.arpa': { PTR: ['other.example.org.', 'host.example.com.'] },
    'other.example.org': { A: ['192.0.2.10'] },
    'host.example.com': { A: ['192.0.2.10'] },
  };

  it('SPF-13: given ptr and sensitive queries not allowed, when evaluated, then not-evaluated with sensitive-query-blocked', async () => {
    const r = await mailFrom('v=spf1 ptr -all', ptrZone);
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'sensitive-query-blocked' });
  });

  it('SPF-22: given ptr and sensitive queries allowed, when a validated name is in the domain, then pass with spf.ptr', async () => {
    const r = await mailFrom('v=spf1 ptr -all', ptrZone, { allowSensitive: true });
    expect(r.result).toBe('pass');
    expect(ids(r)).toContain('spf.ptr');
  });

  it('SPF-23: given SERVFAIL on the PTR lookup, when evaluated, then ptr does not match', async () => {
    const r = await mailFrom(
      'v=spf1 ptr ~all',
      { '10.2.0.192.in-addr.arpa': 'SERVFAIL' },
      { allowSensitive: true },
    );
    expect(r.result).toBe('softfail');
  });

  it('SPF-13: given exists with %{i}, when sensitive queries are not allowed, then not-evaluated', async () => {
    const r = await mailFrom('v=spf1 exists:%{i}._spf.example.com -all');
    expect(r).toMatchObject({ result: 'not-evaluated', reason: 'sensitive-query-blocked' });
  });

  it('SPF-12: given exists with %{d} and %{ir}, when allowed, then the expanded name is queried', async () => {
    const r = await mailFrom(
      'v=spf1 exists:%{ir}.%{d} -all',
      { '10.2.0.192.example.com': { A: ['127.0.0.2'] } },
      { allowSensitive: true },
    );
    expect(r.result).toBe('pass');
  });

  it('SPF-14: given exp whose query is blocked, when evaluated, then the result is still fail without an explanation', async () => {
    const r = await mailFrom('v=spf1 -all exp=%{i}._exp.example.com');
    expect(r.result).toBe('fail');
    expect(r.explanation).toBeUndefined();
  });

  it('SPF-26, SPF-18: given %{p}, when allowed, then its PTR and address queries are in the term and done once', async () => {
    let queries = 0;
    const zone = zoneTransport({
      'example.com': { TXT: ['v=spf1 exists:%{p}.a.example.com exists:%{p}.b.example.com -all'] },
      '10.2.0.192.in-addr.arpa': { PTR: ['host.example.com.'] },
      'host.example.com': { A: ['192.0.2.10'] },
      'host.example.com.b.example.com': { A: ['127.0.0.2'] },
    });
    const counting: Transport = async (q, s) => {
      queries++;
      return zone(q, s);
    };
    const { helo: _, ...envelope } = ENVELOPE;
    const r = (await spf(counting, { envelope, allowSensitive: true })).mailFrom;
    expect(r.result).toBe('pass');
    // TXT, PTR, A of the PTR name, then one exists query per term.
    expect(queries).toBe(5);
    expect(r.trace?.terms[0]?.queryIds).toHaveLength(3);
  });

  it('SPF-14: given fail and exp, when evaluated, then the explanation is expanded', async () => {
    const r = await mailFrom('v=spf1 -all exp=explain.example.com', {
      'explain.example.com': { TXT: ['%{c} is not allowed to send for %{d}'] },
    });
    expect(r.explanation).toBe('192.0.2.10 is not allowed to send for example.com');
  });
});

describe('SPF: limits and warnings', () => {
  const chain = (n: number): Zone =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [
        `i${i}.example.net`,
        { TXT: [i + 1 < n ? `v=spf1 include:i${i + 1}.example.net` : 'v=spf1 ?all'] },
      ]),
    );

  it('SPF-15: given 11 nested includes, when evaluated, then permerror with spf.lookup-limit', async () => {
    const r = await mailFrom('v=spf1 include:i0.example.net -all', chain(11));
    expect([r.result, ids(r)]).toEqual(['permerror', ['spf.lookup-limit']]);
  });

  it('SPF-19, SPF-15: given 9 DNS terms, when evaluated, then the counters show 9 and spf.near-lookup-limit', async () => {
    const r = await mailFrom('v=spf1 include:i0.example.net -all', chain(9));
    expect(r.counters).toEqual({ dnsTerms: 9, voids: 0 });
    expect(ids(r)).toContain('spf.near-lookup-limit');
  });

  it('SPF-15: given exactly 10 DNS terms, when evaluated, then there is no spf.near-lookup-limit', async () => {
    const r = await mailFrom('v=spf1 include:i0.example.net -all', chain(10));
    expect(r.counters.dnsTerms).toBe(10);
    expect(ids(r)).not.toContain('spf.near-lookup-limit');
  });

  it('SPF-18: given a redirect whose lookup fails, when traced, then the redirect term reads error', async () => {
    const r = await mailFrom('v=spf1 redirect=_spf.example.net', {
      '_spf.example.net': 'SERVFAIL',
    });
    expect(r.result).toBe('temperror');
    expect(r.trace?.terms[0]).toMatchObject({
      term: 'redirect=_spf.example.net',
      outcome: 'error',
    });
  });

  it('SPF-16: given three void lookups, when evaluated, then permerror with spf.lookup-limit', async () => {
    const r = await mailFrom('v=spf1 a:v1.example.net a:v2.example.net a:v3.example.net -all');
    expect([r.result, ids(r)]).toEqual(['permerror', ['spf.lookup-limit']]);
    expect(r.counters.voids).toBe(3);
  });

  it('SPF-17: given mx with 11 names, when evaluated, then permerror with spf.lookup-limit', async () => {
    const mx = Array.from({ length: 11 }, (_, i) => `10 mx${i}.example.com.`);
    const r = await mailFrom('v=spf1 mx -all', {
      'example.com': { TXT: ['v=spf1 mx -all'], MX: mx },
    });
    expect([r.result, ids(r)]).toEqual(['permerror', ['spf.lookup-limit']]);
  });

  it('SPF findings: given +all, a /8 network, and an IPv6 /16, when evaluated, then spf.plus-all and spf.wide-range', async () => {
    const r = await mailFrom('v=spf1 ip4:198.0.0.0/8 ip6:2001::/16 +all');
    expect(ids(r)).toEqual(['spf.wide-range', 'spf.plus-all']);
  });

  it('SPF-18: given evaluation, when traced, then each term has its outcome and DNS query IDs', async () => {
    // Without HELO only MAIL FROM queries, so the query IDs are predictable.
    const { helo: _, ...envelope } = ENVELOPE;
    const { mailFrom: r } = await spf(
      {
        'example.com': { TXT: ['v=spf1 a:web.example.com -all'] },
        'web.example.com': { A: ['198.51.100.1'] },
      },
      { envelope },
    );
    expect(r.trace).toMatchObject({
      domain: 'example.com',
      record: 'v=spf1 a:web.example.com -all',
      queryId: 'q1',
      result: 'fail',
      terms: [
        { term: 'a:web.example.com', outcome: 'no-match', queryIds: ['q2'] },
        { term: '-all', outcome: 'match', queryIds: [] },
      ],
    });
  });
});

describe('SPF: guards', () => {
  it('REP-7: given an unexpected error, when evaluated, then each identity is not-evaluated with internal-error', async () => {
    const broken: Transport = async () => {
      throw new TypeError('bug');
    };
    const r = await spf(broken);
    expect(r.mailFrom).toMatchObject({ result: 'not-evaluated', reason: 'internal-error' });
    expect(ids(r.mailFrom)).toEqual(['analysis.internal-error']);
  });

  it('REP-8: given DNS that never answers, when the deadline passes, then not-evaluated with timeout', async () => {
    const hang: Transport = (_q, s) =>
      new Promise((_, reject) => s.addEventListener('abort', () => reject(s.reason)));
    const r = await spf(hang, { signal: AbortSignal.timeout(30) });
    expect(r.mailFrom).toMatchObject({
      result: 'not-evaluated',
      reason: 'timeout',
      domain: 'example.com',
      sender: 'bounce@example.com',
    });
  });

  it('given the caller cancels, when evaluating, then it rejects with AbortError', async () => {
    const hang: Transport = (_q, s) =>
      new Promise((_, reject) => s.addEventListener('abort', () => reject(s.reason)));
    const controller = new AbortController();
    const pending = spf(hang, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

import { describe, expect, it } from 'vitest';
import type { DkimSignatureResult } from '../dkim/verify.ts';
import { createDnsCache } from '../dns/cache.ts';
import { composeResolver } from '../dns/compose.ts';
import type { DnsType, Lookup, Transport } from '../dns/types.ts';
import { splitHeaders } from '../message/headers.ts';
import { parsePsl } from '../psl/lookup.ts';
import type { SpfIdentityResult, SpfResults } from '../spf/evaluate.ts';
import { type DmarcMode, type DmarcModeResult, evaluateDmarc } from './evaluate.ts';

type Zone = Record<string, Partial<Record<DnsType, string[]>> | Lookup['rcode']>;

const PSL = parsePsl('// VERSION: 2026-01-01_00-00-00_UTC\nuk\nco.uk\ncom\nexample\n');

function zoneTransport(zone: Zone, asked: string[]): Transport {
  return async (q) => {
    asked.push(`${q.type} ${q.name}`);
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
const NO_SPF: SpfResults = { mailFrom: identity({}), helo: identity({}) };
const dkimSig = (d: string, result: DkimSignatureResult['result']): DkimSignatureResult => ({
  field: 0,
  result,
  d,
  findings: [],
  trace: { tags: [], selectedHeaders: [] },
});

async function run(
  o: {
    from?: string;
    zone?: Zone;
    spf?: SpfResults;
    dkim?: DkimSignatureResult[];
    modes?: readonly DmarcMode[];
  } = {},
) {
  const asked: string[] = [];
  const { headers } = splitHeaders(
    new TextEncoder().encode(`From: ${o.from ?? 'a@mail.example.co.uk'}\r\n\r\nx\r\n`),
  );
  const r = composeResolver({
    transport: zoneTransport(o.zone ?? {}, asked),
    source: 'offline',
    cache: createDnsCache(),
    budget: 200,
    allowSensitive: false,
  });
  const results = await evaluateDmarc({
    headers,
    spf: o.spf ?? NO_SPF,
    dkim: o.dkim ?? [],
    resolve: r.resolve,
    signal: new AbortController().signal,
    modes: o.modes ?? ['rfc7489'],
    psl: PSL,
  });
  return { results, asked, mode: results.rfc7489 as DmarcModeResult };
}
const ids = (r: DmarcModeResult) => r.findings.map((f) => f.id);
const orgRecord = (text: string): Zone => ({ '_dmarc.example.co.uk': { TXT: [text] } });

describe('DMARC rfc7489: discovery', () => {
  it('DMARC-7, DMARC-8, DMARC-26: given a record only at the organizational domain, when evaluated, then two queries find it through the PSL', async () => {
    const { mode, asked } = await run({ zone: orgRecord('v=DMARC1; p=reject') });
    expect(asked).toEqual(['TXT _dmarc.mail.example.co.uk', 'TXT _dmarc.example.co.uk']);
    expect(mode).toMatchObject({
      recordAt: 'example.co.uk',
      orgDomain: 'example.co.uk',
      orgDomainRule: 'PSL rule co.uk',
      pslVersion: '2026-01-01_00-00-00_UTC',
    });
  });

  it('DMARC-8: given a record at the author domain, when evaluated, then one query is enough', async () => {
    const { asked } = await run({
      zone: { '_dmarc.mail.example.co.uk': { TXT: ['v=DMARC1; p=none'] } },
    });
    expect(asked).toEqual(['TXT _dmarc.mail.example.co.uk']);
  });

  it('DMARC-23: given SERVFAIL for the author record, when evaluated, then temperror', async () => {
    const { mode } = await run({ zone: { '_dmarc.mail.example.co.uk': 'SERVFAIL' } });
    expect(mode.result).toBe('temperror');
  });

  it('DMARC-9: given no record at either name, when evaluated, then none', async () => {
    expect((await run()).mode.result).toBe('none');
  });
});

describe('DMARC rfc7489: record and policy', () => {
  it('DMARC-15: given a record at the organizational domain, when evaluated, then sp applies without an existence query', async () => {
    const { mode, asked } = await run({ zone: orgRecord('v=DMARC1; p=reject; sp=quarantine') });
    expect(mode).toMatchObject({ result: 'fail', policy: 'quarantine', policySource: 'sp' });
    expect(asked.filter((q) => q.startsWith('A '))).toEqual([]);
  });

  it('DMARC-11: given no p, when there is a valid rua, then p=none; without rua, not-evaluated with dmarc.invalid-policy', async () => {
    expect(
      (await run({ zone: orgRecord('v=DMARC1; rua=mailto:d@example.co.uk') })).mode.policy,
    ).toBe('none');
    const { mode } = await run({ zone: orgRecord('v=DMARC1; sp=reject') });
    expect([mode.result, ids(mode)]).toEqual(['not-evaluated', ['dmarc.invalid-policy']]);
  });

  it('DMARC-10: given np, t, and psd, when evaluated, then they are ignored with dmarc.ignored-tag and t=y lowers nothing', async () => {
    const { mode } = await run({
      zone: orgRecord('v=DMARC1; p=reject; np=none; t=y; psd=n; rua=mailto:d@example.co.uk'),
    });
    expect(mode).toMatchObject({ policy: 'reject', testing: false });
    expect(ids(mode)).toContain('dmarc.ignored-tag');
  });

  it('DMARC-10: given pct that is not an integer from 0 to 100, when evaluated, then it is ignored with dmarc.ignored-tag', async () => {
    const { mode } = await run({ zone: orgRecord('v=DMARC1; p=reject; pct=150') });
    expect(mode.dispositions).toBeUndefined();
    expect(ids(mode)).toContain('dmarc.ignored-tag');
  });

  it('DMARC-18: given pct below 100 and a fail, when evaluated, then two weighted dispositions and the policy as disposition', async () => {
    const reject = (await run({ zone: orgRecord('v=DMARC1; p=reject; pct=30') })).mode;
    expect(reject).toMatchObject({
      disposition: 'reject',
      dispositions: [
        { disposition: 'reject', weight: 30 },
        { disposition: 'quarantine', weight: 70 },
      ],
    });
    const quarantine = (await run({ zone: orgRecord('v=DMARC1; p=quarantine; pct=50') })).mode;
    expect(quarantine.dispositions).toEqual([
      { disposition: 'quarantine', weight: 50 },
      { disposition: 'none', weight: 50 },
    ]);
  });

  it('DMARC-18: given p=none with pct below 100, when the result is fail, then one disposition, since both would be none', async () => {
    const { mode } = await run({ zone: orgRecord('v=DMARC1; p=none; pct=50') });
    expect(mode.disposition).toBe('none');
    expect(mode.dispositions).toBeUndefined();
  });

  it('DMARC-18: given pct below 100 and a pass, when evaluated, then one disposition', async () => {
    const { mode } = await run({
      zone: orgRecord('v=DMARC1; p=reject; pct=30'),
      dkim: [dkimSig('example.co.uk', 'pass')],
    });
    expect(mode).toMatchObject({ result: 'pass', disposition: 'none' });
    expect(mode.dispositions).toBeUndefined();
  });

  it('DMARC-14: given DKIM pass for a sibling subdomain, when relaxed, then the PSL organizational domains align', async () => {
    const { mode } = await run({
      zone: orgRecord('v=DMARC1; p=reject'),
      dkim: [dkimSig('news.example.co.uk', 'pass')],
    });
    expect(mode.result).toBe('pass');
    expect(mode.alignment[0]).toMatchObject({ orgDomain: 'example.co.uk', aligned: true });
  });
});

describe('DMARC rfc7489: author domains', () => {
  const zone: Zone = {
    '_dmarc.x.example': { TXT: ['v=DMARC1; p=quarantine'] },
    '_dmarc.y.example': { TXT: ['v=DMARC1; p=reject'] },
    '_dmarc.z.example': { TXT: ['v=DMARC1; p=reject'] },
  };

  it('DMARC-3: given two domains that fail, when evaluated, then fail with the strictest policy and both in perDomain', async () => {
    const { mode } = await run({ from: 'a@x.example, b@y.example', zone });
    expect(mode).toMatchObject({ result: 'fail', authorDomain: 'y.example', policy: 'reject' });
    expect(mode.perDomain?.map((d) => [d.authorDomain, d.result])).toEqual([
      ['x.example', 'fail'],
      ['y.example', 'fail'],
    ]);
  });

  it('DMARC-3: given one domain passing and one without a record, when evaluated, then pass from the first domain with it', async () => {
    const { mode } = await run({
      from: 'a@w.example, b@z.example',
      zone,
      dkim: [dkimSig('z.example', 'pass')],
    });
    expect(mode).toMatchObject({ result: 'pass', authorDomain: 'z.example' });
  });

  it('DMARC-3: given ties between failing domains, when evaluated, then the first in From order decides', async () => {
    const { mode } = await run({ from: 'a@y.example, b@z.example', zone });
    expect(mode.authorDomain).toBe('y.example');
  });

  it('DMARC-3: given a finding for a domain that does not decide, when evaluated, then the mode still reports it', async () => {
    const { mode } = await run({
      from: 'a@m.example, b@y.example',
      zone: { ...zone, '_dmarc.m.example': { TXT: ['v=DMARC1; p=none', 'v=DMARC1; p=reject'] } },
    });
    expect(mode.authorDomain).toBe('y.example');
    expect(ids(mode)).toContain('dmarc.multiple-records');
  });

  it('REP-8, DMARC-3: given one domain that never answers, when the deadline passes, then the queries already answered are kept', async () => {
    const asked: string[] = [];
    const zoned = zoneTransport({}, asked);
    const hang: Transport = (q, s) =>
      q.name === '_dmarc.x.co.uk'
        ? new Promise((_, reject) => s.addEventListener('abort', () => reject(s.reason)))
        : zoned(q, s);
    const { headers } = splitHeaders(
      new TextEncoder().encode('From: a@mail.x.co.uk, b@y.example\r\n\r\nx\r\n'),
    );
    const r = composeResolver({
      transport: hang,
      source: 'offline',
      cache: createDnsCache(),
      budget: 200,
      allowSensitive: false,
    });
    const results = await evaluateDmarc({
      headers,
      spf: NO_SPF,
      dkim: [],
      resolve: r.resolve,
      signal: AbortSignal.timeout(50),
      modes: ['rfc7489'],
      psl: PSL,
    });
    expect(results.rfc7489).toMatchObject({ result: 'not-evaluated', reason: 'timeout' });
    // _dmarc.mail.x.co.uk and _dmarc.y.example were answered before the deadline.
    expect(results.rfc7489?.queryIds).toHaveLength(2);
  });

  it('DMARC-3: given two addresses in one domain, when evaluated, then that domain once without a finding', async () => {
    const { mode } = await run({ from: 'a@x.example, b@x.example', zone });
    expect(mode.authorDomain).toBe('x.example');
    expect(mode.perDomain).toBeUndefined();
    expect(ids(mode)).not.toContain('dmarc.from-multiple-addresses');
  });
});

describe('DMARC modes', () => {
  it('DMARC-27: given both modes, when evaluated, then each has its own result', async () => {
    const { results } = await run({
      zone: orgRecord('v=DMARC1; p=reject'),
      modes: ['rfc9989', 'rfc7489'],
    });
    expect(results.rfc9989?.result).toBe('fail');
    expect(results.rfc7489?.result).toBe('fail');
  });

  it('DMARC-27: given only rfc9989, when evaluated, then there is no rfc7489 result', async () => {
    const { results } = await run({ modes: ['rfc9989'] });
    expect(results.rfc7489).toBeUndefined();
  });
});

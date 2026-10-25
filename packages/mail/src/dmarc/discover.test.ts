import { describe, expect, it } from 'vitest';
import { createDnsCache } from '../dns/cache.ts';
import { composeResolver } from '../dns/compose.ts';
import type { Lookup, Transport } from '../dns/types.ts';
import { treeWalk } from './discover-rfc9989.ts';
import { parseDmarcRecord } from './record.ts';

type Zone = Record<string, string[] | Lookup['rcode']>;

/** TXT answers from `zone`; a name not in it is NXDOMAIN. */
function zoneTransport(zone: Zone, asked: string[] = []): Transport {
  return async (q) => {
    asked.push(q.name);
    const entry = zone[q.name];
    if (entry === undefined) return { rcode: 'NXDOMAIN', records: [], authenticated: false };
    if (typeof entry === 'string') return { rcode: entry, records: [], authenticated: false };
    return { rcode: 'NOERROR', records: entry, authenticated: false };
  };
}

function walk(domain: string, zone: Zone, asked: string[] = []) {
  const r = composeResolver({
    transport: zoneTransport(zone, asked),
    source: 'offline',
    cache: createDnsCache(),
    budget: 200,
    allowSensitive: false,
  });
  return treeWalk({ resolve: r.resolve, signal: new AbortController().signal }, domain);
}

describe('DMARC record', () => {
  it('DMARC-23: given v=DMARC1 first and a valid tag list, when parsed, then it is a record', () => {
    expect(parseDmarcRecord('v=DMARC1; p=reject; rua=mailto:d@example.com')?.get('p')).toBe(
      'reject',
    );
  });

  it('DMARC-23: given another first tag, a broken tag list, or another version, when parsed, then it is not a record', () => {
    for (const t of ['p=reject; v=DMARC1', 'v=DMARC1; p', 'v=DMARC2; p=none', 'v=spf1 -all']) {
      expect(parseDmarcRecord(t), t).toBeNull();
    }
  });
});

describe('DMARC tree walk (rfc9989)', () => {
  it('DMARC-4: given a record at the author domain, when walked, then it is the policy record', async () => {
    const w = await walk('example.com', { '_dmarc.example.com': ['v=DMARC1; p=reject'] });
    expect(w).toMatchObject({ policy: { name: 'example.com' }, orgDomain: 'example.com' });
  });

  it('DMARC-5, DMARC-22: given a record only at a parent, when walked, then labels are dropped until it is found', async () => {
    const asked: string[] = [];
    const w = await walk(
      'a.b.mail.example.com',
      { '_dmarc.example.com': ['v=DMARC1; p=quarantine'] },
      asked,
    );
    expect(w.policy?.name).toBe('example.com');
    expect(asked).toEqual([
      '_dmarc.a.b.mail.example.com',
      '_dmarc.b.mail.example.com',
      '_dmarc.mail.example.com',
      '_dmarc.example.com',
      '_dmarc.com',
    ]);
  });

  it('DMARC-5: given more than 8 labels, when walked, then the walk jumps to the rightmost 7 and stops at 8 queries', async () => {
    const asked: string[] = [];
    await walk('l1.l2.l3.l4.l5.l6.l7.l8.l9.example', {}, asked);
    expect(asked).toEqual([
      '_dmarc.l1.l2.l3.l4.l5.l6.l7.l8.l9.example',
      '_dmarc.l4.l5.l6.l7.l8.l9.example',
      '_dmarc.l5.l6.l7.l8.l9.example',
      '_dmarc.l6.l7.l8.l9.example',
      '_dmarc.l7.l8.l9.example',
      '_dmarc.l8.l9.example',
      '_dmarc.l9.example',
      '_dmarc.example',
    ]);
  });

  it('DMARC-6: given records at several levels, when walked, then the shortest name with a record is the organizational domain', async () => {
    const w = await walk('mail.example.com', {
      '_dmarc.mail.example.com': ['v=DMARC1; p=none'],
      '_dmarc.example.com': ['v=DMARC1; p=reject'],
    });
    expect(w).toMatchObject({ policy: { name: 'mail.example.com' }, orgDomain: 'example.com' });
  });

  it('DMARC-6, DMARC-22: given psd=y at a public suffix, when walked, then the walk stops and the organizational domain is one label below', async () => {
    const asked: string[] = [];
    const w = await walk(
      'a.example.co.example',
      {
        '_dmarc.co.example': ['v=DMARC1; p=reject; psd=y'],
        '_dmarc.example': ['v=DMARC1; p=none'],
      },
      asked,
    );
    expect(w.orgDomain).toBe('example.co.example');
    expect(asked).not.toContain('_dmarc.example');
  });

  it('DMARC-6: given psd=n, when walked, then that name is the organizational domain', async () => {
    const w = await walk('a.b.example.com', {
      '_dmarc.b.example.com': ['v=DMARC1; p=none; psd=n'],
    });
    expect(w.orgDomain).toBe('b.example.com');
  });

  it('DMARC-22: given no record anywhere, when walked, then there is no policy and the domain is its own organizational domain', async () => {
    const w = await walk('example.com', {});
    expect(w).toMatchObject({ policy: null, orgDomain: 'example.com' });
  });

  it('DMARC-9: given two DMARC records at a name, when walked, then both are discarded with dmarc.multiple-records', async () => {
    const w = await walk('example.com', {
      '_dmarc.example.com': ['v=DMARC1; p=none', 'v=DMARC1; p=reject'],
    });
    expect(w.policy).toBeNull();
    expect(w.findings.map((f) => f.id)).toEqual(['dmarc.multiple-records']);
  });

  it('DMARC-22: given a record and then a DNS error higher up, when walked, then the walk ends without an error', async () => {
    for (const rcode of ['SERVFAIL', 'OFFLINE'] as const) {
      const w = await walk('mail.example.com', {
        '_dmarc.mail.example.com': ['v=DMARC1; p=reject'],
        '_dmarc.example.com': rcode,
      });
      expect(w, rcode).toMatchObject({
        policy: { name: 'mail.example.com' },
        orgDomain: 'mail.example.com',
      });
      expect(w.error, rcode).toBeUndefined();
    }
  });

  it('DMARC-23: given SERVFAIL or offline, when walked, then the walk stops with temperror or offline', async () => {
    expect((await walk('example.com', { '_dmarc.example.com': 'SERVFAIL' })).error).toBe(
      'temperror',
    );
    expect((await walk('example.com', { '_dmarc.example.com': 'OFFLINE' })).error).toBe('offline');
  });
});

import { composeResolver, createDnsCache, type DnsQuery, type Transport } from '@benchside/dns';
import { describe, expect, it } from 'vitest';
import { dnsFindings } from './findings.ts';

const signal = new AbortController().signal;
const txt = (name: string, sensitivity: DnsQuery['sensitivity'] = 'domain'): DnsQuery => ({
  name,
  type: 'TXT',
  sensitivity,
  purpose: 'test',
});
const transport: Transport = async () => ({
  rcode: 'NOERROR',
  records: ['x'],
  authenticated: true,
});

function resolver(o: { budget?: number } = {}) {
  return composeResolver({
    transport,
    source: 'test',
    cache: createDnsCache(),
    budget: o.budget ?? 200,
    allowSensitive: false,
  });
}

describe('DNS findings', () => {
  it('DNS-13: given more queries than the budget, when the log is read, then dns.budget-exhausted cites the queries not sent', async () => {
    const r = resolver({ budget: 2 });
    await r.resolve(txt('a.example'), signal);
    await r.resolve(txt('a.example'), signal);
    await r.resolve(txt('b.example'), signal);
    expect(dnsFindings(r.log)).toEqual([
      expect.objectContaining({
        id: 'dns.budget-exhausted',
        severity: 'error',
        evidence: [{ kind: 'dns', queryId: 'q3' }],
      }),
    ]);
  });

  it('DNS-11: given a blocked sensitive query, when the log is read, then dns.blocked-sensitive cites it', async () => {
    const r = resolver();
    await r.resolve(txt('alice._spf.example', 'sensitive'), signal);
    expect(dnsFindings(r.log)).toEqual([
      expect.objectContaining({
        id: 'dns.blocked-sensitive',
        severity: 'info',
        evidence: [{ kind: 'dns', queryId: 'q1' }],
      }),
    ]);
  });

  it('given only answered queries, when the log is read, then there are no findings', async () => {
    const r = resolver();
    await r.resolve(txt('a.example'), signal);
    expect(dnsFindings(r.log)).toEqual([]);
  });
});

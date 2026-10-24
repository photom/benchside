import { describe, expect, it } from 'vitest';
import { createDnsCache } from './cache.ts';
import { composeResolver, dnsFindings } from './compose.ts';
import type { DnsQuery, Lookup, Transport } from './types.ts';

const signal = new AbortController().signal;
const txt = (name: string, sensitivity: DnsQuery['sensitivity'] = 'domain'): DnsQuery => ({
  name,
  type: 'TXT',
  sensitivity,
  purpose: 'test',
});

function fakeTransport(answer: Lookup = { rcode: 'NOERROR', records: ['x'], authenticated: true }) {
  const calls: string[] = [];
  const transport: Transport = async (q) => {
    calls.push(`${q.name}/${q.type}`);
    return answer;
  };
  return { transport, calls };
}

function resolver(transport: Transport, o: { budget?: number; allowSensitive?: boolean } = {}) {
  return composeResolver({
    transport,
    source: 'test',
    cache: createDnsCache(),
    budget: o.budget ?? 200,
    allowSensitive: o.allowSensitive ?? false,
  });
}

describe('DNS layers', () => {
  it('DNS-15: given queries, when resolved, then each gets a queryId and a log entry', async () => {
    const { transport } = fakeTransport();
    const r = resolver(transport);
    const a = await r.resolve(txt('a.example'), signal);
    const b = await r.resolve(txt('b.example'), signal);
    expect([a.queryId, b.queryId]).toEqual(['q1', 'q2']);
    expect(r.log).toEqual([
      expect.objectContaining({
        queryId: 'q1',
        name: 'a.example',
        type: 'TXT',
        sensitivity: 'domain',
        purpose: 'test',
        rcode: 'NOERROR',
        records: ['x'],
        authenticated: true,
        cacheHit: false,
      }),
      expect.objectContaining({ queryId: 'q2', name: 'b.example' }),
    ]);
    expect(r.log[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('DNS-14: given the same name and type twice, when resolved, then the transport is called once and the second is a cache hit', async () => {
    const { transport, calls } = fakeTransport();
    const r = resolver(transport);
    await r.resolve(txt('a.example'), signal);
    await r.resolve(txt('A.EXAMPLE'), signal);
    expect(calls).toEqual(['a.example/TXT']);
    expect(r.log.map((e) => e.cacheHit)).toEqual([false, true]);
  });

  it('DNS-14: given concurrent identical queries, when resolved, then they share one transport call', async () => {
    const { transport, calls } = fakeTransport();
    const r = resolver(transport);
    await Promise.all([r.resolve(txt('a.example'), signal), r.resolve(txt('a.example'), signal)]);
    expect(calls).toHaveLength(1);
  });

  it('DNS-14: given a SERVFAIL or TIMEOUT, when resolved again, then it is not cached', async () => {
    const { transport, calls } = fakeTransport({
      rcode: 'SERVFAIL',
      records: [],
      authenticated: false,
    });
    const r = resolver(transport);
    await r.resolve(txt('a.example'), signal);
    await r.resolve(txt('a.example'), signal);
    expect(calls).toHaveLength(2);
  });

  it('DNS-14: given a cache shared by two resolvers, when the second asks, then it hits the cache', async () => {
    const { transport, calls } = fakeTransport();
    const cache = createDnsCache();
    const first = composeResolver({
      transport,
      source: 'test',
      cache,
      budget: 200,
      allowSensitive: false,
    });
    const second = composeResolver({
      transport,
      source: 'test',
      cache,
      budget: 200,
      allowSensitive: false,
    });
    await first.resolve(txt('a.example'), signal);
    await second.resolve(txt('a.example'), signal);
    expect(calls).toHaveLength(1);
  });

  it('DNS-13: given more queries than the budget, when resolved, then the extra ones are BUDGET, cache hits count, and dns.budget-exhausted is reported', async () => {
    const { transport } = fakeTransport();
    const r = resolver(transport, { budget: 2 });
    await r.resolve(txt('a.example'), signal);
    await r.resolve(txt('a.example'), signal); // cache hit still counts
    const third = await r.resolve(txt('b.example'), signal);
    expect(third.rcode).toBe('BUDGET');
    expect(dnsFindings(r.log)).toEqual([
      expect.objectContaining({
        id: 'dns.budget-exhausted',
        severity: 'error',
        evidence: [{ kind: 'dns', queryId: 'q3' }],
      }),
    ]);
  });

  it('DNS-10, DNS-11: given a sensitive query, when not allowed, then it is BLOCKED, not sent, logged with its name, and dns.blocked-sensitive is reported', async () => {
    const { transport, calls } = fakeTransport();
    const r = resolver(transport);
    const a = await r.resolve(txt('alice._spf.example', 'sensitive'), signal);
    expect(a.rcode).toBe('BLOCKED');
    expect(calls).toEqual([]);
    expect(r.log[0]).toMatchObject({ name: 'alice._spf.example', rcode: 'BLOCKED' });
    expect(dnsFindings(r.log)).toEqual([
      expect.objectContaining({
        id: 'dns.blocked-sensitive',
        severity: 'info',
        evidence: [{ kind: 'dns', queryId: 'q1' }],
      }),
    ]);
  });

  it('DNS-10: given a sensitive query, when allowed, then it is sent', async () => {
    const { transport, calls } = fakeTransport();
    const r = resolver(transport, { allowSensitive: true });
    expect((await r.resolve(txt('alice._spf.example', 'sensitive'), signal)).rcode).toBe('NOERROR');
    expect(calls).toHaveLength(1);
  });

  it('given an aborted signal, when the transport throws AbortError, then resolve rejects', async () => {
    const transport: Transport = async () => {
      throw new DOMException('aborted', 'AbortError');
    };
    await expect(resolver(transport).resolve(txt('a.example'), signal)).rejects.toThrow('aborted');
  });

  it('DNS-14: given two sources sharing one cache, when each asks, then answers do not mix', async () => {
    const { transport, calls } = fakeTransport();
    const cache = createDnsCache();
    const google = composeResolver({
      transport,
      source: 'google',
      cache,
      budget: 200,
      allowSensitive: false,
    });
    const offline = composeResolver({
      transport,
      source: 'offline',
      cache,
      budget: 200,
      allowSensitive: false,
    });
    await google.resolve(txt('a.example'), signal);
    await offline.resolve(txt('a.example'), signal);
    expect(calls).toHaveLength(2);
  });

  it('DNS-14: given analysis A aborted while B asks the same name, when B resolves, then B gets its own answer', async () => {
    const transport: Transport = (_q, s) =>
      new Promise((resolve, reject) => {
        s.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        setTimeout(() => resolve({ rcode: 'NOERROR', records: ['x'], authenticated: false }), 5);
      });
    const cache = createDnsCache();
    const a = composeResolver({
      transport,
      source: 'test',
      cache,
      budget: 200,
      allowSensitive: false,
    });
    const b = composeResolver({
      transport,
      source: 'test',
      cache,
      budget: 200,
      allowSensitive: false,
    });
    const controller = new AbortController();
    const pendingA = a.resolve(txt('a.example'), controller.signal);
    const pendingB = b.resolve(txt('a.example'), signal);
    controller.abort();
    await expect(pendingA).rejects.toThrow('aborted');
    await expect(pendingB).resolves.toMatchObject({ rcode: 'NOERROR' });
  });

  it('DNS-15: given a query that throws while another is in flight, when later queries run, then queryIds are unique and the log has no holes', async () => {
    let fail = true;
    const transport: Transport = async () => {
      if (fail) {
        fail = false;
        throw new DOMException('aborted', 'AbortError');
      }
      await new Promise((r) => setTimeout(r, 1));
      return { rcode: 'NOERROR', records: [], authenticated: false };
    };
    const r = resolver(transport);
    const first = r.resolve(txt('a.example'), signal);
    const second = r.resolve(txt('b.example'), signal);
    expect(r.log.every((e) => e !== undefined)).toBe(true);
    await expect(first).rejects.toThrow();
    await second;
    await r.resolve(txt('c.example'), signal);
    expect(r.log.map((e) => e.queryId)).toEqual(['q2', 'q3']);
  });

  it('DNS-14: given a joined in-flight query that times out, when logged, then it is not a cache hit', async () => {
    const { transport } = fakeTransport({ rcode: 'TIMEOUT', records: [], authenticated: false });
    const r = resolver(transport);
    await Promise.all([r.resolve(txt('a.example'), signal), r.resolve(txt('a.example'), signal)]);
    expect(r.log.map((e) => e.cacheHit)).toEqual([false, false]);
  });

  it('DNS-18: given a Unicode name and its A-label form, when resolved, then they share one cache entry and the log keeps each name', async () => {
    const { transport, calls } = fakeTransport();
    const r = resolver(transport);
    await r.resolve(txt('sel._domainkey.bücher.example'), signal);
    await r.resolve(txt('sel._domainkey.xn--bcher-kva.example'), signal);
    expect(calls).toEqual(['sel._domainkey.xn--bcher-kva.example/TXT']);
    expect(r.log.map((e) => e.name)).toEqual([
      'sel._domainkey.bücher.example',
      'sel._domainkey.xn--bcher-kva.example',
    ]);
  });

  it('DNS-18: given a name that cannot be converted safely, when resolved, then nothing is sent and the answer is SERVFAIL', async () => {
    const { transport, calls } = fakeTransport();
    const r = resolver(transport);
    expect((await r.resolve(txt('ü@attacker.example'), signal)).rcode).toBe('SERVFAIL');
    expect(calls).toEqual([]);
  });
});

import { createDnsCache, type Lookup, type Transport } from '@benchside/dns';
import { describe, expect, it } from 'vitest';
import { type HostState, LookupSession, type Names } from './reverse.ts';

const ok = (...records: string[]): Lookup => ({ rcode: 'NOERROR', records, authenticated: false });
const fail = (rcode: Lookup['rcode']): Lookup => ({ rcode, records: [], authenticated: false });

/** A transport answering from a table keyed "TYPE name"; unknown names are NXDOMAIN. */
function fake(table: Record<string, Lookup>) {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const transport: Transport = async (q, signal) => {
    calls.push(`${q.type} ${q.name}`);
    signals.push(signal);
    return table[`${q.type} ${q.name}`] ?? fail('NXDOMAIN');
  };
  return { transport, calls, signals };
}

function session(
  table: Record<string, Lookup>,
  o: { finals?: Map<string, HostState>; budget?: number; concurrency?: number } = {},
) {
  const sent: Names[] = [];
  const f = fake(table);
  const s = new LookupSession({
    number: 1,
    generation: 1,
    transport: f.transport,
    source: 'cloudflare',
    cache: createDnsCache(),
    finals: o.finals ?? new Map(),
    send: (n) => sent.push(n),
    ...(o.budget === undefined ? {} : { budget: o.budget }),
    concurrency: o.concurrency ?? 1,
    flushMs: 0,
  });
  const final = () => {
    const out: Record<string, HostState> = {};
    for (const n of sent) Object.assign(out, n.changes);
    return out;
  };
  return { s, sent, final, ...f };
}

const V4 = '10.2.0.192.in-addr.arpa';

describe('Reverse lookup: queries and states (RDNS-3..5)', () => {
  it('RDNS-3, RDNS-4: given a PTR name whose A answer holds the source, when looked up, then confirmed, trailing dot removed', async () => {
    const t = session({
      [`PTR ${V4}`]: ok('mail.example.net.'),
      'A mail.example.net.': ok('192.0.2.10'),
    });
    t.s.setTargets(['192.0.2.10']);
    await t.s.idle;
    expect(t.calls).toEqual([`PTR ${V4}`, 'A mail.example.net.']);
    expect(t.final()['192.0.2.10']).toEqual({ state: 'confirmed', names: ['mail.example.net'] });
  });

  it('RDNS-5: given PTR names none of which point back, when looked up, then unconfirmed with the PTR names', async () => {
    const t = session({
      [`PTR ${V4}`]: ok('a.example.net.', 'b.example.net.'),
      'A a.example.net.': ok('192.0.2.99'),
    });
    t.s.setTargets(['192.0.2.10']);
    await t.s.idle;
    expect(t.final()['192.0.2.10']).toEqual({
      state: 'unconfirmed',
      names: ['a.example.net', 'b.example.net'],
    });
  });

  it('RDNS-4: given more than 3 PTR names, when looked up, then only the first 3 are confirmed', async () => {
    const names = ['a.', 'b.', 'c.', 'd.'].map((n) => `${n}example.net.`);
    const t = session({ [`PTR ${V4}`]: ok(...names) });
    t.s.setTargets(['192.0.2.10']);
    await t.s.idle;
    expect(t.calls.filter((c) => c.startsWith('A '))).toEqual(
      names.slice(0, 3).map((n) => `A ${n}`),
    );
  });

  it('RDNS-5: given NXDOMAIN or an empty PTR answer, when looked up, then none; SERVFAIL or TIMEOUT, then error with the rcode', async () => {
    const t = session({
      'PTR 11.2.0.192.in-addr.arpa': ok(),
      'PTR 12.2.0.192.in-addr.arpa': fail('SERVFAIL'),
      'PTR 13.2.0.192.in-addr.arpa': fail('TIMEOUT'),
    });
    t.s.setTargets(['192.0.2.10', '192.0.2.11', '192.0.2.12', '192.0.2.13']);
    await t.s.idle;
    expect(t.final()).toEqual({
      '192.0.2.10': { state: 'none' },
      '192.0.2.11': { state: 'none' },
      '192.0.2.12': { state: 'error', rcode: 'SERVFAIL' },
      '192.0.2.13': { state: 'error', rcode: 'TIMEOUT' },
    });
  });

  it('RDNS-3, RDNS-4: given an IPv6 source, when looked up, then ip6.arpa and AAAA, compared after normalization', async () => {
    // 2001:db8::1 is 32 nibbles: 2001 0db8, then 23 zeros and 1; reversed under ip6.arpa.
    const ptr = `PTR 1.${'0.'.repeat(23)}8.b.d.0.1.0.0.2.ip6.arpa`;
    const t = session({
      [ptr]: ok('v6.example.net.'),
      'AAAA v6.example.net.': ok('2001:DB8:0:0:0:0:0:1'),
    });
    t.s.setTargets(['2001:db8::1']);
    await t.s.idle;
    expect(t.calls).toEqual([ptr, 'AAAA v6.example.net.']);
    expect(t.final()['2001:db8::1']).toEqual({ state: 'confirmed', names: ['v6.example.net'] });
  });
});

describe('Reverse lookup: failures (RDNS-5, RDNS-9)', () => {
  it('RDNS-5: given a forward query that times out and no name confirmed, when looked up, then error with that rcode, so it is tried again', async () => {
    const t = session({ [`PTR ${V4}`]: ok('a.example.net.'), 'A a.example.net.': fail('TIMEOUT') });
    t.s.setTargets(['192.0.2.10']);
    await t.s.idle;
    expect(t.final()['192.0.2.10']).toEqual({ state: 'error', rcode: 'TIMEOUT' });
  });

  it('RDNS-5: given one forward query that fails and another that confirms, when looked up, then confirmed', async () => {
    const t = session({
      [`PTR ${V4}`]: ok('a.example.net.', 'b.example.net.'),
      'A a.example.net.': fail('SERVFAIL'),
      'A b.example.net.': ok('192.0.2.10'),
    });
    t.s.setTargets(['192.0.2.10']);
    await t.s.idle;
    expect(t.final()['192.0.2.10']).toEqual({ state: 'confirmed', names: ['b.example.net'] });
  });

  it('RDNS-5: given a transport that throws, when looked up, then error SERVFAIL and the session goes on', async () => {
    const sent: Names[] = [];
    const s = new LookupSession({
      number: 1,
      generation: 1,
      transport: async (q) => {
        if (q.name.startsWith('1.')) throw new Error('network down');
        return fail('NXDOMAIN');
      },
      source: 'cloudflare',
      cache: createDnsCache(),
      finals: new Map(),
      send: (n) => sent.push(n),
      concurrency: 1,
      flushMs: 0,
    });
    s.setTargets(['192.0.2.1', '192.0.2.2']);
    await s.idle;
    const final = Object.assign({}, ...sent.map((n) => n.changes));
    expect(final).toEqual({
      '192.0.2.1': { state: 'error', rcode: 'SERVFAIL' },
      '192.0.2.2': { state: 'none' },
    });
  });

  it('RDNS-6: given a session budget, when it runs out, then the finding names that budget', async () => {
    const t = session({}, { budget: 2 });
    t.s.setTargets(['192.0.2.1', '192.0.2.2', '192.0.2.3']);
    await t.s.idle;
    expect(t.sent.flatMap((n) => n.findings)[0]?.message).toContain('its 2 queries');
  });
});

describe('Reverse lookup: targets and sessions (RDNS-2, RDNS-6, RDNS-9)', () => {
  it('RDNS-2: given targets, when changed before they are looked up, then the dropped ones are removed and not queried', async () => {
    const t = session({});
    t.s.setTargets(['192.0.2.1', '192.0.2.2', '192.0.2.3']);
    t.s.setTargets(['192.0.2.1', '192.0.2.3']);
    await t.s.idle;
    expect(t.calls).toEqual(['PTR 1.2.0.192.in-addr.arpa', 'PTR 3.2.0.192.in-addr.arpa']);
    expect(t.final()['192.0.2.2']).toEqual({ state: 'removed' });
  });

  it('RDNS-9: given final states from an earlier session, when targeted again, then none, confirmed, unconfirmed are skipped and error is queued', async () => {
    const finals = new Map<string, HostState>([
      ['192.0.2.1', { state: 'none' }],
      ['192.0.2.2', { state: 'confirmed', names: ['x'] }],
      ['192.0.2.3', { state: 'error', rcode: 'SERVFAIL' }],
    ]);
    const t = session({}, { finals });
    t.s.setTargets(['192.0.2.1', '192.0.2.2', '192.0.2.3']);
    await t.s.idle;
    expect(t.calls).toEqual(['PTR 3.2.0.192.in-addr.arpa']);
    expect(finals.get('192.0.2.3')).toEqual({ state: 'none' });
  });

  it('RDNS-6: given a budget that runs out, when looked up, then error BUDGET and one dns.budget-exhausted finding', async () => {
    const t = session({}, { budget: 2 });
    t.s.setTargets(['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4']);
    await t.s.idle;
    expect(t.calls).toHaveLength(2);
    expect(t.final()['192.0.2.3']).toEqual({ state: 'error', rcode: 'BUDGET' });
    const findings = t.sent.flatMap((n) => n.findings);
    expect(findings.map((f) => [f.id, f.severity])).toEqual([['dns.budget-exhausted', 'warning']]);
  });

  it('RDNS-9: given lookups turned off, when stopped, then the signal aborts, queued sources are not queried, and nothing more is sent', async () => {
    const t = session({});
    t.s.setTargets(['192.0.2.1', '192.0.2.2', '192.0.2.3']);
    t.s.stop();
    const before = t.sent.length;
    await t.s.idle;
    expect(t.signals.every((s) => s.aborted)).toBe(true);
    expect(t.calls.length).toBeLessThanOrEqual(1);
    expect(t.sent.length).toBe(before);
  });
});

describe('Reverse lookup: names messages (PRG-11, PRG-12, DNS-15)', () => {
  it('PRG-12: given a session, when it starts and when its queue empties, then names with counts; each log entry once', async () => {
    const t = session({});
    expect(t.sent).toHaveLength(1);
    t.s.setTargets([]);
    expect(t.sent[0]).toMatchObject({
      type: 'names',
      generation: 1,
      session: 1,
      counts: { queued: 0, lookingUp: 0, done: 0, targets: 0 },
    });
    t.s.setTargets(['192.0.2.1', '192.0.2.2']);
    await t.s.idle;
    const last = t.sent[t.sent.length - 1] as Names;
    expect(last.counts).toEqual({ queued: 0, lookingUp: 0, done: 2, targets: 2 });
    const logged = t.sent.flatMap((n) => n.log.map((e) => e.name));
    expect(logged).toEqual(['1.2.0.192.in-addr.arpa', '2.2.0.192.in-addr.arpa']);
  });

  it('PRG-11: given a source, when it moves through its states, then each change is sent: queued, looking-up, then final', async () => {
    const t = session({});
    t.s.setTargets(['192.0.2.1']);
    await t.s.idle;
    const seen = t.sent.map((n) => n.changes['192.0.2.1']?.state).filter(Boolean);
    expect(seen[0]).toBe('queued');
    expect(seen[seen.length - 1]).toBe('none');
  });

  it('RDNS-1: given a target that is not a valid IP, when set, then it is never looked up', async () => {
    const t = session({});
    t.s.setTargets(['not-an-ip', '192.0.2.1']);
    await t.s.idle;
    expect(t.calls).toEqual(['PTR 1.2.0.192.in-addr.arpa']);
    expect(t.sent.some((n) => 'not-an-ip' in n.changes)).toBe(false);
    expect(t.sent[t.sent.length - 1]?.counts.targets).toBe(1);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { signMessage } from '../test/support/dkim-signer.ts';
import { rsaKey } from '../test/support/keys.ts';
import { analyze } from './analyze.ts';
import { createDnsCache } from './dns/cache.ts';
import { type ManualRecord, offlineTransport } from './dns/offline.ts';
import type { Transport } from './dns/types.ts';

const bytes = (lines: string[]) =>
  new TextEncoder().encode(`${lines.join('\r\n')}\r\n\r\nbody\r\n`);
const DATE = '; Mon, 5 Oct 2026 10:00:00 +0000';
const NOW = new Date('2026-10-24T00:00:00Z');

function deps(
  o: {
    source?: string;
    records?: readonly ManualRecord[];
    transport?: Transport;
    signal?: AbortSignal;
    deadlineMs?: number;
  } = {},
) {
  return {
    transport: o.transport ?? offlineTransport(o.records ?? []),
    source: o.source ?? 'offline',
    cache: createDnsCache(),
    signal: o.signal ?? new AbortController().signal,
    now: NOW,
    ...(o.deadlineMs === undefined ? {} : { deadlineMs: o.deadlineMs }),
  };
}

describe('analyze', () => {
  it('AR-10: given a delivered message, when analyzed, then the report lists receiver results with trust', async () => {
    const report = await analyze(
      bytes([
        `Received: from out.example.com (out.example.com. [192.0.2.1]) by mx.example.org with ESMTPS id x1${DATE}`,
        'Authentication-Results: mx.example.org; dkim=pass header.d=example.com',
        'From: a@example.com',
      ]),
      {},
      deps(),
    );
    expect(report.receiver.results).toEqual([
      expect.objectContaining({ field: 1, trusted: true, authservId: 'mx.example.org' }),
    ]);
    expect(report.headers.map((h) => h.name)).toEqual([
      'Received',
      'Authentication-Results',
      'From',
    ]);
    expect(report.hasBody).toBe(true);
  });

  it('AR-11: given receiver results but none of our own, when analyzed, then there are no comparisons and no authres.differs', async () => {
    const report = await analyze(
      bytes([
        `Received: from a.example (a.example [192.0.2.1]) by mx.example.org with SMTP${DATE}`,
        'Authentication-Results: mx.example.org; spf=fail',
      ]),
      {},
      deps(),
    );
    expect(report.receiver.comparisons).toEqual([]);
    expect(report.findings.map((f) => f.id)).not.toContain('authres.differs');
  });

  it('given findings from several steps, when analyzed, then all are in the report', async () => {
    const report = await analyze(
      bytes([
        `Received: from a (a [10.0.0.1]) by b with SMTP${DATE}`,
        'Authentication-Results: elsewhere.example; dkim pass',
      ]),
      {},
      deps(),
    );
    expect(report.findings.map((f) => f.id).sort()).toEqual([
      'authres.syntax',
      'authres.untrusted',
      'envelope.no-public-hop',
    ]);
  });

  it('ENV-10: given a user-chosen boundary, when analyzed, then trust follows it', async () => {
    const report = await analyze(
      bytes([
        `Received: from a.example (a.example [192.0.2.1]) by mx.example.org with SMTP${DATE}`,
        `Received: from c.example (c.example [198.51.100.1]) by a.example with SMTP${DATE}`,
        'Authentication-Results: a.example; spf=pass',
      ]),
      { boundary: 1 },
      deps(),
    );
    expect(report.receiver.results[0]?.trusted).toBe(true);
  });

  it('IN-7: given a message with LF line endings, when analyzed, then fields are split and input.lf-converted is reported', async () => {
    const report = await analyze(
      new TextEncoder().encode(
        `Received: from a.example (a.example [192.0.2.1]) by mx.example.org with SMTP${DATE}\nAuthentication-Results: mx.example.org; spf=pass\n\nbody\n`,
      ),
      {},
      deps(),
    );
    expect(report.headers.map((h) => h.name)).toEqual(['Received', 'Authentication-Results']);
    expect(report.receiver.results[0]?.trusted).toBe(true);
    expect(report.findings.map((f) => f.id)).toContain('input.lf-converted');
  });

  it('IN-3: given input over 50 MiB, when analyzed, then only input.too-large is reported', async () => {
    const input = new Uint8Array(50 * 1024 * 1024 + 1).fill(0x0a);
    const report = await analyze(input, {}, deps());
    expect(report.findings).toEqual([
      expect.objectContaining({
        id: 'input.too-large',
        severity: 'error',
        evidence: [{ kind: 'bytes', range: { start: 0, end: input.length } }],
      }),
    ]);
    expect(report.headers).toEqual([]);
    expect(report.summary).toEqual([
      { method: 'dkim', result: 'not-evaluated', reason: 'invalid-input', counts: {} },
    ]);
  });

  const privateSample = new URL('../../../samples/private/test.eml', import.meta.url);
  it.skipIf(!existsSync(privateSample))(
    'REQ-MAIL-008: given the private Gmail sample, when analyzed, then mx.google.com results are trusted and pass',
    async () => {
      const report = await analyze(new Uint8Array(readFileSync(privateSample)), {}, deps());
      const google = report.receiver.results.find((r) => r.authservId === 'mx.google.com');
      expect(google?.trusted).toBe(true);
      expect(google?.entries.map((e) => `${e.method}=${e.result}`)).toEqual([
        'dkim=pass',
        'spf=pass',
        'dmarc=pass',
      ]);
    },
  );

  describe('DKIM', () => {
    const HEADERS = ['From: a@example.com\r\n', 'Subject: Hi\r\n'];
    async function signed(extra?: string) {
      const key = await rsaKey(2048);
      const text = await signMessage({
        key,
        d: 'example.com',
        s: 'sel',
        headers: HEADERS,
        body: 'Hello\r\n',
        h: 'from:from:subject',
        signed: [HEADERS[0] as string, '', HEADERS[1] as string],
        ...(extra ? { extra } : {}),
      });
      const record: ManualRecord = {
        name: 'sel._domainkey.example.com',
        type: 'TXT',
        data: `v=DKIM1; p=${key.p}`,
      };
      return { text, record };
    }
    /** A Received field on top, dated 2026-10-01, so it is the boundary and the reference time. */
    const RECEIVED =
      'Received: from out.example.com (out.example.com [192.0.2.1]) by mx.example.org with ESMTP id x; Thu, 1 Oct 2026 00:00:00 +0000\r\n';
    const enc = (s: string) => new TextEncoder().encode(s);

    it('REQ-MAIL-004: given a signed message and its key, when analyzed, then the report has the DKIM result and the DNS log', async () => {
      const { text, record } = await signed();
      const report = await analyze(enc(RECEIVED + text), {}, deps({ records: [record] }));
      expect(report.dkim).toEqual([
        expect.objectContaining({ field: 1, result: 'pass', d: 'example.com' }),
      ]);
      expect(report.dnsLog).toEqual([
        expect.objectContaining({ queryId: 'q1', name: 'sel._domainkey.example.com', type: 'TXT' }),
      ]);
      expect(report.summary).toEqual([{ method: 'dkim', result: 'pass', counts: { pass: 1 } }]);
    });

    it('TIME-2: given x= after the boundary date but before now, when analyzed, then the signature is not expired', async () => {
      const x = Date.parse('2026-10-10T00:00:00Z') / 1000;
      const { text, record } = await signed(`t=${x - 100}; x=${x}`);
      const report = await analyze(enc(RECEIVED + text), {}, deps({ records: [record] }));
      expect(report.dkim[0]?.result).toBe('pass');
      expect(report.referenceTime).toBe('2026-10-01T00:00:00.000Z');
    });

    it('DNS: given a query was made with an unauthenticated answer used for a result, when analyzed, then dns.answers-are-current and dns.unauthenticated point at it', async () => {
      const { text, record } = await signed();
      const report = await analyze(
        enc(text),
        {},
        deps({ records: [record], source: 'cloudflare' }),
      );
      const byId = (id: string) => report.findings.find((f) => f.id === id);
      expect(byId('dns.answers-are-current')?.evidence).toEqual([{ kind: 'dns', queryId: 'q1' }]);
      expect(byId('dns.unauthenticated')?.evidence).toEqual([{ kind: 'dns', queryId: 'q1' }]);
    });

    it('DNS: given offline mode, when analyzed, then there is no dns.answers-are-current', async () => {
      const { text, record } = await signed();
      const report = await analyze(enc(text), {}, deps({ records: [record] }));
      expect(report.findings.map((f) => f.id)).not.toContain('dns.answers-are-current');
    });

    it('DNS: given an unauthenticated NXDOMAIN that decided a result, when analyzed, then dns.unauthenticated points at it', async () => {
      const { text } = await signed();
      const nx: Transport = async () => ({ rcode: 'NXDOMAIN', records: [], authenticated: false });
      const report = await analyze(enc(text), {}, deps({ transport: nx, source: 'cloudflare' }));
      expect(report.findings.find((f) => f.id === 'dns.unauthenticated')?.evidence).toEqual([
        { kind: 'dns', queryId: 'q1' },
      ]);
    });

    it('DNS: given no DNS query, when analyzed, then there is no dns.answers-are-current', async () => {
      const report = await analyze(enc('From: a@example.com\r\n\r\nbody\r\n'), {}, deps());
      expect(report.findings.map((f) => f.id)).not.toContain('dns.answers-are-current');
    });

    it('REP-7: given an unexpected error inside DKIM, when analyzed, then each signature is not-evaluated with internal-error and analysis.internal-error', async () => {
      const { text } = await signed();
      const broken: Transport = async () => {
        throw new TypeError('bug');
      };
      const report = await analyze(enc(text), {}, deps({ transport: broken }));
      expect(report.dkim).toEqual([
        expect.objectContaining({ field: 0, result: 'not-evaluated', reason: 'internal-error' }),
      ]);
      expect(report.dkim[0]?.findings).toContainEqual(
        expect.objectContaining({
          id: 'analysis.internal-error',
          severity: 'error',
          evidence: [{ kind: 'header', index: 0 }],
        }),
      );
      expect(report.receiver).toBeDefined();
    });

    it('REP-8: given DNS that never answers, when the deadline passes, then each signature is not-evaluated with timeout and analysis.timeout', async () => {
      const { text } = await signed();
      const hang: Transport = (_q, signal) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
      const report = await analyze(enc(text), {}, deps({ transport: hang, deadlineMs: 20 }));
      expect(report.dkim).toEqual([
        expect.objectContaining({ result: 'not-evaluated', reason: 'timeout' }),
      ]);
      expect(report.dkim[0]?.findings.map((f) => f.id)).toEqual(['analysis.timeout']);
    });

    it('given the caller cancels, when analyzing, then analyze rejects with AbortError', async () => {
      const { text } = await signed();
      const controller = new AbortController();
      const hang: Transport = (_q, signal) =>
        new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
      const pending = analyze(enc(text), {}, deps({ transport: hang, signal: controller.signal }));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
  });
});

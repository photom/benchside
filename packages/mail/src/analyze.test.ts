import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seal } from '../test/support/arc-sealer.ts';
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
      { method: 'spf', result: 'not-evaluated', reason: 'invalid-input', counts: {} },
      { method: 'dkim', result: 'not-evaluated', reason: 'invalid-input', counts: {} },
      { method: 'arc', result: 'not-evaluated', reason: 'invalid-input', counts: {} },
    ]);
    expect(report.arc).toEqual({
      result: 'not-evaluated',
      reason: 'invalid-input',
      sets: [],
      findings: [],
    });
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
      // SPF queries the HELO domain too; the DKIM key is one of the logged queries.
      expect(report.dnsLog).toContainEqual(
        expect.objectContaining({
          queryId: report.dkim[0]?.keyQueryId,
          name: 'sel._domainkey.example.com',
          type: 'TXT',
        }),
      );
      expect(report.summary.slice(1)).toEqual([
        { method: 'dkim', result: 'pass', counts: { pass: 1 } },
        { method: 'arc', result: 'none', counts: {} },
      ]);
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

  describe('ARC', () => {
    const enc = (s: string) => new TextEncoder().encode(s);

    async function sealed() {
      const key = await rsaKey(2048);
      const dkimText = await signMessage({
        key,
        d: 'example.com',
        s: 'sel',
        headers: ['From: a@example.com\r\n', 'Subject: Hi\r\n'],
        body: 'Hello\r\n',
        h: 'from:subject',
        signed: ['From: a@example.com\r\n', 'Subject: Hi\r\n'],
      });
      const split = dkimText.indexOf('\r\n\r\n');
      const headers = dkimText
        .slice(0, split + 2)
        .split(/(?<=\r\n)(?=[^ \t])/)
        .filter((f) => f.length > 0);
      const m = await seal({ headers, body: 'Hello\r\n' }, { key, d: 'example.com', s: 'sel' });
      const record: ManualRecord = {
        name: 'sel._domainkey.example.com',
        type: 'TXT',
        data: `v=DKIM1; p=${key.p}`,
      };
      return { text: `${m.headers.join('')}\r\n${m.body}`, record };
    }

    it('REQ-MAIL-007, SUM-5: given a sealed message, when analyzed, then the report has the ARC chain and its summary line', async () => {
      const { text, record } = await sealed();
      const report = await analyze(enc(text), {}, deps({ records: [record] }));
      expect(report.arc).toMatchObject({ result: 'pass', oldestPass: 0 });
      expect(report.summary.slice(1)).toEqual([
        { method: 'dkim', result: 'pass', counts: { pass: 1 } },
        { method: 'arc', result: 'pass', counts: { sets: 1 } },
      ]);
    });

    it('given the caller cancels while DKIM and ARC wait, when analyzing, then analyze rejects and no rejection is left unhandled', async () => {
      const { text } = await sealed();
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      try {
        const controller = new AbortController();
        const hang: Transport = (_q, signal) =>
          new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
        const pending = analyze(
          enc(text),
          {},
          deps({ transport: hang, signal: controller.signal }),
        );
        setTimeout(() => controller.abort(), 10);
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await new Promise((r) => setTimeout(r, 20));
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
      expect(unhandled).toEqual([]);
    });

    it('given DKIM and ARC signed with the same key, when analyzed, then the key is queried once', async () => {
      const { text, record } = await sealed();
      const report = await analyze(enc(text), {}, deps({ records: [record] }));
      expect(report.dnsLog).toHaveLength(1);
      expect(report.arc.sets[0]?.seal?.keyQueryId).toBe('q1');
      expect(report.dkim[0]?.keyQueryId).toBe('q1');
    });

    it('DNS: given an unauthenticated key used only by ARC, when analyzed, then dns.unauthenticated points at it', async () => {
      const { text, record } = await sealed();
      const withoutDkim = text.replace(/^DKIM-Signature:[\s\S]*?\r\n(?=[^ \t])/m, '');
      const report = await analyze(
        enc(withoutDkim),
        {},
        deps({ records: [record], source: 'cloudflare' }),
      );
      expect(report.dkim).toEqual([]);
      expect(report.findings.find((f) => f.id === 'dns.unauthenticated')?.evidence).toEqual([
        { kind: 'dns', queryId: 'q1' },
      ]);
    });
  });

  describe('SPF', () => {
    const DELIVERED = [
      `Received: from out.example.com (out.example.com [192.0.2.1]) by mx.example.org with ESMTP id x${DATE}`,
      'Return-Path: <bounce@example.com>',
      'From: a@example.com',
    ];
    const spfRecord = (data: string): ManualRecord => ({ name: 'example.com', type: 'TXT', data });

    it('REQ-MAIL-003, SUM-1: given a delivered message and an SPF record, when analyzed, then SPF is evaluated and summarized first', async () => {
      const report = await analyze(
        bytes(DELIVERED),
        {},
        deps({ records: [spfRecord('v=spf1 ip4:192.0.2.0/24 -all')] }),
      );
      expect(report.spf.mailFrom).toMatchObject({ result: 'pass', domain: 'example.com' });
      expect(report.summary[0]).toEqual({ method: 'spf', result: 'pass', counts: {} });
    });

    it('ENV-11..13: given a delivered message, when analyzed, then the envelope values and their sources are in the report', async () => {
      const report = await analyze(bytes(DELIVERED), {}, deps());
      expect(report.envelope).toEqual({
        clientIp: { value: '192.0.2.1', source: { field: 0, rule: 'ENV-11' } },
        helo: { value: 'out.example.com', source: { field: 0, rule: 'ENV-12' } },
        mailFrom: { value: 'bounce@example.com', source: { field: 1, rule: 'ENV-13' } },
      });
    });

    it('SPF-3, SUM-1: given no Received field, when analyzed, then SPF is not-evaluated with missing-delivery-detail', async () => {
      const report = await analyze(bytes(['Return-Path: <bounce@example.com>']), {}, deps());
      expect(report.summary[0]).toEqual({
        method: 'spf',
        result: 'not-evaluated',
        reason: 'missing-delivery-detail',
        counts: {},
      });
    });

    it('DNS: given an unauthenticated SPF answer, when analyzed, then dns.unauthenticated points at it', async () => {
      const report = await analyze(
        bytes(DELIVERED),
        {},
        deps({ records: [spfRecord('v=spf1 -all')], source: 'cloudflare' }),
      );
      const unauthenticated = report.findings.find((f) => f.id === 'dns.unauthenticated');
      expect(unauthenticated?.evidence).toContainEqual({
        kind: 'dns',
        queryId: report.spf.mailFrom.trace?.queryId,
      });
    });

    it('ENV-13: given two Return-Path fields, when analyzed, then envelope.multiple-return-path is reported', async () => {
      const report = await analyze(
        bytes([...DELIVERED, 'Return-Path: <other@example.net>']),
        {},
        deps(),
      );
      expect(report.findings.map((f) => f.id)).toContain('envelope.multiple-return-path');
    });
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from './analyze.ts';

const bytes = (lines: string[]) =>
  new TextEncoder().encode(`${lines.join('\r\n')}\r\n\r\nbody\r\n`);
const DATE = '; Mon, 5 Oct 2026 10:00:00 +0000';

describe('analyze (receiver results slice)', () => {
  it('AR-10: given a delivered message, when analyzed, then the report lists receiver results with trust', () => {
    const report = analyze(
      bytes([
        `Received: from out.example.com (out.example.com. [192.0.2.1]) by mx.example.org with ESMTPS id x1${DATE}`,
        'Authentication-Results: mx.example.org; dkim=pass header.d=example.com',
        'From: a@example.com',
      ]),
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

  it('AR-11: given receiver results but none of our own, when analyzed, then there are no comparisons and no authres.differs', () => {
    const report = analyze(
      bytes([
        `Received: from a.example (a.example [192.0.2.1]) by mx.example.org with SMTP${DATE}`,
        'Authentication-Results: mx.example.org; spf=fail',
      ]),
    );
    expect(report.receiver.comparisons).toEqual([]);
    expect(report.findings.map((f) => f.id)).not.toContain('authres.differs');
  });

  it('given findings from several steps, when analyzed, then all are in the report', () => {
    const report = analyze(
      bytes([
        `Received: from a (a [10.0.0.1]) by b with SMTP${DATE}`,
        'Authentication-Results: elsewhere.example; dkim pass',
      ]),
    );
    expect(report.findings.map((f) => f.id).sort()).toEqual([
      'authres.syntax',
      'authres.untrusted',
      'envelope.no-public-hop',
    ]);
  });

  it('ENV-10: given a user-chosen boundary, when analyzed, then trust follows it', () => {
    const report = analyze(
      bytes([
        `Received: from a.example (a.example [192.0.2.1]) by mx.example.org with SMTP${DATE}`,
        `Received: from c.example (c.example [198.51.100.1]) by a.example with SMTP${DATE}`,
        'Authentication-Results: a.example; spf=pass',
      ]),
      { boundary: 1 },
    );
    expect(report.receiver.results[0]?.trusted).toBe(true);
  });

  const privateSample = new URL('../../../samples/private/test.eml', import.meta.url);
  it.skipIf(!existsSync(privateSample))(
    'REQ-MAIL-008: given the private Gmail sample, when analyzed, then mx.google.com results are trusted and pass',
    () => {
      const report = analyze(new Uint8Array(readFileSync(privateSample)));
      const google = report.receiver.results.find((r) => r.authservId === 'mx.google.com');
      expect(google?.trusted).toBe(true);
      expect(google?.entries.map((e) => `${e.method}=${e.result}`)).toEqual([
        'dkim=pass',
        'spf=pass',
        'dmarc=pass',
      ]);
    },
  );
});

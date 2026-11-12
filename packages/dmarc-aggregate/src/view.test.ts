import { describe, expect, it } from 'vitest';
import { Batch } from './batch.ts';
import { Findings } from './findings.ts';
import {
  D14,
  DAY,
  direct,
  failing,
  forwarded,
  NOW,
  parse,
  type ReportOpts,
  rec,
  reportXml,
} from './test/report-xml.ts';
import { type Filters, view } from './view.ts';

const ALL: Filters = { domain: null, reporters: null, days: null };
const on = (n: number) => ({ begin: D14 + n * DAY, end: D14 + (n + 1) * DAY - 1 });

/** A batch of the given reports, each with a distinct report_id unless set. */
function batch(...reports: ReportOpts[]): Batch {
  const b = new Batch(new Findings(), { now: () => NOW + 4000 * DAY });
  reports.forEach((o, i) => {
    const document = parse(reportXml({ id: `id${i}`, ...o }));
    b.addDocument({ label: `r${i}`, filename: null, document }, 0);
  });
  return b;
}

describe('View: filters (CMB-6)', () => {
  const b = batch(
    { ...on(0), records: direct('192.0.2.1', 1) },
    { ...on(1), org: 'Other', records: direct('192.0.2.1', 10) },
    { ...on(2), domain: 'example.net', records: direct('192.0.2.1', 100) },
    { begin: null, end: null, records: direct('192.0.2.1', 1000) },
  );
  const messages = (f: Partial<Filters>) => view(b, { ...ALL, ...f }).totals.messages;

  it('CMB-6: given no filter, when viewed, then every counted report counts', () => {
    expect(messages({})).toBe(1111);
  });

  it('CMB-6: given a policy domain, when viewed, then only its reports count', () => {
    expect(messages({ domain: 'example.net' })).toBe(100);
  });

  it('CMB-6: given reporters in another case, when viewed, then they match case-insensitively', () => {
    expect(messages({ reporters: ['OTHER'] })).toBe(10);
    expect(messages({ reporters: ['other', 'example receiver'] })).toBe(1111);
    expect(messages({ reporters: [] })).toBe(0);
  });

  it('CMB-6: given a day range, when viewed, then reports of those days count and undated ones do not', () => {
    expect(messages({ days: { from: '2023-11-15', to: '2023-11-16' } })).toBe(110);
    expect(messages({ days: { from: '2023-11-14', to: '2023-11-14' } })).toBe(1);
  });

  it('CMB-6: given a duplicate or a conflict, when viewed, then it does not count', () => {
    const d = batch({ ...on(0), records: direct('192.0.2.1', 5) });
    d.addDocument(
      {
        label: 'copy',
        filename: null,
        document: parse(reportXml({ id: 'id0', ...on(0), records: direct('192.0.2.1', 5) })),
      },
      0,
    );
    d.addDocument(
      {
        label: 'conflict',
        filename: null,
        document: parse(reportXml({ id: 'id0', ...on(0), records: direct('192.0.2.1', 7) })),
      },
      0,
    );
    expect(view(d, ALL).totals.messages).toBe(5);
  });
});

describe('View: totals (CMB-9)', () => {
  it('CMB-9: given passing and failing records, when viewed, then messages, rate, dispositions, paths, causes, and counts', () => {
    const b = batch(
      {
        ...on(0),
        records:
          direct('192.0.2.1', 6) + forwarded('192.0.2.2', 2) + failing('192.0.2.3', 2, 'reject'),
      },
      {
        ...on(1),
        org: 'Other',
        records: rec({ ip: '2001:db8::1', headerFrom: 'mail.example.com', count: 0 }),
      },
    );
    const t = view(b, ALL).totals;
    expect(t).toEqual({
      messages: 10,
      passing: 8,
      failing: 2,
      passRate: 0.8,
      byDisposition: [
        { disposition: 'none', messages: 8 },
        { disposition: 'reject', messages: 2 },
      ],
      byPath: { direct: 6, forwarded: 2, other: 2 },
      byCause: [{ cause: 'unauthenticated', messages: 2 }],
      reports: 2,
      reporters: 2,
      sourceIps: 4,
      authorDomains: 2,
      period: { begin: D14, end: D14 + 2 * DAY - 1 },
    });
  });

  it('CMB-9: given no messages and no dated report, when viewed, then no pass rate and no period', () => {
    const t = view(batch({ begin: null, end: null, records: rec({ count: 0 }) }), ALL).totals;
    expect([t.messages, t.passRate, t.period, t.reports]).toEqual([0, null, null, 1]);
  });

  it('CMB-9: given an undated report with begin and end (end before begin), when viewed, then the period leaves it out', () => {
    const b = batch({ ...on(0) }, { begin: D14 + 10 * DAY, end: D14 + 9 * DAY });
    expect(view(b, ALL).totals.period).toEqual({ begin: D14, end: D14 + DAY - 1 });
  });

  it('CMB-9: given causes in rule order, when viewed, then byCause follows the rule order', () => {
    const b = batch(
      { ...on(0), records: failing('192.0.2.9', 3) + forwarded('192.0.2.8') },
      { ...on(1), records: failing('192.0.2.8', 1) },
    );
    expect(view(b, ALL).totals.byCause).toEqual([
      { cause: 'spf-broken-by-forwarding', messages: 1 },
      { cause: 'unauthenticated', messages: 3 },
    ]);
  });
});

describe('View: timeline (CMB-10)', () => {
  it('CMB-10: given reports on days 0 and 2, when viewed, then day 1 is present with no value', () => {
    const b = batch(
      { ...on(0), records: direct('192.0.2.1', 3) + failing('192.0.2.2', 1) },
      { ...on(2), records: forwarded('192.0.2.3', 2) },
      { begin: null, end: null, records: direct('192.0.2.1', 7) },
    );
    const v = view(b, ALL);
    expect(v.timeline).toEqual([
      { date: '2023-11-14', messages: { direct: 3, forwarded: 0, other: 1 }, passRate: 0.75 },
      { date: '2023-11-15', messages: null, passRate: null },
      { date: '2023-11-16', messages: { direct: 0, forwarded: 2, other: 0 }, passRate: 1 },
    ]);
    expect([v.undatedMessages, v.earlierMessages]).toEqual([7, 0]);
  });

  it('CMB-10: given a dated report with no messages, when viewed, then its day has zeros and no rate', () => {
    expect(view(batch({ ...on(0), records: rec({ count: 0 }) }), ALL).timeline).toEqual([
      { date: '2023-11-14', messages: { direct: 0, forwarded: 0, other: 0 }, passRate: null },
    ]);
  });

  it('CMB-10: given days over 1 000 apart, when viewed, then the latest 1 000 days and the earlier messages apart', () => {
    const v = view(
      batch(
        { ...on(0), records: direct('192.0.2.1', 4) },
        { ...on(1000), records: direct('192.0.2.1', 5) },
      ),
      ALL,
    );
    expect(v.timeline).toHaveLength(1000);
    expect(v.timeline[0]?.date).toBe('2023-11-15');
    expect(v.timeline[999]).toMatchObject({ messages: { direct: 5 } });
    expect(v.earlierMessages).toBe(4);
  });

  it('CMB-10: given no dated report, when viewed, then an empty timeline', () => {
    expect(view(batch({ begin: null, end: null }), ALL).timeline).toEqual([]);
  });
});

describe('View: reporters, formats, errors (CMB-11..13)', () => {
  it('CMB-11: given two reporters, when viewed, then rows by messages with passing, rate, days, and formats', () => {
    const b = batch(
      { ...on(0), org: 'Small', records: direct('192.0.2.1', 1) },
      { ...on(1), org: 'Big', records: direct('192.0.2.1', 3) + failing('192.0.2.2', 1) },
      { ...on(3), org: 'BIG', records: direct('192.0.2.1', 4) },
    );
    expect(view(b, ALL).reporters).toEqual([
      {
        reporter: 'Big',
        reports: 2,
        messages: 8,
        passing: 7,
        passRate: 7 / 8,
        days: 2,
        firstDay: '2023-11-15',
        lastDay: '2023-11-17',
        formats: ['rfc9990'],
      },
      {
        reporter: 'Small',
        reports: 1,
        messages: 1,
        passing: 1,
        passRate: 1,
        days: 1,
        firstDay: '2023-11-14',
        lastDay: '2023-11-14',
        formats: ['rfc9990'],
      },
    ]);
  });

  it('CMB-12: given reports of two formats, one mixed, when viewed, then counts by format and namespace', () => {
    const b = batch({ ...on(0) }, { ...on(1), errors: ['x', 'y'] }, { ...on(2), namespace: null });
    expect(view(b, ALL).formats).toEqual([
      { format: 'rfc9990', namespace: 'urn:ietf:params:xml:ns:dmarc-2.0', reports: 2, mixed: 1 },
      { format: 'rfc7489', namespace: null, reports: 1, mixed: 0 },
    ]);
  });

  it('CMB-13: given error texts, when viewed, then each with its report, reporter, domain, and day', () => {
    const b = batch({ ...on(0) }, { ...on(1), org: 'Other', errors: ['DNS timeout', 'Bad data'] });
    expect(view(b, ALL).reporterErrors).toEqual([
      {
        report: 1,
        reporter: 'Other',
        policyDomain: 'example.com',
        day: '2023-11-15',
        text: 'DNS timeout',
      },
      {
        report: 1,
        reporter: 'Other',
        policyDomain: 'example.com',
        day: '2023-11-15',
        text: 'Bad data',
      },
    ]);
    expect(view(b, { ...ALL, reporters: ['example receiver'] }).reporterErrors).toEqual([]);
  });
});

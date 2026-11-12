import { describe, expect, it } from 'vitest';
import { Batch } from './batch.ts';
import { Findings } from './findings.ts';
import {
  D14,
  DAY,
  failing,
  forwarded,
  NOW,
  parse,
  type ReportOpts,
  rec,
  reportXml,
} from './test/report-xml.ts';

function setup() {
  const findings = new Findings();
  const batch = new Batch(findings, { now: () => NOW });
  let n = 0;
  const add = (o: ReportOpts = {}, filename: string | null = null, file = 0) =>
    batch.addDocument({ label: `f${n++}.xml`, filename, document: parse(reportXml(o)) }, file);
  const ids = () => findings.list.map((f) => f.id);
  return { batch, findings, add, ids };
}

describe('Batch: identity and duplicates (CMB-1..3)', () => {
  it('CMB-2: given the same bytes twice, when added, then the second is a duplicate and not counted', () => {
    const { add, ids, findings } = setup();
    expect(add()?.status).toBe('counted');
    expect(add()?.status).toBe('duplicate');
    expect(ids()).toEqual(['aggregate.report.duplicate']);
    expect(findings.list[0]).toMatchObject({ severity: 'info', label: 'f1.xml', report: 1 });
    expect(findings.list[0]?.message).toContain('f0.xml');
  });

  it('CMB-2: given the same bytes twice without report_id, when added, then the second is a duplicate', () => {
    const { add } = setup();
    add({ id: null });
    expect(add({ id: null })?.status).toBe('duplicate');
  });

  it('CMB-1: given two different reports without report_id, when added, then both are counted', () => {
    const { add, ids } = setup();
    add({ id: null });
    expect(add({ id: null, note: 'x' })?.status).toBe('counted');
    expect(ids()).not.toContain('aggregate.report.conflict');
  });

  it('CMB-3: given the same identity with different bytes, when added, then conflict and the first stays', () => {
    const { add, ids, findings, batch } = setup();
    add();
    const second = add({ org: 'EXAMPLE receiver', domain: 'Example.COM.', note: 'resent' });
    expect(second?.status).toBe('conflict');
    expect(ids()).toContain('aggregate.report.conflict');
    expect(findings.list.find((f) => f.id === 'aggregate.report.conflict')).toMatchObject({
      severity: 'warning',
      report: 1,
    });
    expect(batch.reports.map((r) => r.status)).toEqual(['counted', 'conflict']);
  });

  it('CMB-1: given the same report_id from another reporter or for another domain, when added, then counted', () => {
    const { add } = setup();
    add();
    expect(add({ org: 'Other' })?.status).toBe('counted');
    expect(add({ domain: 'example.net' })?.status).toBe('counted');
  });

  it('CMB-2: given a byte-identical copy whose identity also matches, when added, then duplicate, not conflict', () => {
    const { add, ids } = setup();
    add();
    add();
    expect(ids()).toEqual(['aggregate.report.duplicate']);
  });

  it('CMB-2: given a copy of a conflicting report, when added, then conflict again, as the counted report differs', () => {
    const { add } = setup();
    add();
    add({ note: 'v2' });
    expect(add({ note: 'v2' })?.status).toBe('conflict');
  });
});

describe('Batch: overlaps (CMB-4)', () => {
  it('CMB-4: given two reports of one reporter and domain whose ranges overlap, when added, then overlap on the later one and both counted', () => {
    const { add, findings } = setup();
    add({ id: 'a', begin: 100, end: 200 });
    const b = add({ id: 'b', begin: 150, end: 250 });
    expect(b?.status).toBe('counted');
    expect(findings.list).toHaveLength(1);
    expect(findings.list[0]).toMatchObject({
      id: 'aggregate.report.overlap',
      severity: 'warning',
      report: 1,
    });
    expect(findings.list[0]?.message).toContain('f0.xml');
  });

  it('CMB-4: given a report overlapping three earlier ones, when added, then one finding naming the first and the count of others', () => {
    const { add, findings } = setup();
    add({ id: 'a', begin: 100, end: 200 });
    add({ id: 'b', begin: 200, end: 300 });
    add({ id: 'c', begin: 300, end: 400 });
    add({ id: 'd', begin: 150, end: 350 });
    expect(findings.list.map((f) => f.report)).toEqual([3]);
    expect(findings.list[0]?.message).toContain('f0.xml');
    expect(findings.list[0]?.message).toContain('2 other');
  });

  it('CMB-4: given ranges that only touch, another domain, another reporter, or no range, when added, then no overlap', () => {
    const { add, ids } = setup();
    add({ id: 'a', begin: 100, end: 200 });
    add({ id: 'b', begin: 200, end: 300 });
    add({ id: 'c', begin: 100, end: 200, domain: 'example.net' });
    add({ id: 'd', begin: 100, end: 200, org: 'Other' });
    add({ id: 'e', begin: null, end: null });
    expect(ids()).not.toContain('aggregate.report.overlap');
  });

  it('CMB-4: given an overlapping report that is a duplicate, when added, then no overlap', () => {
    const { add, ids } = setup();
    add({ begin: 100, end: 200 });
    add({ begin: 100, end: 200 });
    expect(ids()).toEqual(['aggregate.report.duplicate']);
  });
});

describe('Batch: reporters (CMB-5)', () => {
  it('CMB-5: given one reporter in two spellings, when named, then the first spelling loaded', () => {
    const { add, batch } = setup();
    add({ org: 'Mail Co', id: 'a' });
    add({ org: 'MAIL CO', id: 'b' });
    expect(batch.reporterName('mail co')).toBe('Mail Co');
    expect(batch.reports.map((r) => r.reporter)).toEqual(['Mail Co', 'MAIL CO']);
  });
});

describe('Batch: file names (INP-9, INP-10)', () => {
  it('INP-10: given a parsed file name, when added, then the summary carries receiver and unique ID', () => {
    const { add } = setup();
    const s = add({}, 'mx.example.org!example.com!1700000000!1700086399!u1.xml.gz');
    expect(s?.filename).toMatchObject({ receiver: 'mx.example.org', uniqueId: 'u1' });
  });

  it('INP-9: given a name whose domain and end differ from the content, when added, then one mismatch listing both', () => {
    const { add, findings } = setup();
    add({}, 'mx.example.org!example.net!1700000000!1700000001.xml');
    expect(findings.list).toHaveLength(1);
    expect(findings.list[0]).toMatchObject({
      id: 'aggregate.filename.mismatch',
      severity: 'info',
      report: 0,
    });
    expect(findings.list[0]?.message).toMatch(/policy domain.*end/);
  });

  it('INP-9: given a matching name, a name that does not parse, or no name, when added, then no finding', () => {
    const { add, ids } = setup();
    expect(
      add({ id: 'a' }, 'mx.example.org!EXAMPLE.com.!1700000000!1700086399.xml')?.filename,
    ).not.toBeNull();
    expect(add({ id: 'b' }, 'report.xml')?.filename).toBeNull();
    expect(add({ id: 'c' }, null)?.filename).toBeNull();
    expect(ids()).not.toContain('aggregate.filename.mismatch');
  });
});

describe('Batch: summaries and findings (REP-1..3, REP-7)', () => {
  it('REP-1: given reports from two files, when added, then indexes follow the reading order and carry the file', () => {
    const { add, batch } = setup();
    add({ id: 'a', count: 2 }, null, 0);
    add({ id: 'a' }, null, 0);
    add({ id: 'b', count: 5 }, null, 1);
    expect(batch.reports.map((r) => [r.index, r.file, r.label, r.records, r.messages])).toEqual([
      [0, 0, 'f0.xml', 1, 2],
      [1, 0, 'f1.xml', 1, 3],
      [2, 1, 'f2.xml', 1, 5],
    ]);
  });

  it('FMT-1: given a document that is not a report, when added, then null and one error with the file and label', () => {
    const { batch, findings } = setup();
    expect(
      batch.addDocument({ label: 'x.xml', filename: 'x.xml', document: parse('<other/>') }, 4),
    ).toBeNull();
    expect(findings.list).toEqual([
      expect.objectContaining({ id: 'aggregate.format.not-feedback', file: 4, label: 'x.xml' }),
    ]);
    expect(findings.list[0]?.report).toBeUndefined();
    expect(batch.reports).toEqual([]);
  });

  it('REP-7: given format findings, when added, then they carry the file, label, report, record, path, and line', () => {
    const { batch, findings } = setup();
    const text = reportXml().replace('<count>3</count>', '<count>x</count>');
    batch.addDocument({ label: 'a.zip › r.xml', filename: 'r.xml', document: parse(text) }, 2);
    expect(findings.list[0]).toMatchObject({
      file: 2,
      label: 'a.zip › r.xml',
      report: 0,
      record: 0,
      path: 'record',
      line: 1,
    });
  });

  it('REP-7: given an XML warning in a document, when added, then it comes first and carries the report', () => {
    const { batch, findings } = setup();
    const bytes = new TextEncoder().encode(reportXml({ org: 'A__B' }));
    const text = new TextDecoder().decode(bytes);
    bytes[text.indexOf('A__B') + 1] = 0xff;
    batch.addDocument({ label: 'r.xml', filename: null, document: parse(bytes) }, 0);
    expect(findings.list[0]).toMatchObject({
      id: 'aggregate.xml.encoding',
      severity: 'warning',
      report: 0,
      column: 1,
    });
  });
});

describe('Batch: classification (FCT-6, FCT-7)', () => {
  const causes = (batch: Batch, report: number) =>
    batch.classifications(report)?.map((c) => c.causeRule ?? c.pathRule);

  it('FCT-7: given a failing record before a forwarded one from the same IP in one report, when added, then the failing one is CAUSE-3', () => {
    const { add, batch } = setup();
    add({ records: failing('198.51.100.7') + forwarded('198.51.100.7') + failing('203.0.113.9') });
    expect(causes(batch, 0)).toEqual(['CAUSE-3', 'PATH-3', 'CAUSE-9']);
  });

  it('FCT-7: given a later report that reveals a forwarder IP, when added, then earlier failing records of that IP become CAUSE-3', () => {
    const { add, batch } = setup();
    add({ id: 'a', records: failing('198.51.100.7') + failing('203.0.113.9') });
    expect(causes(batch, 0)).toEqual(['CAUSE-9', 'CAUSE-9']);
    add({ id: 'b', records: forwarded('198.51.100.7') });
    expect(causes(batch, 0)).toEqual(['CAUSE-3', 'CAUSE-9']);
  });

  it('FCT-7: given a forwarded record in a report that is not counted, when added, then the IP is not a forwarder', () => {
    const { add, batch } = setup();
    add({ id: 'a', records: failing('198.51.100.7') });
    add({ id: 'a', note: 'resent', records: forwarded('198.51.100.7') });
    expect(causes(batch, 0)).toEqual(['CAUSE-9']);
    expect(batch.classifications(1)).toBeNull();
  });

  it('FCT-6: given an aligned pass without a raw pass, when counted, then one inconsistent finding for that record', () => {
    const { add, findings } = setup();
    add({ records: forwarded('192.0.2.1') + rec({ dkim: 'pass', spf: 'pass' }) });
    expect(findings.list).toEqual([
      expect.objectContaining({
        id: 'aggregate.record.inconsistent',
        severity: 'info',
        report: 0,
        record: 1,
      }),
    ]);
    expect(findings.list[0]?.message).toMatch(/DKIM.*SPF/);
  });
});

describe('Batch: report days (CMB-7)', () => {
  it('CMB-7: given a period, when added, then the day is the UTC date of its midpoint', () => {
    const { add } = setup();
    expect(add({ begin: D14, end: D14 + DAY - 1 })?.day).toBe('2023-11-14');
    expect(add({ id: 'b', begin: D14 + 12 * 3600, end: D14 + DAY + 12 * 3600 })?.day).toBe(
      '2023-11-15',
    );
  });

  it('CMB-7: given no period, when added, then undated without a CMB-7 finding', () => {
    const { add, ids } = setup();
    expect(add({ begin: null, end: null })?.day).toBeNull();
    expect(ids().filter((id) => !id.startsWith('aggregate.schema.'))).toEqual([]);
  });

  it('CMB-7: given end before begin, when added, then value.invalid and undated', () => {
    const { add, findings } = setup();
    expect(add({ begin: D14 + 10, end: D14 })?.day).toBeNull();
    expect(findings.list).toEqual([
      expect.objectContaining({ id: 'aggregate.value.invalid', severity: 'warning', report: 0 }),
    ]);
  });

  it('CMB-7: given an end more than 2 days after the time of reading, when added, then future and undated', () => {
    const { add, findings } = setup();
    expect(add({ id: 'a', begin: NOW, end: NOW + 2 * DAY })?.day).toBe('2023-11-17');
    expect(add({ id: 'b', begin: NOW + 2 * DAY, end: NOW + 2 * DAY + 1 })?.day).toBeNull();
    expect(findings.list).toEqual([
      expect.objectContaining({ id: 'aggregate.report.future', severity: 'warning', report: 1 }),
    ]);
  });

  it('CMB-7: given a period over 48 hours, when added, then long-range and the midpoint day', () => {
    const { add, findings } = setup();
    expect(add({ id: 'a', begin: D14 - 2 * DAY, end: D14 })?.day).toBe('2023-11-13');
    expect(add({ id: 'b', begin: D14 + 1, end: D14 + 2 * DAY + 2 })?.day).toBe('2023-11-15');
    expect(findings.list.map((f) => [f.id, f.severity, f.report])).toEqual([
      ['aggregate.report.long-range', 'info', 1],
    ]);
  });

  it('CMB-7: given a duplicate with a future end, when added, then it has no CMB-7 finding of its own', () => {
    const { add, ids } = setup();
    add({ begin: NOW + 3 * DAY, end: NOW + 4 * DAY });
    add({ begin: NOW + 3 * DAY, end: NOW + 4 * DAY });
    expect(ids()).toEqual(['aggregate.report.future', 'aggregate.report.duplicate']);
  });
});

describe('Batch: policies (CMB-8)', () => {
  const at = (n: number) => ({ begin: D14 + n * DAY, end: D14 + (n + 1) * DAY - 1 });

  it('CMB-8: given one configuration, when added, then it is listed with its values, reporters, and days', () => {
    const { add, batch } = setup();
    add({ id: 'a', ...at(0), policy: '<p>reject</p><sp>quarantine</sp><pct>50</pct>' });
    add({
      id: 'b',
      org: 'Other',
      ...at(2),
      policy: '<p>reject</p><sp>quarantine</sp><pct>50</pct>',
    });
    expect(batch.policies()).toEqual([
      {
        domain: 'example.com',
        p: 'reject',
        sp: 'quarantine',
        np: null,
        adkim: null,
        aspf: null,
        pct: 50,
        fo: null,
        testing: null,
        discoveryMethod: null,
        reporters: ['Example Receiver', 'Other'],
        reports: 2,
        firstDay: '2023-11-14',
        lastDay: '2023-11-16',
        inEffect: true,
      },
    ]);
  });

  it('CMB-8: given a domain with three configurations, when added, then policy.changed once, at the second', () => {
    const { add, findings } = setup();
    add({ id: 'a', ...at(0), policy: '<p>none</p>' });
    add({ id: 'b', ...at(1), policy: '<p>quarantine</p>' });
    add({ id: 'c', ...at(2), policy: '<p>reject</p>' });
    expect(findings.list.map((f) => [f.id, f.severity, f.report])).toEqual([
      ['aggregate.policy.changed', 'info', 1],
    ]);
  });

  it('CMB-8: given configurations, when listed, then the one with the latest day is in effect', () => {
    const { add, batch } = setup();
    add({ id: 'a', ...at(2), policy: '<p>none</p>' });
    add({ id: 'b', ...at(1), policy: '<p>reject</p>' });
    add({ id: 'c', begin: null, end: null, policy: '<p>quarantine</p>' });
    expect(batch.policies().map((c) => [c.p, c.inEffect])).toEqual([
      ['none', true],
      ['reject', false],
      ['quarantine', false],
    ]);
  });

  it('CMB-8: given a tie on the latest day, when listed, then more reports win, then the one seen first', () => {
    const { add, batch } = setup();
    add({ id: 'a', ...at(1), policy: '<p>none</p>' });
    add({ id: 'b', ...at(1), policy: '<p>reject</p>' });
    add({ id: 'c', ...at(0), policy: '<p>reject</p>' });
    expect(batch.policies().map((c) => [c.p, c.inEffect])).toEqual([
      ['none', false],
      ['reject', true],
    ]);
    const s2 = setup();
    s2.add({ id: 'a', ...at(1), policy: '<p>none</p>' });
    s2.add({ id: 'b', ...at(1), policy: '<p>reject</p>' });
    expect(s2.batch.policies().map((c) => c.inEffect)).toEqual([true, false]);
  });

  it('CMB-8: given only undated reports, when listed, then the first configuration is in effect', () => {
    const { add, batch } = setup();
    add({ id: 'a', begin: null, end: null, policy: '<p>none</p>' });
    add({ id: 'b', begin: null, end: null, policy: '<p>reject</p>' });
    expect(batch.policies().map((c) => [c.firstDay, c.inEffect])).toEqual([
      [null, true],
      [null, false],
    ]);
  });

  it('CMB-8: given reports that change the list and one that does not, when added, then the revision moves only on change', () => {
    const { add, batch } = setup();
    const r0 = batch.policyRevision;
    add({ id: 'a', ...at(0) });
    const r1 = batch.policyRevision;
    add({ id: 'a', ...at(0) });
    expect(batch.policyRevision).toBe(r1);
    add({ id: 'b', ...at(1) });
    expect([r1 > r0, batch.policyRevision > r1]).toEqual([true, true]);
  });
});

describe('Batch: reporter errors (CMB-13)', () => {
  it('CMB-13: given error texts in a counted report, when added, then one report.error each; none for a duplicate', () => {
    const { add, findings, batch } = setup();
    add({ errors: ['DNS timeout', 'Bad data'] });
    add({ errors: ['DNS timeout', 'Bad data'] });
    const listed = findings.list.filter((f) => f.id !== 'aggregate.format.mixed');
    expect(listed.map((f) => [f.id, f.severity, f.report])).toEqual([
      ['aggregate.report.error', 'info', 0],
      ['aggregate.report.error', 'info', 0],
      ['aggregate.report.duplicate', 'info', 1],
    ]);
    expect(listed[0]?.message).toContain('DNS timeout');
    expect(batch.classifications(0)).not.toBeNull();
  });
});

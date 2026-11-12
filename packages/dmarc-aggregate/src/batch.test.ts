import { describe, expect, it } from 'vitest';
import { Batch } from './batch.ts';
import { Findings } from './findings.ts';
import { type XmlDocument, XmlReader } from './xml/reader.ts';

interface Opts {
  org?: string;
  id?: string | null;
  domain?: string;
  begin?: number | null;
  end?: number | null;
  count?: number;
  /** Changes the bytes without changing the identity. */
  note?: string;
  /** Record elements; one passing record when omitted. */
  records?: string;
}

/** One record: policy_evaluated results and raw results. */
const rec = (o: {
  ip?: string;
  dkim?: string;
  spf?: string;
  rawDkim?: string;
  dkimDomain?: string;
  rawSpf?: string;
}) =>
  `<record><row><source_ip>${o.ip ?? '192.0.2.10'}</source_ip><count>1</count><policy_evaluated><disposition>none</disposition><dkim>${o.dkim ?? 'fail'}</dkim><spf>${o.spf ?? 'fail'}</spf></policy_evaluated></row><identifiers><header_from>example.com</header_from></identifiers><auth_results>${o.rawDkim ? `<dkim><domain>${o.dkimDomain ?? 'example.com'}</domain><selector>s</selector><result>${o.rawDkim}</result></dkim>` : ''}<spf><domain>example.com</domain><result>${o.rawSpf ?? 'fail'}</result></spf></auth_results></record>`;
/** DMARC pass by DKIM with raw SPF fail: PATH-3, which makes the IP a forwarder. */
const forwarded = (ip: string) => rec({ ip, dkim: 'pass', rawDkim: 'pass' });
/** DMARC fail with nothing else: CAUSE-9, or CAUSE-3 at a forwarder IP. */
const failing = (ip: string) => rec({ ip, rawDkim: 'fail', dkimDomain: 'x.example.net' });

const xml = (o: Opts = {}) => {
  const domain = o.domain ?? 'example.com';
  const id = o.id === undefined ? 'r-1' : o.id;
  const begin = o.begin === undefined ? 1_700_000_000 : o.begin;
  const end = o.end === undefined ? 1_700_086_399 : o.end;
  const range =
    begin === null || end === null
      ? ''
      : `<date_range><begin>${begin}</begin><end>${end}</end></date_range>`;
  const records =
    o.records ??
    `<record><row><source_ip>192.0.2.10</source_ip><count>${o.count ?? 3}</count><policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>pass</spf></policy_evaluated></row><identifiers><header_from>${domain}</header_from></identifiers><auth_results><spf><domain>${domain}</domain><result>pass</result></spf></auth_results></record>`;
  return `<feedback xmlns="urn:ietf:params:xml:ns:dmarc-2.0">${o.note ? `<!-- ${o.note} -->` : ''}<version>1.0</version><report_metadata><org_name>${o.org ?? 'Example Receiver'}</org_name><email>d@example.org</email>${id === null ? '' : `<report_id>${id}</report_id>`}${range}</report_metadata><policy_published><domain>${domain}</domain><p>none</p></policy_published>${records}</feedback>`;
};

const parse = (text: string | Uint8Array): XmlDocument => {
  const r = new XmlReader();
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const doc = [...r.push(bytes).documents, ...r.end().documents][0];
  if (!doc) throw new Error('no document');
  return doc;
};

function setup() {
  const findings = new Findings();
  const batch = new Batch(findings);
  let n = 0;
  const add = (o: Opts = {}, filename: string | null = null, file = 0) =>
    batch.addDocument({ label: `f${n++}.xml`, filename, document: parse(xml(o)) }, file);
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
    const text = xml().replace('<count>3</count>', '<count>x</count>');
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
    const bytes = new TextEncoder().encode(xml({ org: 'A__B' }));
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

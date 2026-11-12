import { describe, expect, it } from 'vitest';
import { batchOf, direct, failing, forwarded, on, rec } from './test/report-xml.ts';
import { type Filters, view } from './view.ts';

const ALL: Filters = { domain: null, reporters: null, days: null };
const rows = (...args: Parameters<typeof batchOf>) => view(batchOf(...args), ALL).sources;

describe('Sources: rows (SRC-1, SRC-2)', () => {
  it('SRC-1: given one IP in two reports and an invalid source, when viewed, then one row per IP and the invalid text as its own row', () => {
    const r = rows(
      { ...on(0), records: direct('192.0.2.1', 2) + rec({ ip: '999.1.1.1' }) },
      { ...on(1), records: direct('192.0.2.1', 3) },
    );
    expect(r.map((x) => [x.sourceIp, x.validIp, x.messages])).toEqual([
      ['999.1.1.1', false, 1],
      ['192.0.2.1', true, 5],
    ]);
  });

  it('SRC-2: given a source with passing and failing records, when viewed, then its row carries every SRC-2 number', () => {
    const r = rows(
      {
        ...on(0),
        records:
          rec({
            ip: '192.0.2.1',
            count: 2,
            rawSpf: 'pass',
            spfDomain: 'esp.example.net',
            disposition: 'quarantine',
          }) +
          rec({
            ip: '192.0.2.1',
            count: 1,
            rawDkim: 'pass',
            dkimDomain: 'esp.example.net',
            headerFrom: 'mail.example.com',
          }) +
          direct('192.0.2.1', 5),
      },
      { ...on(1), org: 'Other', records: direct('192.0.2.1', 1) },
    );
    expect(r).toHaveLength(1);
    const { details, ...row } = r[0] as (typeof r)[number];
    expect(row).toEqual({
      sourceIp: '192.0.2.1',
      validIp: true,
      messages: 9,
      failing: 3,
      byPath: { direct: 9, forwarded: 0, other: 0 },
      mainCause: 'spf-not-aligned',
      spf: [
        { domain: 'example.com', selector: null, result: 'pass', messages: 6 },
        { domain: 'esp.example.net', selector: null, result: 'pass', messages: 2 },
        { domain: 'example.com', selector: null, result: 'fail', messages: 1 },
      ],
      dkim: [{ domain: 'esp.example.net', selector: 's', result: 'pass', messages: 1 }],
      alignedSpf: 6,
      alignedDkim: 0,
      byDisposition: [
        { disposition: 'quarantine', messages: 2 },
        { disposition: 'none', messages: 7 },
      ],
      authorDomains: ['example.com', 'mail.example.com'],
      reporters: ['Example Receiver', 'Other'],
    });
    expect(details).toHaveLength(3);
  });

  it('SRC-2: given a tie between two causes, when viewed, then the main cause is the one listed first', () => {
    const r = rows({
      ...on(0),
      records:
        failing('192.0.2.1', 2) +
        rec({ ip: '192.0.2.1', count: 2, rawSpf: 'pass', spfDomain: 'esp.example.net' }),
    });
    expect(r[0]?.mainCause).toBe('spf-not-aligned');
  });
});

describe('Sources: order (SRC-3)', () => {
  it('SRC-3: given rows, when viewed, then by failing, then messages, then IPv4, IPv6, and invalid text in numeric order', () => {
    const r = rows({
      ...on(0),
      records:
        direct('192.0.2.10', 1) +
        direct('192.0.2.9', 1) +
        direct('2001:db8::1', 1) +
        rec({ ip: 'bad', count: 1, spf: 'pass', rawSpf: 'pass' }) +
        direct('10.0.0.1', 1) +
        direct('192.0.2.200', 5) +
        failing('203.0.113.1', 1),
    });
    expect(r.map((x) => x.sourceIp)).toEqual([
      '203.0.113.1',
      '192.0.2.200',
      '10.0.0.1',
      '192.0.2.9',
      '192.0.2.10',
      '2001:db8::1',
      'bad',
    ]);
  });
});

describe('Sources: detail rows (SRC-4)', () => {
  it('SRC-4: given the same combination in two reports, when viewed, then one detail row with summed messages and both reporters', () => {
    const r = rows(
      {
        ...on(0),
        records: direct('192.0.2.1', 2) + rec({ ip: '192.0.2.1', count: 5, disposition: 'reject' }),
      },
      { ...on(1), org: 'Other', records: direct('192.0.2.1', 4) },
    );
    expect(
      r[0]?.details.map((d) => [
        d.messages,
        d.disposition,
        d.reporters,
        d.classification.path,
        d.alignedSpf,
      ]),
    ).toEqual([
      [6, 'none', ['Example Receiver', 'Other'], 'direct', 'pass'],
      [5, 'reject', ['Example Receiver'], 'other', 'fail'],
    ]);
  });

  it('SRC-4: given records that differ in envelope sender or override type, when viewed, then separate detail rows with their fields', () => {
    const r = rows({
      ...on(0),
      records:
        rec({ ip: '192.0.2.1', envelopeFrom: 'a.example.com', reasons: ['local_policy'] }) +
        rec({ ip: '192.0.2.1', envelopeFrom: 'b.example.com', reasons: ['local_policy'] }) +
        rec({ ip: '192.0.2.1', envelopeFrom: 'b.example.com' }),
    });
    expect(r[0]?.details.map((d) => [d.envelopeFrom, d.reasons])).toEqual([
      ['a.example.com', ['local_policy']],
      ['b.example.com', ['local_policy']],
      ['b.example.com', []],
    ]);
    expect(r[0]?.details[0]).toMatchObject({
      headerFrom: 'example.com',
      spf: { domain: 'example.com', result: 'fail' },
      dkim: [],
      alignedDkim: 'fail',
    });
  });
});

describe('Sources: focus (SRC-5)', () => {
  const b = () =>
    batchOf(
      {
        ...on(0),
        records: failing('192.0.2.8') + forwarded('192.0.2.8', 3) + direct('192.0.2.1', 4),
      },
      { ...on(1), records: failing('192.0.2.9', 2) },
    );

  it('SRC-5: given a path focus, when viewed, then only records on that path count, and rows without them go', () => {
    const r = view(b(), ALL, { path: 'forwarded' }).sources;
    expect(r.map((x) => [x.sourceIp, x.messages, x.failing])).toEqual([['192.0.2.8', 4, 1]]);
    expect(r[0]?.details.map((d) => d.messages)).toEqual([3, 1]);
  });

  it('SRC-5: given a cause focus, when viewed, then only records with that cause count', () => {
    const r = view(b(), ALL, { cause: 'unauthenticated' }).sources;
    expect(r.map((x) => [x.sourceIp, x.messages])).toEqual([['192.0.2.9', 2]]);
  });

  it('SRC-5: given a focus, when viewed, then totals are not filtered by it', () => {
    expect(view(b(), ALL, { path: 'forwarded' }).totals.messages).toBe(10);
  });
});

import { describe, expect, it } from 'vitest';
import { Batch } from './batch.ts';
import { Findings } from './findings.ts';
import {
  batchOf,
  D14,
  DAY,
  direct,
  failing,
  forwarded,
  NOW,
  on,
  parse,
  type ReportOpts,
  rec,
  reportXml,
} from './test/report-xml.ts';
import { type Filters, view } from './view.ts';

const ALL: Filters = { domain: null, reporters: null, days: null };
const domains = (...args: Parameters<typeof batchOf>) => view(batchOf(...args), ALL).domains;
const one = (...args: Parameters<typeof batchOf>) =>
  domains(...args)[0] as ReturnType<typeof domains>[number];
/** Failing on the direct path: raw SPF pass for an unaligned domain (CAUSE-4). */
const unaligned = (ip: string, count = 1, disposition = 'none') =>
  rec({ ip, count, rawSpf: 'pass', spfDomain: 'esp.example.net', disposition });
/** DMARC pass by DKIM only, with raw SPF pass for another domain: PATH-4. */
const dkimOnly = (ip: string, count = 1) =>
  rec({ ip, count, dkim: 'pass', rawDkim: 'pass', rawSpf: 'pass', spfDomain: 'esp.example.net' });

describe('Enforcement: policy and failing mail (ENF-1..3)', () => {
  it('ENF-1: given two configurations, when viewed, then each domain shows the one in effect, and its period', () => {
    const d = domains(
      { ...on(0), policy: '<p>none</p>' },
      { ...on(1), policy: '<p>reject</p><sp>quarantine</sp><pct>50</pct>' },
      { ...on(2), domain: 'example.net', policy: '<p>quarantine</p><testing>y</testing>' },
    );
    expect(d.map((x) => [x.domain, x.policy, x.period])).toEqual([
      [
        'example.com',
        { p: 'reject', sp: 'quarantine', np: null, testing: null, pct: 50 },
        { begin: D14, end: D14 + 2 * DAY - 1 },
      ],
      [
        'example.net',
        { p: 'quarantine', sp: null, np: null, testing: 'y', pct: null },
        { begin: D14 + 2 * DAY, end: D14 + 3 * DAY - 1 },
      ],
    ]);
  });

  it('ENF-1: given an undated report with begin and end (end before begin), when viewed, then the period leaves it out', () => {
    const d = one({ ...on(0) }, { begin: D14 + 10 * DAY, end: D14 + 9 * DAY });
    expect(d.period).toEqual({ begin: D14, end: D14 + DAY - 1 });
  });

  it('ENF-3: given failing mail on each path, when viewed, then acted on and not yet acted on, with the share of the path', () => {
    const d = one({
      ...on(0),
      records:
        direct('192.0.2.1', 6) +
        unaligned('192.0.2.2', 1, 'quarantine') +
        unaligned('192.0.2.3', 1) +
        forwarded('192.0.2.4', 3) +
        failing('192.0.2.4', 1, 'pass') +
        failing('192.0.2.5', 2, 'reject'),
    });
    expect(d.failing).toEqual([
      { path: 'direct', acted: 1, notActed: 1, share: 2 / 8 },
      { path: 'forwarded', acted: 0, notActed: 1, share: 1 / 4 },
      { path: 'other', acted: 2, notActed: 0, share: 1 },
    ]);
  });

  it('ENF-3: given a path with no messages, when viewed, then its share is null', () => {
    expect(one({ ...on(0), records: direct('192.0.2.1') }).failing[1]).toEqual({
      path: 'forwarded',
      acted: 0,
      notActed: 0,
      share: null,
    });
  });
});

describe('Enforcement: sources, SPF-only, overrides (ENF-4..6)', () => {
  it('ENF-4: given failing direct sources, when viewed, then each with messages, cause, and SPF and DKIM domains, most first', () => {
    const d = one({
      ...on(0),
      records:
        unaligned('192.0.2.2', 1) +
        unaligned('192.0.2.3', 4) +
        rec({ ip: '192.0.2.3', rawDkim: 'pass', dkimDomain: 'esp.example.net' }) +
        failing('192.0.2.9', 9),
    });
    expect(d.directSources).toEqual([
      {
        sourceIp: '192.0.2.3',
        messages: 5,
        cause: 'spf-not-aligned',
        spfDomains: ['esp.example.net', 'example.com'],
        dkimDomains: ['esp.example.net'],
      },
      {
        sourceIp: '192.0.2.2',
        messages: 1,
        cause: 'spf-not-aligned',
        spfDomains: ['esp.example.net'],
        dkimDomains: [],
      },
    ]);
  });

  it('ENF-5: given passing mail aligned by SPF only, when viewed, then its messages, share of passing, and sources', () => {
    const d = one({
      ...on(0),
      records:
        direct('192.0.2.1', 3) +
        direct('192.0.2.2', 1) +
        dkimOnly('192.0.2.3', 4) +
        failing('192.0.2.9', 5),
    });
    expect(d.spfOnly).toEqual({
      messages: 4,
      share: 0.5,
      sources: [
        { sourceIp: '192.0.2.1', messages: 3 },
        { sourceIp: '192.0.2.2', messages: 1 },
      ],
    });
  });

  it('ENF-6: given failing mail with a disposition weaker than its report policy, when viewed, then grouped by override type or no reason', () => {
    const d = one({
      ...on(0),
      policy: '<p>reject</p><sp>none</sp>',
      records:
        rec({ ip: '192.0.2.1', count: 2, reasons: ['local_policy', 'mailing_list'] }) +
        rec({ ip: '192.0.2.2', count: 3, disposition: 'quarantine' }) +
        rec({ ip: '192.0.2.3', count: 4, disposition: 'reject' }) +
        rec({ ip: '192.0.2.4', count: 5, headerFrom: 'sub.example.com' }),
    });
    expect(d.overrides).toEqual([
      { type: 'local_policy', messages: 2 },
      { type: 'mailing_list', messages: 2 },
      { type: null, messages: 3 },
    ]);
  });

  it('ENF-2: given a subdomain author and no sp, when viewed, then p applies to it', () => {
    const d = one({
      ...on(0),
      policy: '<p>quarantine</p>',
      records: rec({ ip: '192.0.2.4', count: 5, headerFrom: 'sub.example.com' }),
    });
    expect(d.overrides).toEqual([{ type: null, messages: 5 }]);
  });

  it('ENF-6: given a weaker disposition without a reason, when counted, then one no-reason finding per record; none for a policy not stated', () => {
    const findings = new Findings();
    const b = new Batch(findings, { now: () => NOW });
    const add = (o: ReportOpts, i: number) =>
      b.addDocument({ label: `r${i}`, filename: null, document: parse(reportXml(o)) }, 0);
    add(
      {
        id: 'a',
        ...on(0),
        policy: '<p>reject</p>',
        records:
          rec({ ip: '192.0.2.1', disposition: 'quarantine' }) +
          rec({ ip: '192.0.2.2', reasons: ['forwarded'] }),
      },
      0,
    );
    add({ id: 'b', ...on(1), policy: '<sp>reject</sp>', records: rec({ ip: '192.0.2.3' }) }, 1);
    const hits = findings.list.filter((f) => f.id === 'aggregate.record.no-reason');
    expect(hits.map((f) => [f.report, f.record, f.severity])).toEqual([[0, 0, 'info']]);
  });
});

describe('Enforcement: status (ENF-7)', () => {
  it.each([
    [
      'clear',
      rec({ spf: 'pass', dkim: 'pass', rawSpf: 'pass', rawDkim: 'pass' }) + failing('192.0.2.9'),
    ],
    ['check-forwarded', failing('192.0.2.8') + forwarded('192.0.2.8')],
    ['add-dkim', direct('192.0.2.1') + forwarded('192.0.2.8') + failing('192.0.2.8')],
    ['fix-direct', unaligned('192.0.2.2') + direct('192.0.2.1')],
    ['no-data', rec({ count: 0 })],
  ])('ENF-7: given mail for %s, when viewed, then that status', (status, records) => {
    expect(one({ ...on(0), records }).status).toBe(status);
  });
});

import { describe, expect, it } from 'vitest';
import { XmlReader } from '../xml/reader.ts';
import { type ReadReport, readReport } from './read.ts';

const BIS = 'urn:ietf:params:xml:ns:dmarc-2.0';
const OLD = 'http://dmarc.org/dmarc-xml/0.1';

/** Parses XML text into one document and reads it as a report. */
function read(xml: string) {
  const reader = new XmlReader();
  const docs = [...reader.push(new TextEncoder().encode(xml)).documents, ...reader.end().documents];
  const doc = docs[0];
  if (!doc) throw new Error('no document');
  return readReport(doc);
}
const report = (xml: string) => read(xml).report as ReadReport;
const ids = (r: ReadReport) => r.findings.map((f) => f.id);

const META = `<report_metadata><org_name>Example Receiver</org_name><email>dmarc@example.org</email>
  <report_id>r-1</report_id><date_range><begin>1700000000</begin><end>1700086399</end></date_range></report_metadata>`;
const POLICY_BIS = '<policy_published><domain>example.com</domain><p>reject</p></policy_published>';
const POLICY_OLD =
  '<policy_published><domain>example.com</domain><p>none</p><sp>none</sp><pct>100</pct><fo>0</fo></policy_published>';
const row = (extra = '') => `<row><source_ip>192.0.2.10</source_ip><count>3</count>
  <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>fail</spf>${extra}</policy_evaluated></row>`;
const IDS =
  '<identifiers><header_from>example.com</header_from><envelope_from>example.com</envelope_from></identifiers>';
const AUTH = `<auth_results><dkim><domain>example.com</domain><selector>s1</selector><result>pass</result></dkim>
  <spf><domain>example.com</domain><scope>mfrom</scope><result>fail</result></spf></auth_results>`;
const record = (r = row(), a = AUTH) => `<record>${r}${IDS}${a}</record>`;
const bis = (body: string, attrs = '') =>
  `<feedback xmlns="${BIS}"${attrs}><version>1.0</version>${META}${POLICY_BIS}${body}</feedback>`;
const old = (body: string, policy = POLICY_OLD) =>
  `<feedback xmlns="${OLD}"><version>1.0</version>${META}${policy}${body}</feedback>`;

describe('Format: namespace (FMT-1..3)', () => {
  it('FMT-1: given a root that is not feedback, when read, then not-feedback and no report', () => {
    const r = read('<report/>');
    expect(r.report).toBeNull();
    expect(r.finding).toMatchObject({ id: 'aggregate.format.not-feedback', severity: 'error' });
  });

  it('FMT-2: given the RFC 9990 namespace, when read, then format rfc9990 with the URI and prefix kept', () => {
    const r = report(
      `<d:feedback xmlns:d="${BIS}"><d:version>1.0</d:version>${META.replace(/<(\/?)/g, '<$1d:')}${POLICY_BIS.replace(/<(\/?)/g, '<$1d:')}${record().replace(/<(\/?)/g, '<$1d:')}</d:feedback>`,
    );
    expect([r.format, r.namespace, r.prefix]).toEqual(['rfc9990', BIS, 'd']);
    expect(ids(r)).toEqual([]);
  });

  it('FMT-2: given the RFC 7489 namespace, when read, then format rfc7489', () => {
    expect(report(old(record())).format).toBe('rfc7489');
  });

  it('FMT-2: given no namespace, when read, then format rfc7489 with namespace null', () => {
    const r = report(old(record()).replace(` xmlns="${OLD}"`, ''));
    expect([r.format, r.namespace]).toEqual(['rfc7489', null]);
  });

  it('FMT-2: given another namespace, when read, then format unknown and unknown-namespace', () => {
    const r = report(bis(record()).replace(BIS, 'urn:example:other'));
    expect(r.format).toBe('unknown');
    expect(ids(r)).toContain('aggregate.format.unknown-namespace');
  });

  it('FMT-3: given an unknown report, when read, then the RFC 9990 multiplicities apply', () => {
    // sp and pct are required in RFC 7489 only, so an unknown report without them has no missing finding.
    const r = report(bis(record()).replace(BIS, 'urn:example:other'));
    expect(ids(r)).not.toContain('aggregate.schema.missing');
  });
});

describe('Format: elements (FMT-4..9)', () => {
  it('FMT-4: given qualified and unqualified children, when read, then both are report elements', () => {
    const r = report(
      `<feedback xmlns="${BIS}"><version xmlns="">1.0</version>${META}${POLICY_BIS}${record()}</feedback>`,
    );
    expect(r.version).toBe('1.0');
  });

  it('FMT-5: given extension elements in extension and at record level, when read, then they are counted per namespace and position', () => {
    const r = report(
      bis(
        `<extension><x:a xmlns:x="urn:x"/><x:b xmlns:x="urn:x"/></extension>${record().replace('</record>', '<y:z xmlns:y="urn:y"/></record>')}`,
      ),
    );
    expect(r.extensions).toEqual(
      expect.arrayContaining([
        { namespace: 'urn:x', position: 'extension', count: 2 },
        { namespace: 'urn:y', position: 'record', count: 1 },
      ]),
    );
  });

  it('FMT-6: given an unknown report element, when read, then unknown-element with its path, and it is ignored', () => {
    const r = report(bis(`${record()}<surprise/>`));
    expect(r.findings).toContainEqual(
      expect.objectContaining({ id: 'aggregate.schema.unknown-element', path: 'surprise' }),
    );
  });

  it('FMT-7: given elements in another order, when read, then they are found by name', () => {
    const r = report(
      `<feedback xmlns="${BIS}">${record()}${POLICY_BIS}${META}<version>1.0</version></feedback>`,
    );
    expect([r.reporter, r.policy.domain, r.records.length]).toEqual([
      'Example Receiver',
      'example.com',
      1,
    ]);
  });

  it('FMT-8: given a missing required element of the declared format, when read, then schema.missing with its path', () => {
    const r = report(bis(record()).replace('<email>dmarc@example.org</email>', ''));
    expect(r.findings).toContainEqual(
      expect.objectContaining({ id: 'aggregate.schema.missing', path: 'report_metadata/email' }),
    );
  });

  it('FMT-8: given dkim/selector missing in RFC 7489 and RFC 9990, when read, then missing only for RFC 9990', () => {
    const noSelector = AUTH.replace('<selector>s1</selector>', '');
    expect(ids(report(old(record(row(), noSelector))))).not.toContain('aggregate.schema.missing');
    expect(report(bis(record(row(), noSelector))).findings).toContainEqual(
      expect.objectContaining({ path: 'record/auth_results/dkim/selector' }),
    );
  });

  it('FMT-9: given a repeated single element, when read, then repeated and the first is used', () => {
    const r = report(
      bis(record()).replace(
        '<org_name>Example Receiver</org_name>',
        '<org_name>A</org_name><org_name>B</org_name>',
      ),
    );
    expect(r.reporter).toBe('A');
    expect(ids(r)).toContain('aggregate.schema.repeated');
  });

  it('FMT-9: given several RFC 7489 auth_results/spf, when read, then the first mfrom is used and all are kept', () => {
    const auth = `<auth_results><spf><domain>mx.example.com</domain><scope>helo</scope><result>pass</result></spf>
      <spf><domain>example.com</domain><scope>mfrom</scope><result>fail</result></spf></auth_results>`;
    const spf = report(old(record(row(), auth))).records[0]?.spfResults;
    expect(spf?.map((s) => [s.scope, s.used])).toEqual([
      ['helo', false],
      ['mfrom', true],
    ]);
  });

  it('FMT-9: given several error elements, when read, then all are kept', () => {
    const r = report(
      old(record()).replace('</date_range>', '</date_range><error>e1</error><error>e2</error>'),
    );
    expect(r.errors).toEqual(['e1', 'e2']);
    expect(ids(r)).not.toContain('aggregate.schema.repeated');
  });
});

describe('Format: values (FMT-10..15, FMT-18)', () => {
  it('FMT-10: given enumerated values in mixed case with padding, when read, then lowercase and trimmed', () => {
    expect(report(bis(record()).replace('<p>reject</p>', '<p> Reject </p>')).policy.p).toBe(
      'reject',
    );
  });

  it('FMT-10: given a value in neither schema, when read, then value.unknown and it is kept as written', () => {
    const r = report(bis(record()).replace('<p>reject</p>', '<p>Maybe</p>'));
    expect(r.policy.p).toBe('Maybe');
    expect(ids(r)).toContain('aggregate.value.unknown');
  });

  it('FMT-11: given text over 4 096 characters, when read, then it is cut and marked truncated', () => {
    const r = report(bis(record()).replace('Example Receiver', 'x'.repeat(5000)));
    expect(r.reporter.length).toBe(4096);
    expect(r.truncated).toEqual([{ path: 'report_metadata/org_name' }]);
  });

  it('FMT-12: given IPv4, IPv6, and IPv4-mapped source_ip, when read, then normalized; anything else value.invalid', () => {
    const ip = (v: string) => report(bis(record(row().replace('192.0.2.10', v)))).records[0];
    expect(ip('2001:0DB8::0001')?.sourceIp).toBe('2001:db8::1');
    expect(ip('::ffff:192.0.2.7')?.sourceIp).toBe('192.0.2.7');
    expect(ip('[192.0.2.1]')).toMatchObject({ sourceIp: '[192.0.2.1]', validIp: false });
    expect(ids(report(bis(record(row().replace('192.0.2.10', 'mail.example')))))).toContain(
      'aggregate.value.invalid',
    );
  });

  it('FMT-13: given out-of-range dates and a pct over 100, when read, then value.invalid and treated as missing', () => {
    const r = report(
      old(record(), POLICY_OLD.replace('<pct>100</pct>', '<pct>150</pct>')).replace(
        '1700000000',
        '-5',
      ),
    );
    expect([r.begin, r.policy.pct]).toEqual([null, null]);
    expect(ids(r).filter((i) => i === 'aggregate.value.invalid').length).toBe(2);
  });

  it('FMT-13: given version 1, 1.00, and 2, when read, then only 2 gives format.version', () => {
    const v = (x: string) =>
      ids(report(bis(record()).replace('<version>1.0</version>', `<version>${x}</version>`)));
    expect(v('1')).not.toContain('aggregate.format.version');
    expect(v('1.00')).not.toContain('aggregate.format.version');
    expect(v('2')).toContain('aggregate.format.version');
  });

  it('FMT-14: given domains with padding, a trailing dot, and capitals, when read, then normalized', () => {
    expect(
      report(
        bis(record()).replace(
          '<domain>example.com</domain><p>',
          '<domain> Example.COM. </domain><p>',
        ),
      ).policy.domain,
    ).toBe('example.com');
  });

  it('FMT-15: given SPF results unknown and error, when read, then temperror and permerror with value.legacy', () => {
    const r = report(
      old(record(row(), AUTH.replace('<result>fail</result>', '<result>Unknown</result>'))),
    );
    expect(r.records[0]?.spfResults[0]).toMatchObject({ result: 'temperror', original: 'Unknown' });
    expect(ids(r)).toContain('aggregate.value.legacy');
  });

  it('FMT-18: given a record without source_ip, count, or policy_evaluated, when read, then skipped once with no missing findings for them', () => {
    const bare = '<row><policy_evaluated><disposition>none</disposition></policy_evaluated></row>';
    const r = report(bis(record(bare)));
    expect(r.records).toEqual([]);
    expect(r.findings.filter((f) => f.id === 'aggregate.record.skipped')).toHaveLength(1);
    expect(r.findings.filter((f) => f.id === 'aggregate.schema.missing')).toEqual([]);
  });

  it('FMT-18: given a negative count, when read, then the record is skipped without value.invalid', () => {
    const r = report(bis(record(row().replace('<count>3</count>', '<count>-1</count>'))));
    expect(r.records).toEqual([]);
    expect(ids(r)).not.toContain('aggregate.value.invalid');
  });

  it('FMT-18: given an unknown policy_evaluated/dkim value, when read, then the record is kept', () => {
    const r = report(bis(record(row().replace('<dkim>pass</dkim>', '<dkim>maybe</dkim>'))));
    expect(r.records).toHaveLength(1);
  });
});

describe('Format: content hints (FMT-16, FMT-17)', () => {
  it('FMT-16: given RFC 9990-only content, when read, then each hint is listed with its paths', () => {
    const r = report(
      bis(record()).replace('<p>reject</p>', '<p>reject</p><np>reject</np><testing>y</testing>'),
    );
    expect(r.hints).toEqual(
      expect.arrayContaining([
        { format: 'rfc9990', hint: 'np', paths: ['policy_published/np'] },
        { format: 'rfc9990', hint: 'testing', paths: ['policy_published/testing'] },
      ]),
    );
  });

  it('FMT-16: given RFC 7489-only content, when read, then each hint is listed with its paths', () => {
    const r = report(old(record(row('<reason><type>forwarded</type></reason>'))));
    expect(r.hints.map((h) => h.hint)).toEqual(expect.arrayContaining(['pct', 'forwarded']));
  });

  it('FMT-17: given an rfc9990 report with RFC 7489 hints, when read, then format.mixed and the declared format stays', () => {
    const r = report(bis(record()).replace('<p>reject</p>', '<p>reject</p><pct>50</pct>'));
    expect(r.format).toBe('rfc9990');
    expect(ids(r)).toContain('aggregate.format.mixed');
  });

  it('FMT-17: given an unknown report with hints, when read, then hints without format.mixed', () => {
    const r = report(
      bis(record())
        .replace(BIS, 'urn:example:other')
        .replace('<p>reject</p>', '<p>reject</p><pct>50</pct>'),
    );
    expect(r.hints.length).toBeGreaterThan(0);
    expect(ids(r)).not.toContain('aggregate.format.mixed');
  });
});

describe('Format: review cases', () => {
  it('FMT-9: given a repeated policy_evaluated/dkim, when read, then one repeated finding', () => {
    const r = report(
      bis(record(row().replace('<dkim>pass</dkim>', '<dkim>pass</dkim><dkim>fail</dkim>'))),
    );
    expect(r.findings.filter((f) => f.id === 'aggregate.schema.repeated')).toHaveLength(1);
  });

  it('FMT-9: given two spf results in an RFC 9990 report, when read, then repeated and the first is used', () => {
    const auth = `<auth_results><spf><domain>a.example</domain><result>pass</result></spf>
      <spf><domain>b.example</domain><scope>mfrom</scope><result>fail</result></spf></auth_results>`;
    const r = report(bis(record(row(), auth)));
    expect(r.records[0]?.spfResults.map((s) => s.used)).toEqual([true, false]);
    expect(ids(r)).toContain('aggregate.schema.repeated');
  });

  it('FMT-5: given extension namespaces that differ after a space, when read, then they are counted apart', () => {
    const r = report(
      bis(`<extension><x:a xmlns:x="urn:a b"/><y:a xmlns:y="urn:a c"/></extension>${record()}`),
    );
    expect(r.extensions.map((e) => e.namespace).sort()).toEqual(['urn:a b', 'urn:a c']);
  });

  it('FMT-11: given a domain over 4 096 characters in a record, when read, then it is cut with its record index', () => {
    const r = report(
      bis(
        record(row(), AUTH).replace('<header_from>example.com', `<header_from>${'a'.repeat(5000)}`),
      ),
    );
    expect(r.records[0]?.headerFrom?.length).toBe(4096);
    expect(r.truncated).toEqual([{ path: 'record/identifiers/header_from', record: 0 }]);
  });
});

describe('Format: whole reports', () => {
  it('given a full RFC 9990 report, when read, then every field is read without findings', () => {
    const r = report(bis(record()));
    expect(ids(r)).toEqual([]);
    expect(r).toMatchObject({
      reporter: 'Example Receiver',
      reportId: 'r-1',
      begin: 1700000000,
      end: 1700086399,
    });
    expect(r.records[0]).toMatchObject({
      sourceIp: '192.0.2.10',
      count: 3,
      disposition: 'none',
      dkim: 'pass',
      spf: 'fail',
      headerFrom: 'example.com',
    });
  });

  it('given a full RFC 7489 report, when read, then every field is read without findings', () => {
    const r = report(old(record()));
    expect(ids(r)).toEqual([]);
    expect(r.policy).toMatchObject({ p: 'none', sp: 'none', pct: 100, fo: '0' });
  });

  it('given mutated reports, when read, then it never throws', () => {
    const base = bis(record() + record());
    let seed = 5;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed >> 4;
    };
    for (let n = 0; n < 300; n++) {
      const chars = [...base];
      for (let k = 0; k < 4; k++) chars.splice(rand() % chars.length, rand() % 3);
      const reader = new XmlReader();
      const docs = [
        ...reader.push(new TextEncoder().encode(chars.join(''))).documents,
        ...reader.end().documents,
      ];
      for (const d of docs) expect(() => readReport(d)).not.toThrow();
    }
  });
});

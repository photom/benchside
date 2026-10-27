import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FINDINGS, FindingList } from './findings.ts';

/** Rows of the findings table in docs/reference/pdf/report.md. */
function documented() {
  const page = readFileSync('docs/reference/pdf/report.md', 'utf8');
  return page
    .slice(page.indexOf('## Findings'))
    .split('\n')
    .filter((l) => l.startsWith('| `'))
    .map((l) => {
      const [id, severity, , clause] = l
        .slice(2, -2)
        .split(' | ')
        .map((c) => c.trim());
      return [id?.replaceAll('`', ''), severity, clause === '—' ? undefined : clause];
    });
}

describe('findings', () => {
  it('REP-6: the findings table in report.md matches the code', () => {
    const code = Object.entries(FINDINGS).map(([id, f]) => [id, f.severity, f.clause]);
    expect(code).toEqual(documented());
  });

  it('REP-6: given a finding, when added, then it carries its severity, clause, and location', () => {
    const list = new FindingList();
    list.add('pdf.object.header-mismatch', 'Not here.', { offset: 30, object: 4 });
    expect(list.list).toEqual([
      {
        id: 'pdf.object.header-mismatch',
        severity: 'error',
        message: 'Not here.',
        clause: '7.3.10',
        offset: 30,
        object: 4,
      },
    ]);
  });

  it('REP-7: given more findings than the limit, when added, then one too-many-findings ends the list', () => {
    const list = new FindingList(2);
    for (let i = 0; i < 5; i++) list.add('pdf.gap', `Gap ${i}`);
    expect(list.list.map((f) => f.id)).toEqual(['pdf.gap', 'pdf.gap', 'pdf.too-many-findings']);
  });
});

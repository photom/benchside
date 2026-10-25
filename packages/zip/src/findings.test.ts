import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FINDINGS, FindingList } from './findings.ts';

/** Rows of the findings table in docs/reference/zip/report.md. */
function documented() {
  const page = readFileSync('docs/reference/zip/report.md', 'utf8');
  const rows = page.slice(page.indexOf('## Findings')).split('\n');
  return rows
    .filter((l) => l.startsWith('| `'))
    .map((l) => {
      const [id, severity, , section] = l
        .slice(2, -2)
        .split(' | ')
        .map((c) => c.trim());
      return [id?.replaceAll('`', ''), severity, section === '—' ? undefined : section];
    });
}

describe('findings', () => {
  it('REP-7: the findings table in report.md matches the code', () => {
    const code = Object.entries(FINDINGS).map(([id, f]) => [id, f.severity, f.section]);
    expect(code).toEqual(documented());
  });

  it('REP-7: given a finding, when added, then it carries its severity, section, and location', () => {
    const list = new FindingList();
    list.add('zip.local.mismatch', 'Differs.', { offset: 30, entry: 1 });
    expect(list.list).toEqual([
      {
        id: 'zip.local.mismatch',
        severity: 'warning',
        message: 'Differs.',
        section: '4.3.2',
        offset: 30,
        entry: 1,
      },
    ]);
  });

  it('REP-8: given more findings than the limit, when added, then one too-many-findings ends the list', () => {
    const list = new FindingList(3);
    for (let i = 0; i < 10; i++) list.add('zip.gap', `Gap ${i}`);
    expect(list.list.map((f) => f.id)).toEqual([
      'zip.gap',
      'zip.gap',
      'zip.gap',
      'zip.too-many-findings',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { type Finding, Findings } from './findings.ts';

const f = (n: number, file: number | null = 0): Finding => ({
  id: 'aggregate.zip.crc',
  severity: 'warning',
  message: `m${n}`,
  file,
  label: file === null ? null : `f${file}`,
});

describe('Findings (REP-7, REP-8)', () => {
  it('REP-8: given findings, when added, then they keep the order found', () => {
    const c = new Findings();
    for (const n of [3, 1, 2]) c.add(f(n));
    expect(c.list.map((x) => x.message)).toEqual(['m3', 'm1', 'm2']);
  });

  it('REP-8: given more findings than the limit, when added, then one too-many-findings follows the limit and later ones are dropped', () => {
    const c = new Findings(3);
    for (let n = 0; n < 6; n++) c.add(f(n));
    expect(c.list.map((x) => (x.message.startsWith('m') ? x.message : x.id))).toEqual([
      'm0',
      'm1',
      'm2',
      'aggregate.too-many-findings',
    ]);
    expect(c.list[3]).toMatchObject({ severity: 'warning', file: null, label: null });
  });

  it('REP-7: given findings for several files, when counted, then each file counts only its kept findings', () => {
    const c = new Findings(4);
    for (const file of [0, 1, 0, null, 1, 1]) c.add(f(0, file));
    expect([c.countFor(0), c.countFor(1), c.countFor(2)]).toEqual([2, 1, 0]);
  });
});

import { describe, expect, it } from 'vitest';
import type { ArcReport, ArcSetTrace } from '../arc/verify.ts';
import type { DkimSignatureResult } from '../dkim/verify.ts';
import { summarizeArc, summarizeDkim } from './summary.ts';

const sig = (result: DkimSignatureResult['result']): DkimSignatureResult => ({
  field: 0,
  result,
  findings: [],
  trace: { tags: [], selectedHeaders: [] },
});

describe('summary', () => {
  it('SUM-2: given no signatures, when summarized, then DKIM is none', () => {
    expect(summarizeDkim([])).toEqual({ method: 'dkim', result: 'none', counts: {} });
  });

  it('SUM-2: given pass and fail, when summarized, then pass wins and counts are per result', () => {
    expect(summarizeDkim([sig('fail'), sig('pass'), sig('fail')])).toEqual({
      method: 'dkim',
      result: 'pass',
      counts: { fail: 2, pass: 1 },
    });
  });

  it('SUM-2: given results without pass, when summarized, then precedence is fail > permerror > temperror > not-evaluated', () => {
    expect(summarizeDkim([sig('not-evaluated'), sig('temperror')]).result).toBe('temperror');
    expect(summarizeDkim([sig('temperror'), sig('permerror')]).result).toBe('permerror');
    expect(summarizeDkim([sig('permerror'), sig('fail')]).result).toBe('fail');
    expect(summarizeDkim([sig('not-evaluated')]).result).toBe('not-evaluated');
  });

  it('SUM-2: given fail before pass in the message, when summarized, then counts are listed in precedence order', () => {
    expect(
      Object.keys(summarizeDkim([sig('fail'), sig('not-evaluated'), sig('pass')]).counts),
    ).toEqual(['pass', 'fail', 'not-evaluated']);
  });

  it('SUM-2: given DKIM could not run, when summarized, then it is not-evaluated with the reason', () => {
    expect(summarizeDkim([], 'internal-error')).toEqual({
      method: 'dkim',
      result: 'not-evaluated',
      reason: 'internal-error',
      counts: {},
    });
  });
});

describe('summary: ARC', () => {
  const row = (instance: number): ArcSetTrace => ({ instance });
  const arc = (o: Partial<ArcReport>): ArcReport => ({
    result: 'pass',
    sets: [],
    findings: [],
    ...o,
  });

  it('SUM-5: given no ARC fields, when summarized, then ARC is none without counts', () => {
    expect(summarizeArc(arc({ result: 'none' }))).toEqual({
      method: 'arc',
      result: 'none',
      counts: {},
    });
  });

  it('SUM-5: given a chain, when summarized, then the chain result is shown with the number of sets', () => {
    expect(summarizeArc(arc({ sets: [row(1), row(2)] }))).toEqual({
      method: 'arc',
      result: 'pass',
      counts: { sets: 2 },
    });
  });

  it('SUM-5: given a not-evaluated chain, when summarized, then its reason is kept', () => {
    expect(
      summarizeArc(arc({ result: 'not-evaluated', reason: 'offline', sets: [row(1)] })),
    ).toEqual({ method: 'arc', result: 'not-evaluated', reason: 'offline', counts: { sets: 1 } });
  });
});

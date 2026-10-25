import { describe, expect, it } from 'vitest';
import type { ArcReport, ArcSetTrace } from '../arc/verify.ts';
import type { DkimSignatureResult } from '../dkim/verify.ts';
import type { DmarcModeResult } from '../dmarc/evaluate.ts';
import type { SpfIdentityResult } from '../spf/evaluate.ts';
import { summarizeArc, summarizeDkim, summarizeDmarc, summarizeSpf } from './summary.ts';

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

describe('summary: SPF', () => {
  const identity = (o: Partial<SpfIdentityResult>): SpfIdentityResult => ({
    result: 'pass',
    counters: { dnsTerms: 0, voids: 0 },
    findings: [],
    ...o,
  });

  it('SUM-1: given SPF results, when summarized, then the MAIL FROM result is the line', () => {
    expect(
      summarizeSpf({
        mailFrom: identity({ result: 'softfail' }),
        helo: identity({ result: 'pass' }),
      }),
    ).toEqual({ method: 'spf', result: 'softfail', counts: {} });
  });

  it('SUM-1: given a not-evaluated MAIL FROM, when summarized, then its reason is kept', () => {
    expect(
      summarizeSpf({
        mailFrom: identity({ result: 'not-evaluated', reason: 'offline' }),
        helo: identity({}),
      }),
    ).toEqual({ method: 'spf', result: 'not-evaluated', reason: 'offline', counts: {} });
  });
});

describe('summary: DMARC', () => {
  const mode = (o: Partial<DmarcModeResult>): DmarcModeResult => ({
    result: 'fail',
    testing: false,
    alignment: [],
    queryIds: [],
    findings: [],
    ...o,
  });

  it('SUM-4: given a fail with a disposition, when summarized, then the line has both', () => {
    expect(summarizeDmarc({ rfc9989: mode({ disposition: 'reject' }) })).toEqual([
      { method: 'dmarc', mode: 'rfc9989', result: 'fail', disposition: 'reject', counts: {} },
    ]);
  });

  it('SUM-4: given none, when summarized, then the line has no disposition', () => {
    expect(summarizeDmarc({ rfc9989: mode({ result: 'none' }) })).toEqual([
      { method: 'dmarc', mode: 'rfc9989', result: 'none', counts: {} },
    ]);
  });

  it('SUM-4: given both modes, when summarized, then one line each, RFC 9989 first', () => {
    const lines = summarizeDmarc({ rfc7489: mode({ result: 'pass' }), rfc9989: mode({}) });
    expect(lines.map((l) => [l.mode, l.result])).toEqual([
      ['rfc9989', 'fail'],
      ['rfc7489', 'pass'],
    ]);
  });
});

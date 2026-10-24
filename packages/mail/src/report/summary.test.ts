import { describe, expect, it } from 'vitest';
import type { DkimSignatureResult } from '../dkim/verify.ts';
import { summarizeDkim } from './summary.ts';

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

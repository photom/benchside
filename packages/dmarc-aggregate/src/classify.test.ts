import { describe, expect, it } from 'vitest';
import { classify, type Facts, inconsistent, recordFacts } from './classify.ts';
import type { DkimAuth, ReadRecord, SpfAuth } from './format/read.ts';

const dkim = (domain: string, result: string): DkimAuth => ({
  domain,
  selector: 's',
  result,
  humanResult: null,
});
const spf = (domain: string, result: string, used = true): SpfAuth => ({
  domain,
  scope: 'mfrom',
  result,
  original: result,
  humanResult: null,
  used,
});

const record = (o: Partial<ReadRecord> = {}): ReadRecord => ({
  index: 0,
  line: 1,
  sourceIp: '192.0.2.1',
  validIp: true,
  count: 1,
  disposition: 'none',
  dkim: 'fail',
  spf: 'fail',
  reasons: [],
  headerFrom: 'example.com',
  envelopeFrom: null,
  envelopeTo: null,
  dkimResults: [],
  spfResults: [],
  ...o,
});

const facts = (r: Partial<ReadRecord>, forwarder = false) =>
  recordFacts(record(r), 'example.com', () => forwarder);

const base: Facts = {
  dmarc: 'fail',
  dkim: {
    aligned: false,
    relatedPass: false,
    relatedFail: false,
    otherPass: false,
    temperror: false,
    permerror: false,
    none: false,
  },
  spf: { aligned: false, result: null, related: false },
  forwardingReason: false,
  forwarderIp: false,
};
const f = (o: {
  dmarc?: 'pass' | 'fail';
  dkim?: Partial<Facts['dkim']>;
  spf?: Partial<Facts['spf']>;
  forwardingReason?: boolean;
  forwarderIp?: boolean | null;
}): Facts => ({
  ...base,
  ...o,
  dkim: { ...base.dkim, ...o.dkim },
  spf: { ...base.spf, ...o.spf },
});

describe('Classification: facts (FCT-1..7)', () => {
  it('FCT-1: given policy_evaluated dkim or spf pass, when read, then DMARC pass; neither, then fail', () => {
    expect(facts({ dkim: 'pass' }).dmarc).toBe('pass');
    expect(facts({ spf: 'pass' }).dmarc).toBe('pass');
    expect(facts({}).dmarc).toBe('fail');
  });

  it('FCT-2: given DKIM domains equal to, under, or above the author or policy domain, when read, then related; by whole labels only', () => {
    const rel = (domain: string, headerFrom: string | null = 'example.com') =>
      recordFacts(
        record({ headerFrom, dkimResults: [dkim(domain, 'pass')] }),
        'example.org',
        () => false,
      ).dkim.relatedPass;
    expect(rel('example.com')).toBe(true);
    expect(rel('mail.example.com')).toBe(true);
    expect(rel('com', 'mail.example.com')).toBe(true);
    expect(rel('example.org', null)).toBe(true);
    expect(rel('sub.example.org')).toBe(true);
    expect(rel('badexample.com')).toBe(false);
    expect(rel('example.net')).toBe(false);
  });

  it('FCT-3: given DKIM results, when read, then related pass, related fail, other pass, temperror, and permerror', () => {
    const d = facts({
      dkimResults: [
        dkim('example.com', 'fail'),
        dkim('esp.example.net', 'pass'),
        dkim('x.example.net', 'temperror'),
        dkim('y.example.net', 'permerror'),
      ],
    }).dkim;
    expect(d).toEqual({
      aligned: false,
      relatedPass: false,
      relatedFail: true,
      otherPass: true,
      temperror: true,
      permerror: true,
      none: false,
    });
  });

  it('FCT-3: given no DKIM results or only none, when read, then DKIM none; aligned follows policy_evaluated', () => {
    expect(facts({}).dkim.none).toBe(true);
    expect(facts({ dkimResults: [dkim('example.com', 'none')] }).dkim.none).toBe(true);
    expect(facts({ dkim: 'pass', dkimResults: [dkim('example.com', 'pass')] }).dkim).toMatchObject({
      aligned: true,
      relatedPass: true,
      none: false,
    });
  });

  it('FCT-4: given several SPF results, when read, then the one chosen by FMT-9 gives the result and relation', () => {
    const s = facts({
      spf: 'pass',
      spfResults: [spf('other.net', 'fail', false), spf('bounce.example.com', 'pass')],
    }).spf;
    expect(s).toEqual({ aligned: true, result: 'pass', related: true });
  });

  it('FCT-4: given no SPF result, or a null reverse-path, when read, then absent or unrelated', () => {
    expect(facts({}).spf).toEqual({ aligned: false, result: null, related: false });
    expect(facts({ spfResults: [spf('', 'none')] }).spf).toEqual({
      aligned: false,
      result: 'none',
      related: false,
    });
  });

  it('FCT-5: given an override type forwarded, trusted_forwarder, or mailing_list, when read, then a forwarding reason; others not', () => {
    const reason = (type: string) =>
      facts({
        reasons: [
          { type: 'local_policy', comment: null },
          { type, comment: null },
        ],
      }).forwardingReason;
    expect(['forwarded', 'trusted_forwarder', 'mailing_list'].map(reason)).toEqual([
      true,
      true,
      true,
    ]);
    expect(reason('sampled_out')).toBe(false);
  });

  it('FCT-6: given aligned passes without a raw pass of that method, when checked, then each method is named', () => {
    expect(inconsistent(record({ dkim: 'pass', spf: 'pass' }))).toEqual(['dkim', 'spf']);
    expect(
      inconsistent(
        record({
          dkim: 'pass',
          spf: 'pass',
          dkimResults: [dkim('x.net', 'pass')],
          spfResults: [spf('y.net', 'fail', false), spf('example.com', 'pass')],
        }),
      ),
    ).toEqual([]);
    expect(inconsistent(record({}))).toEqual([]);
  });

  it('FCT-7: given a failing record, when read, then forwarderIp asks the batch; for a passing record it is null', () => {
    expect(facts({}, true).forwarderIp).toBe(true);
    expect(facts({}, false).forwarderIp).toBe(false);
    expect(facts({ dkim: 'pass' }, true).forwarderIp).toBeNull();
  });
});

describe('Classification: delivery path (PATH-1..5)', () => {
  it('PATH-1: given DMARC pass and SPF aligned, when classified, then direct', () => {
    const c = classify(
      f({ dmarc: 'pass', spf: { aligned: true, result: 'pass' }, forwardingReason: true }),
    );
    expect([c.path, c.pathRule, c.cause, c.causeRule, c.alsoMatches]).toEqual([
      'direct',
      'PATH-1',
      null,
      null,
      [],
    ]);
  });

  it('PATH-2: given DMARC pass, SPF not aligned, and a forwarding reason, when classified, then forwarded', () => {
    const c = classify(
      f({
        dmarc: 'pass',
        dkim: { aligned: true },
        forwardingReason: true,
        spf: { result: 'fail' },
      }),
    );
    expect([c.path, c.pathRule]).toEqual(['forwarded', 'PATH-2']);
  });

  it('PATH-3: given DMARC pass, SPF not aligned, and raw SPF fail or softfail, when classified, then forwarded', () => {
    for (const result of ['fail', 'softfail']) {
      const c = classify(f({ dmarc: 'pass', dkim: { aligned: true }, spf: { result } }));
      expect([c.path, c.pathRule]).toEqual(['forwarded', 'PATH-3']);
    }
  });

  it('PATH-4: given any other DMARC pass, when classified, then direct', () => {
    for (const result of ['pass', 'neutral', null]) {
      const c = classify(f({ dmarc: 'pass', dkim: { aligned: true }, spf: { result } }));
      expect([c.path, c.pathRule]).toEqual(['direct', 'PATH-4']);
    }
  });

  it('PATH-5: given DMARC fail, when classified, then the path of the first matching cause', () => {
    const c = classify(f({ dkim: { relatedFail: true } }));
    expect([c.path, c.pathRule, c.cause]).toEqual(['forwarded', 'PATH-5', 'dkim-broken']);
  });
});

describe('Classification: causes (CAUSE-1..10)', () => {
  const cases: [string, Facts, string, string][] = [
    ['CAUSE-1', f({ forwardingReason: true }), 'reported-forwarding', 'forwarded'],
    ['CAUSE-2', f({ dkim: { relatedFail: true } }), 'dkim-broken', 'forwarded'],
    ['CAUSE-3', f({ forwarderIp: true }), 'spf-broken-by-forwarding', 'forwarded'],
    ['CAUSE-4', f({ spf: { result: 'pass' } }), 'spf-not-aligned', 'direct'],
    ['CAUSE-5', f({ dkim: { relatedPass: true } }), 'dkim-not-aligned', 'direct'],
    ['CAUSE-5', f({ dkim: { otherPass: true } }), 'dkim-not-aligned', 'direct'],
    ['CAUSE-6', f({ spf: { result: 'temperror' } }), 'temporary-error', 'other'],
    ['CAUSE-6', f({ dkim: { temperror: true } }), 'temporary-error', 'other'],
    ['CAUSE-7', f({ spf: { result: 'permerror' } }), 'permanent-error', 'other'],
    ['CAUSE-7', f({ dkim: { permerror: true } }), 'permanent-error', 'other'],
    ['CAUSE-8', f({ dkim: { none: true } }), 'no-dkim', 'other'],
    ['CAUSE-9', f({}), 'unauthenticated', 'other'],
  ];
  for (const [rule, input, cause, path] of cases) {
    it(`${rule}: given only its condition, when classified, then cause ${cause} on path ${path}`, () => {
      const c = classify(input);
      expect([c.cause, c.causeRule, c.path, c.alsoMatches]).toEqual([
        cause,
        rule,
        path,
        ['unauthenticated'].filter((x) => x !== cause),
      ]);
    });
  }

  it('CAUSE-10: given several matching causes, when classified, then the first wins and the others are listed in order, with the facts', () => {
    const input = f({ forwarderIp: true, spf: { result: 'pass' }, dkim: { none: true } });
    const c = classify(input);
    expect(c.cause).toBe('spf-broken-by-forwarding');
    expect(c.alsoMatches).toEqual(['spf-not-aligned', 'no-dkim', 'unauthenticated']);
    expect(c.facts).toBe(input);
    expect(c.dmarc).toBe('fail');
  });
});

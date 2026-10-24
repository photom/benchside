import { describe, expect, it } from 'vitest';
import { parseAuthResults } from './parse.ts';

describe('Authentication-Results: parsing', () => {
  it('AR-1: given authserv-id and several method=result entries, when parsed, then each entry has method, result, and props', () => {
    const r = parseAuthResults(
      4,
      ' mx.example.org;\r\n dkim=pass header.i=@example.com header.s=sel1 header.b=AbC+/xYz;\r\n spf=pass smtp.mailfrom=bounce@example.com;\r\n dmarc=pass header.from=example.com',
    );
    expect(r.authservId).toBe('mx.example.org');
    expect(r.entries).toEqual([
      {
        method: 'dkim',
        result: 'pass',
        props: { 'header.i': '@example.com', 'header.s': 'sel1', 'header.b': 'AbC+/xYz' },
      },
      { method: 'spf', result: 'pass', props: { 'smtp.mailfrom': 'bounce@example.com' } },
      { method: 'dmarc', result: 'pass', props: { 'header.from': 'example.com' } },
    ]);
    expect(r.findings).toEqual([]);
  });

  it('AR-1: given comments inside entries, when parsed, then they are ignored', () => {
    const r = parseAuthResults(
      0,
      ' mx.example.org; spf=pass (mx.example.org: domain of a@example.com designates 192.0.2.1 as permitted sender) smtp.mailfrom=a@example.com; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=example.com',
    );
    expect(r.entries.map((e) => [e.method, e.result, e.props])).toEqual([
      ['spf', 'pass', { 'smtp.mailfrom': 'a@example.com' }],
      ['dmarc', 'pass', { 'header.from': 'example.com' }],
    ]);
  });

  it('AR-1: given a version after authserv-id, when parsed, then entries are still found', () => {
    const r = parseAuthResults(0, ' mx.example.org 1; spf=fail smtp.mailfrom=example.com');
    expect(r.authservId).toBe('mx.example.org');
    expect(r.entries).toHaveLength(1);
  });

  it('AR-1: given a quoted authserv-id, when parsed, then it is unquoted', () => {
    expect(parseAuthResults(0, ' "mx.example.org"; spf=pass').authservId).toBe('mx.example.org');
  });

  it('AR-1: given reason="…", when parsed, then reason is the unquoted text', () => {
    const [entry] = parseAuthResults(
      0,
      ' mx.example.org; dkim=fail reason="signature \\"did not\\" verify" header.d=example.com',
    ).entries;
    expect(entry).toEqual({
      method: 'dkim',
      result: 'fail',
      reason: 'signature "did not" verify',
      props: { 'header.d': 'example.com' },
    });
  });

  it('AR-1: given a method with a version (dkim/1), when parsed, then method is dkim', () => {
    expect(parseAuthResults(0, ' mx.example.org; dkim/1=pass').entries[0]?.method).toBe('dkim');
  });

  it('AR-1: given upper-case method, result, and ptype, when parsed, then they are lowercase', () => {
    const [entry] = parseAuthResults(0, ' mx.example.org; DKIM=PASS Header.D=Example.COM').entries;
    expect(entry).toEqual({ method: 'dkim', result: 'pass', props: { 'header.d': 'Example.COM' } });
  });

  it('AR-1: given an unquoted value ending in = (base64 padding), when parsed, then the = stays in the value', () => {
    const [entry] = parseAuthResults(
      0,
      ' mx.example.org; dkim=pass header.b=YWJj= header.s=sel1',
    ).entries;
    expect(entry?.props).toEqual({ 'header.b': 'YWJj=', 'header.s': 'sel1' });
  });

  it('AR-1: given "none" as the only result, when parsed, then there are no entries and no finding', () => {
    const r = parseAuthResults(0, ' mx.example.org; none');
    expect(r.entries).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it('AR-1: given an entry without =, when parsed, then it is skipped with authres.syntax and later entries are kept', () => {
    const r = parseAuthResults(6, ' mx.example.org; dkim pass; spf=pass');
    expect(r.entries.map((e) => e.method)).toEqual(['spf']);
    expect(r.findings).toEqual([
      expect.objectContaining({
        id: 'authres.syntax',
        severity: 'warning',
        evidence: [{ kind: 'header', index: 6 }],
      }),
    ]);
  });

  it('AR-1: given a property without a value, when parsed, then the entry is skipped with authres.syntax', () => {
    const r = parseAuthResults(0, ' mx.example.org; dkim=pass header.d=; spf=pass');
    expect(r.entries.map((e) => e.method)).toEqual(['spf']);
    expect(r.findings.map((f) => f.id)).toEqual(['authres.syntax']);
  });

  it('AR-1: given an empty value or no authserv-id, when parsed, then authres.syntax is reported', () => {
    expect(parseAuthResults(0, '').findings.map((f) => f.id)).toEqual(['authres.syntax']);
    expect(parseAuthResults(0, ' ; spf=pass').findings.map((f) => f.id)).toEqual([
      'authres.syntax',
    ]);
  });

  it('AR-12: given no authserv-id (Microsoft 365 form), when parsed, then authres.syntax is reported and every entry is kept', () => {
    const r = parseAuthResults(
      2,
      ' spf=pass (sender IP is 192.0.2.1) smtp.mailfrom=example.com; dkim=pass (signature was verified) header.d=example.com;dmarc=pass action=none header.from=example.com;compauth=pass reason=100',
    );
    expect(r.authservId).toBe('');
    expect(r.entries.map((e) => `${e.method}=${e.result}`)).toEqual([
      'spf=pass',
      'dkim=pass',
      'dmarc=pass',
      'compauth=pass',
    ]);
    expect(r.findings.map((f) => f.id)).toEqual(['authres.syntax']);
  });

  it('AR-13: given a missing semicolon after authserv-id, when parsed, then authres.syntax is reported and the entry is kept', () => {
    const r = parseAuthResults(
      0,
      ' mx.example.org spf=pass smtp.mailfrom=a@example.com; dkim=pass',
    );
    expect(r.authservId).toBe('mx.example.org');
    expect(r.entries.map((e) => e.method)).toEqual(['spf', 'dkim']);
    expect(r.findings.map((f) => f.id)).toEqual(['authres.syntax']);
  });

  it('AR-13: given unparsable tokens after authserv-id, when parsed, then authres.syntax is reported', () => {
    const r = parseAuthResults(0, ' mx.example.org junk words; dkim=pass');
    expect(r.entries.map((e) => e.method)).toEqual(['dkim']);
    expect(r.findings.map((f) => f.id)).toEqual(['authres.syntax']);
  });

  it('AR-14: given a property without a ptype (action=none), when parsed, then the entry is kept with that property', () => {
    const [entry] = parseAuthResults(
      0,
      ' mx.example.org; dmarc=pass action=none header.from=example.com',
    ).entries;
    expect(entry).toEqual({
      method: 'dmarc',
      result: 'pass',
      props: { action: 'none', 'header.from': 'example.com' },
    });
  });

  it('AR-14: given a quoted local part, when parsed, then the value is the whole address', () => {
    const [entry] = parseAuthResults(
      0,
      ' mx.example.org; spf=pass smtp.mailfrom="john doe"@example.com',
    ).entries;
    expect(entry?.props).toEqual({ 'smtp.mailfrom': '"john doe"@example.com' });
  });

  it('AR-3: given an unknown method, when parsed, then it is listed', () => {
    const r = parseAuthResults(
      0,
      ' mx.example.org; iprev=pass policy.iprev=192.0.2.1; x-custom=ok',
    );
    expect(r.entries.map((e) => e.method)).toEqual(['iprev', 'x-custom']);
  });

  it('given unclosed quotes and comments, when parsed, then it does not throw', () => {
    expect(() => parseAuthResults(0, ' mx.example.org; dkim=pass reason="x')).not.toThrow();
    expect(() => parseAuthResults(0, ' mx.example.org; dkim=pass (x')).not.toThrow();
  });
});

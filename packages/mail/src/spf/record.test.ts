import { describe, expect, it } from 'vitest';
import { isSpfDomain, parseRecord } from './record.ts';

const kinds = (text: string) => {
  const r = parseRecord(text);
  if ('error' in r) throw new Error(r.error);
  return r.terms.map((t) => t.kind);
};

describe('SPF record', () => {
  it('SPF-8: given every mechanism, when parsed, then each becomes a term in order', () => {
    expect(
      kinds(
        'v=spf1 ip4:192.0.2.0/24 ip6:2001:db8::/32 a mx:mail.example.com/24//64 ptr include:_spf.example.com exists:%{i}._ip.example.com ?all',
      ),
    ).toEqual(['ip4', 'ip6', 'a', 'mx', 'ptr', 'include', 'exists', 'all']);
  });

  it('SPF-8: given qualifiers and mixed case, when parsed, then qualifiers default to + and names are case-insensitive', () => {
    const r = parseRecord('V=SPF1 IP4:192.0.2.1 -A ~MX ?All');
    if ('error' in r) throw new Error(r.error);
    expect(r.terms.map((t) => [t.kind, 'q' in t ? t.q : ''])).toEqual([
      ['ip4', '+'],
      ['a', '-'],
      ['mx', '~'],
      ['all', '?'],
    ]);
  });

  it('SPF-22: given a and mx with dual CIDR lengths, when parsed, then both lengths are kept, default 32 and 128', () => {
    const r = parseRecord('v=spf1 a/24 mx:mail.example.com//64 a:x.example.com/28//48');
    if ('error' in r) throw new Error(r.error);
    expect(r.terms.map((t) => ('cidr4' in t ? [t.cidr4, t.cidr6] : []))).toEqual([
      [24, 128],
      [32, 64],
      [28, 48],
    ]);
  });

  it('SPF-9: given redirect, exp, and an unknown modifier, when parsed, then the unknown one is dropped', () => {
    expect(kinds('v=spf1 redirect=_spf.example.com exp=explain.example.com foo=bar')).toEqual([
      'redirect',
      'exp',
    ]);
  });

  it('SPF-9: given a duplicate redirect or exp, when parsed, then it is an error', () => {
    expect(parseRecord('v=spf1 redirect=a.example redirect=b.example')).toHaveProperty('error');
    expect(parseRecord('v=spf1 exp=a.example exp=b.example')).toHaveProperty('error');
  });

  it('SPF-8: given malformed terms, when parsed, then each is an error', () => {
    for (const t of [
      'foo',
      'include',
      'include:',
      'all:x.example',
      'ip4:192.0.2.300',
      'ip4:2001:db8::1',
      'ip6:192.0.2.1',
      'ip4:192.0.2.0/33',
      'ip4:192.0.2.0/024',
      'ip6:2001:db8::/129',
      'a/33',
      'mx//129',
      'include:com',
      'ip4:010.0.0.1',
      'ip4:[192.0.2.1]',
      'ip6:IPv6:2001:db8::1',
      'include:%{q}.example.com',
      'exists:%{d',
      '+-all',
    ]) {
      expect(parseRecord(`v=spf1 ${t}`), t).toHaveProperty('error');
    }
  });

  it('SPF-24: given names, when checked, then only multi-label names with a valid top label are domains', () => {
    expect(isSpfDomain('example.com')).toBe(true);
    expect(isSpfDomain('example.com.')).toBe(true);
    expect(isSpfDomain('_spf.example.com')).toBe(true);
    for (const bad of [
      'com',
      '',
      'a..example',
      'example.123',
      `${'a'.repeat(64)}.example`,
      'x.-com',
    ]) {
      expect(isSpfDomain(bad), bad).toBe(false);
    }
  });

  it('SPF-8: given an IPv4-mapped ip6 network, when parsed, then it stays an IPv6 network', () => {
    const r = parseRecord('v=spf1 ip6:::ffff:192.0.2.0/120 -all');
    if ('error' in r) throw new Error(r.error);
    expect(r.terms[0]).toMatchObject({ kind: 'ip6', prefix: 120, net: { version: 6 } });
  });

  it('SPF-12, SPF-22: given a macro with the / delimiter in a or mx, when parsed, then only a trailing CIDR is split off', () => {
    const r = parseRecord('v=spf1 a:%{l/}.example.com mx:%{l/}.example.com/24 -all');
    if ('error' in r) throw new Error(r.error);
    expect(r.terms.map((t) => ('cidr4' in t ? t.cidr4 : null))).toEqual([32, 24, null]);
  });
});

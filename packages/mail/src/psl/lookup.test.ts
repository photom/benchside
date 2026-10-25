import { describe, expect, it } from 'vitest';
import { organizationalDomain, parsePsl } from './lookup.ts';

const LIST = `// VERSION: 2026-10-22_08-36-41_UTC
// ===BEGIN ICANN DOMAINS===
uk
co.uk

// comment
ck
*.ck
!www.ck
公司.cn
jp
kawasaki.jp
*.kawasaki.jp
!city.kawasaki.jp
// ===END ICANN DOMAINS===
// ===BEGIN PRIVATE DOMAINS===
github.io trailing text is ignored
// ===END PRIVATE DOMAINS===
`;
const psl = parsePsl(LIST);
const org = (domain: string) => organizationalDomain(psl, domain);

describe('PSL', () => {
  it('DMARC-7: given the VERSION header, when parsed, then the version is kept', () => {
    expect(psl.version).toBe('2026-10-22_08-36-41_UTC');
    expect(parsePsl('uk\n').version).toBeNull();
  });

  it('DMARC-7, DMARC-26: given a name under a two-label suffix, when looked up, then the organizational domain is the suffix plus one label', () => {
    expect(org('a.b.example.co.uk')).toEqual({ domain: 'example.co.uk', rule: 'co.uk' });
  });

  it('DMARC-26: given labels in upper case, when looked up, then they compare in lower case', () => {
    expect(org('Mail.Example.CO.UK').domain).toBe('example.co.uk');
  });

  it('DMARC-26: given a wildcard rule, when looked up, then * matches any one label', () => {
    expect(org('a.b.c.ck')).toEqual({ domain: 'b.c.ck', rule: '*.ck' });
  });

  it('DMARC-26: given an exception rule, when looked up, then it wins and its suffix drops the leftmost label', () => {
    expect(org('mail.www.ck')).toEqual({ domain: 'www.ck', rule: '!www.ck' });
    expect(org('a.city.kawasaki.jp')).toEqual({
      domain: 'city.kawasaki.jp',
      rule: '!city.kawasaki.jp',
    });
  });

  it('DMARC-26: given no matching rule, when looked up, then the default rule * makes the top-level label the suffix', () => {
    expect(org('mail.example.invalid')).toEqual({ domain: 'example.invalid', rule: '*' });
  });

  it('DMARC-7: given a domain that is itself a public suffix, when looked up, then it is its own organizational domain', () => {
    expect(org('co.uk').domain).toBe('co.uk');
    expect(org('x.kawasaki.jp').domain).toBe('x.kawasaki.jp');
  });

  it('DMARC-26: given a rule with Unicode labels, when an A-label domain is looked up, then the rule matches', () => {
    expect(org('mail.example.xn--55qx5d.cn')).toEqual({
      domain: 'example.xn--55qx5d.cn',
      rule: '公司.cn',
    });
  });

  it('DMARC-7: given a private-section rule, when looked up, then it is used', () => {
    expect(org('me.github.io')).toEqual({ domain: 'me.github.io', rule: 'github.io' });
  });
});

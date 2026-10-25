import { describe, expect, it } from 'vitest';
import { addressDomains } from './author.ts';

describe('DMARC author addresses', () => {
  it('DMARC-21: given a display name, comment, and angle address, when parsed, then the domain is found', () => {
    expect(addressDomains('"Alice (A.)" <alice@Example.COM> (work)')).toEqual(['example.com']);
  });

  it('DMARC-21: given a bare address and a quoted local part, when parsed, then each domain is found', () => {
    expect(addressDomains('a@example.com, "x@y"@example.org')).toEqual([
      'example.com',
      'example.org',
    ]);
  });

  it('DMARC-21: given a group with members, when parsed, then the members are addresses', () => {
    expect(addressDomains('Team: a@example.com, B <b@example.net>;')).toEqual([
      'example.com',
      'example.net',
    ]);
  });

  it('DMARC-21: given an obsolete route in an angle address, when parsed, then the route is dropped', () => {
    expect(addressDomains('<@relay.example:a@example.com>')).toEqual(['example.com']);
  });

  it('DMARC-21: given a domain literal, no @, an empty group only, or a bad domain, when parsed, then it is invalid', () => {
    for (const v of [
      'a@[192.0.2.1]',
      'alice',
      'undisclosed-recipients:;',
      'a@exa mple.com',
      '',
      'a@-x.example',
    ]) {
      expect(addressDomains(v), v).toBeNull();
    }
  });
});

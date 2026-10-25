import { describe, expect, it } from 'vitest';
import { organizationalDomain } from './lookup.ts';
import { bundledPsl } from './snapshot.ts';

describe('PSL snapshot', () => {
  it('DMARC-7: given the bundled snapshot, when loaded, then it has its VERSION and the ICANN and private rules', () => {
    const psl = bundledPsl();
    expect(psl.version).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_UTC$/);
    expect(organizationalDomain(psl, 'mail.example.co.uk').domain).toBe('example.co.uk');
    expect(organizationalDomain(psl, 'a.b.me.github.io').domain).toBe('me.github.io');
  });

  it('DMARC-7: given two loads, when compared, then the list is parsed once', () => {
    expect(bundledPsl()).toBe(bundledPsl());
  });
});

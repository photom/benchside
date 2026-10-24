import { describe, expect, it } from 'vitest';
import { toALabels } from './domain.ts';

describe('domain names', () => {
  it('DNS-18: given an ASCII name, when converted, then it is unchanged', () => {
    expect(toALabels('sel._domainkey.Example.COM')).toBe('sel._domainkey.Example.COM');
  });

  it('DNS-18: given Unicode labels, when converted, then they become A-labels and other labels stay', () => {
    expect(toALabels('sel._domainkey.bücher.example')).toBe('sel._domainkey.xn--bcher-kva.example');
  });

  it('DNS-18: given a label with @, :, /, %, or whitespace, when converted, then it is refused', () => {
    for (const name of [
      'ü@attacker.example',
      'ü:80.example',
      'ü/x.example',
      'ü%41.example',
      'ü x.example',
    ]) {
      expect(toALabels(name), name).toBeNull();
    }
  });

  it('DNS-18: given a label with an ideographic or fullwidth dot, when converted, then it is refused', () => {
    expect(toALabels('a。ü.example')).toBeNull();
    expect(toALabels('a．ü.example')).toBeNull();
  });
});

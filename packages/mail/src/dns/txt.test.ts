import { describe, expect, it } from 'vitest';
import { joinTxtData } from './txt.ts';

describe('TXT data', () => {
  it('DNS-7: given several quoted strings, when joined, then they are unquoted and joined without separators', () => {
    expect(joinTxtData('"v=DKIM1; k=rsa; " "p=MIGf"')).toBe('v=DKIM1; k=rsa; p=MIGf');
  });

  it('DNS-7: given escapes, when joined, then \\" \\\\ and \\DDD are unescaped', () => {
    expect(joinTxtData('"a\\"b\\\\c\\059d"')).toBe('a"b\\c;d');
  });

  it('DNS-7: given unquoted data (Google form), when joined, then it is used as is', () => {
    expect(joinTxtData('v=spf1 -all')).toBe('v=spf1 -all');
  });

  it('given an unclosed quote, when joined, then the rest is taken without throwing', () => {
    expect(joinTxtData('"abc')).toBe('abc');
  });

  it('DNS-7: given \\DDD escapes of UTF-8 bytes, when joined, then they decode as UTF-8', () => {
    expect(joinTxtData('"note=\\227\\129\\130"')).toBe('note=あ');
  });

  it('DNS-7: given \\DDD over 255, when joined, then it is kept as written', () => {
    expect(joinTxtData('"a\\999"')).toBe('a\\999');
  });
});

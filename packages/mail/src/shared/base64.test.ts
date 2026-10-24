import { describe, expect, it } from 'vitest';
import { decodeBase64 } from './base64.ts';

const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

describe('base64', () => {
  it('DKIM-17: given base64 with folding whitespace, when decoded, then whitespace is ignored', () => {
    expect(text(decodeBase64('aGVs\r\n\tbG8g d29y bGQ='))).toBe('hello world');
  });

  it('DKIM-17: given an empty value, when decoded, then the result is empty', () => {
    expect(decodeBase64('')).toEqual(new Uint8Array());
  });

  it('DKIM-17: given characters outside the alphabet or bad padding, when decoded, then it is invalid', () => {
    expect(decodeBase64('aGVs*G8=')).toBeNull();
    expect(decodeBase64('aGVsbG8')).toBeNull();
    expect(decodeBase64('aG=Vs')).toBeNull();
  });
});

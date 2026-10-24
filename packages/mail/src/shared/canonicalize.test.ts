import { describe, expect, it } from 'vitest';
import { bodyRelaxed, bodySimple, headerRelaxed, headerSimple } from './canonicalize.ts';

const b = (s: string) => new TextEncoder().encode(s);
const s = (u: Uint8Array) => new TextDecoder().decode(u);

// RFC 6376 §3.4.5, examples 1-3.
const HEADER_A = 'A: X\r\n';
const HEADER_B = 'B : Y\t\r\n\tZ  \r\n';
const BODY = ' C \r\nD \t E\r\n\r\n\r\n';

describe('canonicalization (RFC 6376 §3.4)', () => {
  it('DKIM-14: given the RFC example, when relaxed header canonicalization runs, then fields become a:X and b:Y Z', () => {
    expect(s(headerRelaxed(b(HEADER_A)))).toBe('a:X\r\n');
    expect(s(headerRelaxed(b(HEADER_B)))).toBe('b:Y Z\r\n');
  });

  it('DKIM-14: given the RFC example, when simple header canonicalization runs, then fields are unchanged', () => {
    expect(s(headerSimple(b(HEADER_B)))).toBe(HEADER_B);
  });

  it('DKIM-11: given the RFC example, when relaxed body canonicalization runs, then WSP collapses and trailing empty lines go', () => {
    expect(s(bodyRelaxed(b(BODY)))).toBe(' C\r\nD E\r\n');
  });

  it('DKIM-11: given the RFC example, when simple body canonicalization runs, then only trailing empty lines go', () => {
    expect(s(bodySimple(b(BODY)))).toBe(' C \r\nD \t E\r\n');
  });

  it('DKIM-11: given an empty body, when canonicalized, then simple gives CRLF and relaxed gives nothing', () => {
    expect(s(bodySimple(b('')))).toBe('\r\n');
    expect(s(bodyRelaxed(b('')))).toBe('');
    expect(s(bodySimple(b('\r\n\r\n')))).toBe('\r\n');
    expect(s(bodyRelaxed(b('\r\n \r\n')))).toBe('');
  });

  it('DKIM-11: given a body without a final CRLF, when canonicalized, then CRLF is added', () => {
    expect(s(bodySimple(b('x')))).toBe('x\r\n');
    expect(s(bodyRelaxed(b('x  ')))).toBe('x\r\n');
  });

  it('DKIM-14: given a header field without a final CRLF (the signature field), when relaxed, then none is added', () => {
    expect(s(headerRelaxed(b('DKIM-Signature: a=1;  b=')))).toBe('dkim-signature:a=1; b=');
  });

  it('DKIM-11: given a bare LF in the body (input that skipped IN-7), when relaxed, then it is content and nothing is lost', () => {
    expect(s(bodyRelaxed(b('\nx')))).toBe('\nx\r\n');
  });
});

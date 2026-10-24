import { describe, expect, it } from 'vitest';
import { normalizeLineEndings } from './line-endings.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('line endings', () => {
  it('IN-7: given CRLF only, when normalized, then the original array is used and there is no finding', () => {
    const input = bytes('A: 1\r\n\r\nbody\r\n');
    const n = normalizeLineEndings(input);
    expect(n.bytes).toBe(input);
    expect(n.findings).toEqual([]);
  });

  it('IN-7: given LF only, when normalized, then every LF becomes CRLF with input.lf-converted', () => {
    const n = normalizeLineEndings(bytes('A: 1\n\nbody\n'));
    expect(text(n.bytes)).toBe('A: 1\r\n\r\nbody\r\n');
    expect(n.findings).toEqual([
      expect.objectContaining({
        id: 'input.lf-converted',
        severity: 'warning',
        evidence: [{ kind: 'bytes', range: { start: 4, end: 5 } }],
      }),
    ]);
  });

  it('IN-7: given CRLF and bare LF, when normalized, then bare LFs become CRLF with input.line-endings-mixed at the first bare LF', () => {
    const n = normalizeLineEndings(bytes('A: 1\r\nB: 2\n\r\nx\n'));
    expect(text(n.bytes)).toBe('A: 1\r\nB: 2\r\n\r\nx\r\n');
    expect(n.findings).toEqual([
      expect.objectContaining({
        id: 'input.line-endings-mixed',
        severity: 'warning',
        evidence: [{ kind: 'bytes', range: { start: 10, end: 11 } }],
      }),
    ]);
  });

  it('IN-7: given a bare CR, when normalized, then it is kept with input.bare-cr pointing at it', () => {
    const n = normalizeLineEndings(bytes('A: 1\rx\r\n\r\n'));
    expect(text(n.bytes)).toBe('A: 1\rx\r\n\r\n');
    expect(n.findings).toEqual([
      expect.objectContaining({
        id: 'input.bare-cr',
        severity: 'warning',
        evidence: [{ kind: 'bytes', range: { start: 4, end: 5 } }],
      }),
    ]);
  });

  it('IN-13: given more than 100 bare CRs, when normalized, then evidence stops at 100', () => {
    const n = normalizeLineEndings(bytes(`${'x\r'.repeat(150)}\r\n`));
    expect(n.findings[0]?.evidence).toHaveLength(100);
  });

  it('IN-8: given inserted CRs, when mapped back, then normalized offsets give original offsets', () => {
    // original: a \n b \n c   normalized: a \r \n b \r \n c
    const n = normalizeLineEndings(bytes('a\nb\nc'));
    expect([0, 1, 2, 3, 4, 5, 6].map((o) => n.toOriginal(o))).toEqual([0, 1, 1, 2, 3, 3, 4]);
    expect(n.toOriginal(7)).toBe(5); // end of input
  });

  it('IN-8: given CRLF-only input, when mapped back, then offsets are unchanged', () => {
    const n = normalizeLineEndings(bytes('a\r\nb'));
    expect(n.toOriginal(3)).toBe(3);
  });

  it('given empty input, when normalized, then nothing changes', () => {
    const n = normalizeLineEndings(new Uint8Array());
    expect(n.bytes).toHaveLength(0);
    expect(n.findings).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { pngDecode } from './predictor.ts';

const decode = (rows: number[][], columns: number, colors = 1, bits = 8) =>
  pngDecode(Uint8Array.from(rows.flat()), { columns, colors, bitsPerComponent: bits });

describe('PNG predictors', () => {
  it('XST-3: given None and Sub rows, when decoded, then the raw bytes', () => {
    // Sub: Raw(x) = Sub(x) + Raw(x - bpp), with Raw(x) = 0 for x < 0 (RFC 2083 §6.3).
    expect(
      decode(
        [
          [0, 1, 2, 3],
          [1, 1, 1, 1],
        ],
        3,
      ),
    ).toEqual({ kind: 'ok', bytes: Uint8Array.of(1, 2, 3, 1, 2, 3) });
  });

  it('XST-3: given Up rows, when decoded, then each byte adds the one above (§6.4)', () => {
    expect(
      decode(
        [
          [2, 1, 2],
          [2, 1, 1],
        ],
        2,
      ),
    ).toEqual({ kind: 'ok', bytes: Uint8Array.of(1, 2, 2, 3) });
  });

  it('XST-3: given an Average row, when decoded, then floor((left + above) / 2) is added (§6.5)', () => {
    // Row 1 raw: 10 20. Row 2: left 0, above 10 -> 5 + 5 = 10; left 10, above 20 -> 15 + 1 = 16.
    expect(
      decode(
        [
          [0, 10, 20],
          [3, 5, 1],
        ],
        2,
      ),
    ).toEqual({ kind: 'ok', bytes: Uint8Array.of(10, 20, 10, 16) });
  });

  it('XST-3: given a Paeth row, when decoded, then the nearest of left, above, upper left is added (§6.6)', () => {
    // Row 1 raw: 10 20. Row 2 x=0: a=0 b=10 c=0, p=10, nearest b=10 -> 3 + 10 = 13.
    // x=1: a=13 b=20 c=10, p=23, pa=10 pb=3 pc=13 -> b=20 -> 1 + 20 = 21.
    expect(
      decode(
        [
          [0, 10, 20],
          [4, 3, 1],
        ],
        2,
      ),
    ).toEqual({ kind: 'ok', bytes: Uint8Array.of(10, 20, 13, 21) });
  });

  it('XST-3: given bpp 2, when Sub is decoded, then each byte adds the byte two to the left', () => {
    expect(decode([[1, 1, 2, 1, 1]], 2, 2)).toEqual({
      kind: 'ok',
      bytes: Uint8Array.of(1, 2, 2, 3),
    });
  });

  it('XST-3: given arithmetic past 255, when decoded, then modulo 256', () => {
    expect(
      decode(
        [
          [0, 200],
          [2, 100],
        ],
        1,
      ),
    ).toEqual({ kind: 'ok', bytes: Uint8Array.of(200, 44) });
  });

  it('XST-3: given a tag above 4, when decoded, then an error', () => {
    expect(decode([[5, 1]], 1)).toEqual({ kind: 'error', message: 'Row 0 has predictor tag 5.' });
  });

  it('XST-3, REQ-PDF-003: given Columns far beyond the data, when decoded, then an error, not an allocation', () => {
    expect(decode([[2, 1]], 2 ** 40)).toMatchObject({ kind: 'error' });
  });
});

import { describe, expect, it } from 'vitest';
import { decodeText, MAX_TEXT } from './text.ts';

const ch = (...codes: number[]) => String.fromCharCode(...codes);

describe('text strings', () => {
  it('TXT-1: given FE FF and UTF-16BE, when decoded, then the characters, including supplementary ones', () => {
    // "Aé" and U+1F600 as a surrogate pair.
    const bytes = Uint8Array.of(0xfe, 0xff, 0, 0x41, 0, 0xe9, 0xd8, 0x3d, 0xde, 0x00);
    expect(decodeText(bytes)).toEqual({
      text: `A${ch(0xe9)}${ch(0xd83d, 0xde00)}`,
      truncated: false,
    });
  });

  it('TXT-1: given a language escape, when decoded, then it is removed', () => {
    // U+001B "ja" "JP" U+001B, then "A".
    const bytes = Uint8Array.of(
      0xfe,
      0xff,
      0,
      0x1b,
      0,
      0x6a,
      0,
      0x61,
      0,
      0x4a,
      0,
      0x50,
      0,
      0x1b,
      0,
      0x41,
    );
    expect(decodeText(bytes).text).toBe('A');
  });

  it('TXT-1: given an odd trailing byte, when decoded, then U+FFFD', () => {
    expect(decodeText(Uint8Array.of(0xfe, 0xff, 0, 0x41, 0x42)).text).toBe(`A${ch(0xfffd)}`);
  });

  it('TXT-2: given ASCII and Latin-1 bytes, when decoded as PDFDocEncoding, then the same characters', () => {
    expect(decodeText(Uint8Array.of(0x48, 0x69, 0x0a, 0xe9, 0xff)).text).toBe(
      `Hi${ch(10, 0xe9, 0xff)}`,
    );
  });

  it('TXT-2: given the bytes Table D.2 maps differently, when decoded, then those characters', () => {
    expect(decodeText(Uint8Array.of(0x18, 0x80, 0x84, 0x8a, 0x93, 0x9e, 0xa0)).text).toBe(
      ch(0x02d8, 0x2022, 0x2014, 0x2212, 0xfb01, 0x017e, 0x20ac),
    );
  });

  it('TXT-2: given undefined bytes, when decoded, then U+FFFD', () => {
    expect(decodeText(Uint8Array.of(0x00, 0x7f, 0x9f, 0xad)).text).toBe(
      ch(0xfffd, 0xfffd, 0xfffd, 0xfffd),
    );
  });

  it('TXT-3: given UTF-16 text cut inside a surrogate pair, when decoded, then the pair is not split', () => {
    const units = [0x41, ...Array.from({ length: MAX_TEXT }, () => [0xd83d, 0xde00]).flat()];
    const bytes = new Uint8Array(2 + units.length * 2);
    bytes.set([0xfe, 0xff]);
    units.forEach((u, i) => {
      bytes[2 + 2 * i] = u >> 8;
      bytes[3 + 2 * i] = u & 0xff;
    });
    const r = decodeText(bytes);
    expect(r.truncated).toBe(true);
    const last = r.text?.charCodeAt((r.text?.length ?? 0) - 1) ?? 0;
    expect(last < 0xd800 || last > 0xdbff).toBe(true);
  });

  it('TXT-3: given text longer than the limit, when decoded, then it is cut and marked truncated', () => {
    const r = decodeText(new Uint8Array(MAX_TEXT + 5).fill(0x41));
    expect(r.text?.length).toBe(MAX_TEXT);
    expect(r.truncated).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { decodeArchiveComment, decodeCp437, decodeUtf8 } from './text.ts';

const b = (...v: number[]) => Uint8Array.from(v);
const utf8 = (s: string) => new TextEncoder().encode(s);

describe('UTF-8', () => {
  it('NAME-1: given valid UTF-8, when decoded, then gives the text and valid', () => {
    expect(decodeUtf8(utf8('日本/ä.txt'))).toEqual({ text: '日本/ä.txt', valid: true });
  });

  it('NAME-1: given invalid UTF-8, when decoded, then uses U+FFFD and is not valid', () => {
    expect(decodeUtf8(b(0x61, 0xff, 0x62))).toEqual({ text: 'a�b', valid: false });
  });
});

describe('Code Page 437', () => {
  it('NAME-3: given ASCII bytes, when decoded, then reads them as ASCII', () => {
    expect(decodeCp437(utf8('dir/file.txt'))).toBe('dir/file.txt');
  });

  it('NAME-3: given high bytes, when decoded, then maps them by Code Page 437', () => {
    expect(decodeCp437(b(0x80, 0x81, 0x9b, 0xb0, 0xc9, 0xe1, 0xe3, 0xfe, 0xff))).toBe(
      'Çü¢░╔ßπ■ ',
    );
  });

  it('NAME-3: given every byte, when decoded, then gives one character each', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...decodeCp437(all)]).toHaveLength(256);
  });
});

describe('archive comment', () => {
  it('NAME-4: given ASCII, when decoded, then is Code Page 437, not guessed', () => {
    expect(decodeArchiveComment(utf8('hello'))).toEqual({
      text: 'hello',
      encoding: 'cp437',
      guessed: false,
    });
  });

  it('NAME-4: given valid non-ASCII UTF-8, when decoded, then is UTF-8, guessed', () => {
    expect(decodeArchiveComment(utf8('こんにちは'))).toEqual({
      text: 'こんにちは',
      encoding: 'utf-8',
      guessed: true,
    });
  });

  it('NAME-4: given non-ASCII bytes that are not UTF-8, when decoded, then is Code Page 437', () => {
    expect(decodeArchiveComment(b(0x82, 0x41))).toEqual({
      text: 'éA',
      encoding: 'cp437',
      guessed: false,
    });
  });
});

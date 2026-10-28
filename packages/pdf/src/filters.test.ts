import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ascii85, asciiHex, decodeStream, lzw, runLength } from './filters.ts';
import { FindingList } from './findings.ts';
import { Lexer } from './lexer.ts';
import { Parser, type PdfValue } from './parser.ts';
import { pngUp } from './test/build-pdf.ts';

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const dict = (source: string): PdfValue | null =>
  new Parser(new Lexer(bytes(source)), new FindingList()).parseValue();
const decode = (data: Uint8Array, source: string, left = 256 * 1024 * 1024) =>
  decodeStream(data, dict(source), { left });

describe('ASCIIHexDecode', () => {
  it('FLT-2: given hex pairs with white space and >, when decoded, then the bytes', () => {
    expect(asciiHex(bytes('48 65\n6c6C 6f>ignored'))).toEqual({
      kind: 'ok',
      bytes: bytes('Hello'),
    });
  });

  it('FLT-2: given an odd final digit, when decoded, then it is followed by 0', () => {
    expect(asciiHex(bytes('414>'))).toEqual({ kind: 'ok', bytes: Uint8Array.of(0x41, 0x40) });
  });

  it('FLT-2: given a byte that is not hex, when decoded, then an error', () => {
    expect(asciiHex(bytes('41x2>'))).toMatchObject({ kind: 'error' });
  });
});

describe('ASCII85Decode', () => {
  it('FLT-3: given full groups and ~>, when decoded, then the bytes', () => {
    expect(ascii85(bytes('9jqo^BlbD-BleB1DJ+*+F(f,q~>'))).toEqual({
      kind: 'ok',
      bytes: bytes('Man is distinguished'),
    });
  });

  it('FLT-3: given z and a final partial group, when decoded, then four zero bytes and n - 1 bytes', () => {
    // "z" is 0 0 0 0; "9jqo" is the partial group for "Man".
    expect(ascii85(bytes('z9jqo~>'))).toEqual({
      kind: 'ok',
      bytes: Uint8Array.of(0, 0, 0, 0, 0x4d, 0x61, 0x6e),
    });
  });

  it('FLT-3: given many z characters, when decoded, then four zero bytes each', () => {
    expect(ascii85(bytes('zzzzzzzz~>'))).toEqual({ kind: 'ok', bytes: new Uint8Array(32) });
  });

  it('FLT-3, FLT-9: given z characters past the limit, when decoded, then exceeded', () => {
    expect(ascii85(bytes('zzz~>'), 8)).toEqual({ kind: 'exceeded' });
  });

  it('FLT-3: given white space inside groups, when decoded, then it is ignored', () => {
    expect(ascii85(bytes('9jq\no^ ~>'))).toEqual({ kind: 'ok', bytes: bytes('Man ') });
  });

  it('FLT-3: given z inside a group, a group above 2^32 - 1, or one final character, when decoded, then an error', () => {
    expect(ascii85(bytes('9jzo^~>'))).toMatchObject({ kind: 'error' });
    expect(ascii85(bytes('uuuuu~>'))).toMatchObject({ kind: 'error' });
    expect(ascii85(bytes('9jqo^9~>'))).toMatchObject({ kind: 'error' });
  });

  it('FLT-3: given a byte outside ! to u, when decoded, then an error', () => {
    expect(ascii85(bytes('9jqo{~>'))).toMatchObject({ kind: 'error' });
  });
});

describe('LZWDecode', () => {
  it('FLT-4: given the 7.4.4.2 example, when decoded, then the input sequence', () => {
    const data = Uint8Array.of(0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01);
    expect(lzw(data, 1, 1000)).toEqual({
      kind: 'ok',
      bytes: Uint8Array.of(45, 45, 45, 45, 45, 65, 45, 45, 45, 66),
    });
  });

  it('FLT-4: given a code not yet in the table, when decoded, then an error', () => {
    // 256 (clear), then 300: 9-bit codes 100000000 100101100.
    expect(lzw(Uint8Array.of(0x80, 0x4b, 0x00), 1, 1000)).toMatchObject({ kind: 'error' });
  });

  it('FLT-4, FLT-9: given output beyond the limit, when decoded, then exceeded', () => {
    const data = Uint8Array.of(0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0c, 0x85, 0x01);
    expect(lzw(data, 1, 5)).toEqual({ kind: 'exceeded' });
  });
});

describe('RunLengthDecode', () => {
  it('FLT-6: given literal and repeat runs and 128, when decoded, then the bytes', () => {
    expect(runLength(Uint8Array.of(2, 0x61, 0x62, 0x63, 254, 0x7a, 128, 0x99), 100)).toEqual({
      kind: 'ok',
      bytes: bytes('abczzz'),
    });
  });
});

describe('the filter pipeline', () => {
  it('FLT-1: given no filter, when decoded, then the data as is', async () => {
    expect(await decode(bytes('abc'), '<< >>')).toEqual({ kind: 'ok', bytes: bytes('abc') });
  });

  it('FLT-1, FLT-5: given an array of filters, when decoded, then each is applied in order', async () => {
    const flate = deflateSync(bytes('hello'));
    const hex = bytes(`${[...flate].map((b) => b.toString(16).padStart(2, '0')).join('')}>`);
    expect(await decode(hex, '<< /Filter [/ASCIIHexDecode /FlateDecode] >>')).toEqual({
      kind: 'ok',
      bytes: bytes('hello'),
    });
  });

  it('FLT-7: given Flate with a PNG predictor in DecodeParms, when decoded, then the rows are restored', async () => {
    const raw = Uint8Array.of(1, 2, 3, 4, 5, 6);
    const data = new Uint8Array(deflateSync(pngUp(raw, 3)));
    expect(
      await decode(
        data,
        '<< /Filter [/FlateDecode] /DecodeParms [<< /Predictor 12 /Columns 3 >>] >>',
      ),
    ).toEqual({ kind: 'ok', bytes: raw });
  });

  it('FLT-7: given TIFF predictor 2, when decoded, then unsupported', async () => {
    const data = new Uint8Array(deflateSync(bytes('x')));
    expect(
      await decode(data, '<< /Filter /FlateDecode /DecodeParms << /Predictor 2 >> >>'),
    ).toMatchObject({ kind: 'unsupported', filter: 'Predictor 2' });
  });

  it('FLT-5: given Flate data that does not inflate, when decoded, then an error naming the filter', async () => {
    expect(await decode(bytes('nope'), '<< /Filter /FlateDecode >>')).toMatchObject({
      kind: 'error',
      filter: 'FlateDecode',
    });
  });

  it('FLT-8: given an image filter, when decoded, then unsupported', async () => {
    expect(await decode(bytes('x'), '<< /Filter /DCTDecode >>')).toMatchObject({
      kind: 'unsupported',
      filter: 'DCTDecode',
    });
  });

  it('FLT-9: given output past the budget left, when decoded, then the limit', async () => {
    const budget = { left: 4 };
    expect(await decodeStream(bytes('hello'), dict('<< >>'), budget)).toEqual({ kind: 'limit' });
  });

  it('FLT-9: given decoded data, when decoded, then the budget shrinks by its length', async () => {
    const budget = { left: 100 };
    await decodeStream(bytes('414243>'), dict('<< /Filter /ASCIIHexDecode >>'), budget);
    expect(budget.left).toBe(97);
  });

  it('FLT-9: given a stage that inflates and a later stage that fails, when decoded, then the inflated bytes still use the budget', async () => {
    const budget = { left: 1000 };
    const data = new Uint8Array(deflateSync(new Uint8Array(600)));
    await decodeStream(data, dict('<< /Filter [/FlateDecode /DCTDecode] >>'), budget);
    expect(budget.left).toBe(400);
  });

  it('FLT-9: given output past 32 MiB for one stream, when decoded, then the limit', async () => {
    const data = new Uint8Array(deflateSync(new Uint8Array(33 * 1024 * 1024)));
    expect(await decode(data, '<< /Filter /FlateDecode >>')).toEqual({ kind: 'limit' });
  });

  it('FLT-8: given an unknown filter name, when decoded, then unsupported', async () => {
    expect(await decode(bytes('9jqo^~>'), '<< /Filter /A85 >>')).toMatchObject({
      kind: 'unsupported',
      filter: 'A85',
    });
  });
});

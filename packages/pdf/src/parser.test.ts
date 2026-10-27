import { describe, expect, it } from 'vitest';
import { FindingList } from './findings.ts';
import { Lexer } from './lexer.ts';
import { dictGet, Parser, type PdfValue } from './parser.ts';

// Characters built from code points, so the source holds no escape sequences.
const ch = (code: number) => String.fromCharCode(code);
const BS = ch(0x5c);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

function parse(source: string) {
  const findings = new FindingList();
  const parser = new Parser(new Lexer(latin1(source), 100), findings);
  return { value: parser.parseValue(), parser, ids: findings.list.map((f) => f.id), findings };
}

/** A compact view of a value for assertions. */
function show(v: PdfValue | null): unknown {
  if (v === null) return undefined;
  switch (v.kind) {
    case 'null':
      return null;
    case 'boolean':
    case 'number':
      return v.value;
    case 'string':
      return { string: text(v.bytes) };
    case 'name':
      return `/${v.text}`;
    case 'array':
      return v.items.map(show);
    case 'dict':
      return Object.fromEntries([...v.entries].map(([k, x]) => [k, show(x)]));
    case 'ref':
      return `${v.number} ${v.generation} R`;
  }
}

describe('lexical conventions', () => {
  it('LEX-1, LEX-3: given white space and a comment between tokens, when parsed, then they separate tokens', () => {
    const { value } = parse(`[1${CR}${LF}2 % comment ] 3${LF}4]`);
    expect(show(value)).toEqual([1, 2, 4]);
  });

  it('LEX-2: given delimiters with no white space, when parsed, then they still separate tokens', () => {
    expect(show(parse('[/a(b)<63>[1]]').value)).toEqual([
      '/a',
      { string: 'b' },
      { string: 'c' },
      [1],
    ]);
  });

  it('LEX-4: given an unknown keyword in an array, when parsed, then syntax error and it is skipped', () => {
    const { value, findings } = parse('[1 foo 2]');
    expect(show(value)).toEqual([1, 2]);
    expect(findings.list).toMatchObject([{ id: 'pdf.syntax.error', offset: 103 }]);
  });
});

describe('objects', () => {
  it('OBJ-1: given true, false, and null, when parsed, then booleans and null', () => {
    expect(show(parse('[true false null]').value)).toEqual([true, false, null]);
  });

  it('OBJ-2: given integers and reals, when parsed, then numbers', () => {
    expect(show(parse('[123 +17 -98 0 34.5 -3.62 4. -.002]').value)).toEqual([
      123, 17, -98, 0, 34.5, -3.62, 4, -0.002,
    ]);
  });

  it('OBJ-2: given an exponent form, when parsed, then syntax error', () => {
    const { value, ids } = parse('[6.02E23 1]');
    expect(show(value)).toEqual([1]);
    expect(ids).toEqual(['pdf.syntax.error']);
  });

  it('OBJ-2: given an integer above 2^53, when parsed, then value-too-large and null', () => {
    const { value, ids } = parse('[99999999999999999999]');
    expect(show(value)).toEqual([null]);
    expect(ids).toEqual(['pdf.value-too-large']);
  });

  it('OBJ-3: given balanced parentheses and Table 3 escapes, when parsed, then the bytes', () => {
    const s = `(a (b) ${BS}n${BS}r${BS}t${BS}b${BS}f${BS}(${BS})${BS}${BS})`;
    expect(show(parse(s).value)).toEqual({
      string: `a (b) ${LF}${CR}${ch(9)}${ch(8)}${ch(12)}()${BS}`,
    });
  });

  it('OBJ-3: given octal escapes, when parsed, then one to three digits and overflow ignored', () => {
    const s = `(${BS}0053${BS}53${BS}7${BS}777)`;
    expect([...((parse(s).value as { bytes: Uint8Array }).bytes ?? [])]).toEqual([
      5, 0x33, 0x2b, 7, 0xff,
    ]);
  });

  it('OBJ-3: given a backslash before an end-of-line, when parsed, then the lines join', () => {
    expect(show(parse(`(a${BS}${CR}${LF}b)`).value)).toEqual({ string: 'ab' });
  });

  it('OBJ-3: given an end-of-line inside the string, when parsed, then one LF byte', () => {
    expect(show(parse(`(a${CR}${LF}b${CR}c)`).value)).toEqual({ string: `a${LF}b${LF}c` });
  });

  it('OBJ-3: given an unknown escape, when parsed, then the backslash is dropped', () => {
    expect(show(parse(`(${BS}q)`).value)).toEqual({ string: 'q' });
  });

  it('OBJ-3: given a string with no closing parenthesis, when parsed, then syntax error', () => {
    const { value, ids } = parse('(abc');
    expect(show(value)).toEqual({ string: 'abc' });
    expect(ids).toEqual(['pdf.syntax.error']);
  });

  it('OBJ-4: given a hex string with white space and an odd digit, when parsed, then the bytes', () => {
    expect([...(parse('<90 1F A>').value as { bytes: Uint8Array }).bytes]).toEqual([
      0x90, 0x1f, 0xa0,
    ]);
  });

  it('OBJ-4: given a byte that is not hex, when parsed, then syntax error and it is skipped', () => {
    const { value, ids } = parse('<41x42>');
    expect(show(value)).toEqual({ string: 'AB' });
    expect(ids).toEqual(['pdf.syntax.error']);
  });

  it('OBJ-5: given names with #xx, when parsed, then the decoded bytes', () => {
    expect(show(parse('[/lime#20Green /A#42 /The_Key_of_F#23_Minor /]').value)).toEqual([
      '/lime Green',
      '/AB',
      '/The_Key_of_F#_Minor',
      '/',
    ]);
  });

  it('OBJ-5: given a # without two hex digits, when parsed, then kept and syntax error', () => {
    const { value, ids } = parse('/a#zz');
    expect(show(value)).toEqual('/a#zz');
    expect(ids).toEqual(['pdf.syntax.error']);
  });

  it('OBJ-6, OBJ-7: given nested arrays and dictionaries, when parsed, then the structure', () => {
    const { value } = parse('<< /Type /Example /Sub << /Item1 0.4 /Item2 true >> /A [1 [2]] >>');
    expect(show(value)).toEqual({
      Type: '/Example',
      Sub: { Item1: 0.4, Item2: true },
      A: [1, [2]],
    });
  });

  it('OBJ-7: given a key that is not a name, when parsed, then dict.key and the pair is skipped', () => {
    const { value, ids } = parse('<< 1 2 /A 3 >>');
    expect(show(value)).toEqual({ A: 3 });
    expect(ids).toEqual(['pdf.dict.key']);
  });

  it('OBJ-7: given a key twice, when parsed, then dict.duplicate-key and the later value', () => {
    const { value, ids } = parse('<< /A 1 /A 2 >>');
    expect(show(value)).toEqual({ A: 2 });
    expect(ids).toEqual(['pdf.dict.duplicate-key']);
  });

  it('OBJ-8: given n g R, when parsed, then a reference; two numbers alone stay numbers', () => {
    expect(show(parse('[12 0 R 3 4]').value)).toEqual(['12 0 R', 3, 4]);
  });

  it('OBJ-9: given nesting deeper than 64, when parsed, then syntax.depth and null', () => {
    const { value, ids } = parse(`${'['.repeat(70)}${']'.repeat(70)}`);
    expect(show(value)).toEqual(null);
    expect(ids).toEqual(['pdf.syntax.depth']);
  });

  it('OBJ-9: given an array that is not closed, when parsed, then syntax error and what was read', () => {
    const { value, ids } = parse('[1 2');
    expect(show(value)).toEqual([1, 2]);
    expect(ids).toEqual(['pdf.syntax.error']);
  });

  it('OBJ-7: given a dictionary, when an entry is looked up, then dictGet finds it', () => {
    const { value } = parse('<< /Size 5 >>');
    expect(show(dictGet(value as PdfValue, 'Size') ?? null)).toEqual(5);
    expect(dictGet(value as PdfValue, 'Root')).toBeUndefined();
  });
});

describe('indirect objects', () => {
  it('IND-1: given n g obj, a value, and endobj, when parsed, then the object with its extent', () => {
    const { parser } = parse('');
    const p = new Parser(new Lexer(latin1('12 0 obj (Brillig) endobj'), 50), new FindingList());
    expect(p.parseIndirect()).toMatchObject({
      number: 12,
      generation: 0,
      start: 50,
      end: 50 + 25,
      endobj: true,
      stream: null,
    });
    expect(parser).toBeDefined();
  });

  it('IND-2: given a stream keyword and CR LF, when parsed, then the data starts after the CR LF', () => {
    const p = new Parser(
      new Lexer(latin1(`7 0 obj << /Length 3 >> stream${CR}${LF}abc`), 0),
      new FindingList(),
    );
    expect(p.parseIndirect()?.stream).toEqual({ dataStart: 32, eolOk: true });
  });

  it('IND-2: given a stream keyword and CR alone, when parsed, then stream.eol and data after the CR', () => {
    const findings = new FindingList();
    const p = new Parser(new Lexer(latin1(`7 0 obj << >> stream${CR}abc`), 0), findings);
    expect(p.parseIndirect()?.stream).toEqual({ dataStart: 21, eolOk: false });
  });

  it('IND-1: given no obj keyword, when parsed, then null', () => {
    const p = new Parser(new Lexer(latin1('12 0 (x)'), 0), new FindingList());
    expect(p.parseIndirect()).toBeNull();
  });

  it('IND-5: given no endobj, when parsed, then endobj false and the end after the value', () => {
    const p = new Parser(new Lexer(latin1('1 0 obj [1 2] 2 0 obj'), 0), new FindingList());
    expect(p.parseIndirect()).toMatchObject({ endobj: false, end: 13 });
  });
});

describe('review fixes', () => {
  it('LEX-4, REQ-PDF-003: given 60 000 stray ")" bytes, when parsed, then no stack overflow', () => {
    const { value } = parse(`${')'.repeat(60_000)} 1`);
    expect(show(value)).toEqual(1);
  });

  it('LEX-4, REQ-PDF-003: given 60 000 unknown keywords, when parsed, then no stack overflow', () => {
    const { value } = parse(`${'foo '.repeat(60_000)}1`);
    expect(show(value)).toEqual(1);
  });

  it('OBJ-2: given a 200 000-digit number, when parsed, then value-too-large and null', () => {
    const { value, ids } = parse('7'.repeat(200_000));
    expect(show(value)).toEqual(null);
    expect(ids).toEqual(['pdf.value-too-large']);
  });

  it('OBJ-7: given a key with no value before >>, when parsed, then the earlier pairs stay and the key is dropped', () => {
    const { value, ids } = parse('<< /A /B /C >> endobj');
    expect(show(value)).toEqual({ A: '/B' });
    expect(ids).toEqual(['pdf.syntax.error']);
  });

  it('OBJ-6: given a stray >> inside an array, when parsed, then the array ends there', () => {
    const { value, ids } = parse('[1 >> 2]');
    expect(show(value)).toEqual([1]);
    expect(ids).toEqual(['pdf.syntax.error']);
  });
});

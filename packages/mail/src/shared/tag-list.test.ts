import { describe, expect, it } from 'vitest';
import { parseTagList } from './tag-list.ts';

describe('tag lists (RFC 6376 §3.2)', () => {
  it('DKIM-2: given tags with whitespace around names, =, and ;, when parsed, then names and values are trimmed', () => {
    const r = parseTagList(' v=1; a = rsa-sha256 ;\r\n\td=example.com; ');
    expect([...r.tags]).toEqual([
      ['v', '1'],
      ['a', 'rsa-sha256'],
      ['d', 'example.com'],
    ]);
    expect(r.errors).toEqual([]);
  });

  it('DKIM-2: given whitespace inside a value, when parsed, then it is kept', () => {
    expect(parseTagList('n=a  b').tags.get('n')).toBe('a  b');
  });

  it('DKIM-2: given an empty value, when parsed, then the tag is present with an empty value', () => {
    expect(parseTagList('p=; v=1').tags.get('p')).toBe('');
  });

  it('DKIM-2: given a duplicate tag, when parsed, then it is reported', () => {
    expect(parseTagList('a=1; b=2; a=3').duplicates).toEqual(['a']);
  });

  it('DKIM-2: given tag names in different case, when parsed, then they are different tags', () => {
    expect([...parseTagList('a=1; A=2').tags.keys()]).toEqual(['a', 'A']);
  });

  it('DKIM-2: given a spec without = or an invalid name, when parsed, then an error is reported', () => {
    expect(parseTagList('v=1; oops; 9x=1').errors).toHaveLength(2);
  });

  it('DKIM-2: given a control character in a value, when parsed, then an error is reported', () => {
    expect(parseTagList('a=b\u0001c').errors).toHaveLength(1);
  });

  it('DKIM-2: given VT, FF, or NBSP around a value or name, when parsed, then it is an error, not trimmed', () => {
    expect(parseTagList('a=b\u000b').errors).toHaveLength(1);
    expect(parseTagList('a=b\u000c').errors).toHaveLength(1);
    expect(parseTagList(' v=1').errors).toHaveLength(1);
  });
});

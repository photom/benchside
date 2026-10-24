import { describe, expect, it } from 'vitest';
import { splitHeaders } from './headers.ts';

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array, r: { start: number; end: number }) =>
  new TextDecoder().decode(b.subarray(r.start, r.end));

describe('header block', () => {
  it('IN-5: given headers then an empty line, when split, then the body starts after the empty line', () => {
    const input = bytes('From: a@example.com\r\nSubject: hi\r\n\r\nbody\r\n');
    const { headers, body } = splitHeaders(input);
    expect(headers.map((h) => h.name)).toEqual(['From', 'Subject']);
    expect(body && text(input, body)).toBe('body\r\n');
  });

  it('IN-5: given no empty line, when split, then the whole input is headers and body is null', () => {
    const { headers, body } = splitHeaders(bytes('From: a@example.com\r\nTo: b@example.com\r\n'));
    expect(headers).toHaveLength(2);
    expect(body).toBeNull();
  });

  it('IN-6: given a folded field, when split, then raw covers all lines and value is unfolded', () => {
    const input = bytes('Subject: one\r\n two\r\n\tthree\r\nTo: b\r\n\r\n');
    const [subject] = splitHeaders(input).headers;
    expect(subject && text(input, subject.raw)).toBe('Subject: one\r\n two\r\n\tthree\r\n');
    expect(subject?.value).toBe(' one two\tthree');
  });

  it('IN-6: given field names in mixed case, when split, then lname is lowercase and name is as written', () => {
    const [field] = splitHeaders(bytes('DKIM-Signature: v=1\r\n\r\n')).headers;
    expect(field?.name).toBe('DKIM-Signature');
    expect(field?.lname).toBe('dkim-signature');
  });

  it('IN-6: given a line without a colon, when split, then it is kept with an empty lname and input.malformed-header is reported', () => {
    const { headers, findings } = splitHeaders(bytes('From: a\r\ngarbage line\r\nTo: b\r\n\r\n'));
    expect(headers.map((h) => h.lname)).toEqual(['from', '', 'to']);
    expect(findings).toEqual([
      expect.objectContaining({
        id: 'input.malformed-header',
        severity: 'warning',
        evidence: [{ kind: 'header', index: 1 }],
      }),
    ]);
  });

  it('IN-6: given a continuation line before any field, when split, then it is treated as malformed', () => {
    const { headers, findings } = splitHeaders(bytes(' leading\r\nFrom: a\r\n\r\n'));
    expect(headers.map((h) => h.lname)).toEqual(['', 'from']);
    expect(findings.map((f) => f.id)).toEqual(['input.malformed-header']);
  });

  it('IN-6: given a UTF-8 value, when split, then value is decoded as UTF-8', () => {
    const [field] = splitHeaders(bytes('Subject: héllo ✓\r\n\r\n')).headers;
    expect(field?.value).toBe(' héllo ✓');
  });

  it('given empty input, when split, then there are no fields and body is null', () => {
    const { headers, body, findings } = splitHeaders(new Uint8Array());
    expect(headers).toEqual([]);
    expect(body).toBeNull();
    expect(findings).toEqual([]);
  });

  it('IN-5: given an empty line first, when split, then there are no fields and the body is the rest', () => {
    const input = bytes('\r\nbody');
    const { headers, body } = splitHeaders(input);
    expect(headers).toEqual([]);
    expect(body && text(input, body)).toBe('body');
  });
});

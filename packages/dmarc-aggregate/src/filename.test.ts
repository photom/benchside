import { describe, expect, it } from 'vitest';
import { compareFilename, parseFilename } from './filename.ts';

describe('Attachment file names (INP-8..10)', () => {
  it('INP-8: given a name with four parts, when parsed, then gives receiver, domain, timestamps, and extension', () => {
    expect(parseFilename('mail.example!example.com!1700000000!1700086399.xml.gz')).toEqual({
      receiver: 'mail.example',
      policyDomain: 'example.com',
      begin: 1700000000,
      end: 1700086399,
      uniqueId: null,
      extension: 'xml.gz',
    });
  });

  it('INP-8: given a name with a unique ID, when parsed, then gives it', () => {
    expect(parseFilename('r.example!example.org!1!2!abc123.xml')).toMatchObject({
      uniqueId: 'abc123',
      extension: 'xml',
    });
  });

  it('INP-8: given a path, when parsed, then only the last segment is used', () => {
    expect(parseFilename('2026/11/r!d.example!1!2.xml')?.receiver).toBe('r');
    expect(parseFilename('a\\b\\r!d.example!1!2.xml')?.receiver).toBe('r');
  });

  it('INP-8: given a name without an extension, when parsed, then the extension is empty', () => {
    expect(parseFilename('r!d!1!2')?.extension).toBe('');
  });

  it('INP-8: given names that do not follow the grammar, when parsed, then null', () => {
    for (const name of [
      'report.xml',
      'r!d!1.xml',
      'r!d!1!2!u!v.xml',
      'r!d!x!2.xml',
      'r!d!1!.xml',
      'r!d!-1!2.xml',
      '!!1!2.xml',
      'r!!1!2.xml',
      'r!d!1!2!.xml',
      'r!d!12345678901234567!2.xml',
      '',
    ]) {
      expect(parseFilename(name), name).toBeNull();
    }
  });

  it('INP-9: given a name that matches the content, when compared, then no part differs', () => {
    const f = parseFilename('r!Example.COM.!10!20.xml');
    expect(f && compareFilename(f, { policyDomain: 'example.com', begin: 10, end: 20 })).toEqual(
      [],
    );
  });

  it('INP-9: given a name whose domain and timestamps differ, when compared, then lists those parts', () => {
    const f = parseFilename('r!other.example!11!21.xml');
    expect(f && compareFilename(f, { policyDomain: 'example.com.', begin: 10, end: 20 })).toEqual([
      'policy-domain',
      'begin',
      'end',
    ]);
  });

  it('INP-9: given content without begin or end, when compared, then those parts are not compared', () => {
    const f = parseFilename('r!example.com!11!21.xml');
    expect(
      f && compareFilename(f, { policyDomain: 'example.com', begin: null, end: null }),
    ).toEqual([]);
  });
});

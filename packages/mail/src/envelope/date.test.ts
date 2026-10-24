import { describe, expect, it } from 'vitest';
import { parseDateTime } from './date.ts';

const iso = (s: string) => parseDateTime(s)?.toISOString() ?? null;

describe('RFC 5322 date-time (§3.3, §4.3)', () => {
  it('ENV-3: given a full date-time with a numeric zone, when parsed, then it is converted to UTC', () => {
    expect(iso('Sat, 24 Oct 2026 09:03:18 +0900')).toBe('2026-10-24T00:03:18.000Z');
  });

  it('ENV-3: given a trailing zone comment and no day name, when parsed, then the comment is ignored', () => {
    expect(iso(' 23 Oct 2026 17:03:19 -0700 (PDT)')).toBe('2026-10-24T00:03:19.000Z');
  });

  it('ENV-3: given no seconds, when parsed, then seconds are zero', () => {
    expect(iso('1 Feb 2026 08:05 +0000')).toBe('2026-02-01T08:05:00.000Z');
  });

  it('ENV-3: given obsolete zones (GMT, EST, a military letter), when parsed, then they map to offsets', () => {
    expect(iso('1 Feb 2026 08:00:00 GMT')).toBe('2026-02-01T08:00:00.000Z');
    expect(iso('1 Feb 2026 08:00:00 EST')).toBe('2026-02-01T13:00:00.000Z');
    expect(iso('1 Feb 2026 08:00:00 Z')).toBe('2026-02-01T08:00:00.000Z');
  });

  it('ENV-3: given a two-digit year, when parsed, then 00-49 is 20xx and 50-99 is 19xx', () => {
    expect(iso('1 Feb 26 08:00:00 +0000')).toBe('2026-02-01T08:00:00.000Z');
    expect(iso('1 Feb 99 08:00:00 +0000')).toBe('1999-02-01T08:00:00.000Z');
  });

  it('ENV-3: given an invalid date or text, when parsed, then there is no time', () => {
    expect(parseDateTime('31 Feb 2026 08:00:00 +0000')).toBeNull();
    expect(parseDateTime('25 Foo 2026 08:00:00 +0000')).toBeNull();
    expect(parseDateTime('soon')).toBeNull();
    expect(parseDateTime('')).toBeNull();
  });

  it('ENV-3: given UTC or another unknown alphabetic zone, when parsed, then it counts as -0000', () => {
    expect(iso('1 Feb 2026 08:00:00 UTC')).toBe('2026-02-01T08:00:00.000Z');
    expect(iso('1 Feb 2026 08:00:00 CEST')).toBe('2026-02-01T08:00:00.000Z');
  });

  it('ENV-3: given no zone or a four-digit year before 1900, when parsed, then there is no time', () => {
    expect(parseDateTime('1 Feb 2026 08:00:00')).toBeNull();
    expect(parseDateTime('1 Jan 0026 00:00:00 +0000')).toBeNull();
  });
});

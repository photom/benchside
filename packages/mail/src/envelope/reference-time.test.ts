import { describe, expect, it } from 'vitest';
import type { HeaderField } from '../message/headers.ts';
import type { ParsedReceived } from './received.ts';
import { referenceTime } from './reference-time.ts';

const NOW = new Date('2026-10-25T00:00:00Z');
const received = (field: number, date?: string): ParsedReceived =>
  date ? { field, confidence: 'grammar', date: new Date(date) } : { field, confidence: 'none' };
const dateField = (index: number, value: string): HeaderField => ({
  index,
  name: 'Date',
  lname: 'date',
  raw: { start: 0, end: 0 },
  value,
});

describe('reference time', () => {
  it('TIME-2: given a boundary with a date, when chosen by default, then the boundary date is used', () => {
    const r = referenceTime({
      mode: 'received',
      boundary: received(3, '2026-10-24T00:03:19Z'),
      headers: [],
      now: NOW,
    });
    expect(r.time.toISOString()).toBe('2026-10-24T00:03:19.000Z');
    expect(r.findings).toEqual([]);
  });

  it('TIME-2: given a boundary without a parsable date, when chosen by default, then now is used with envelope.time-fallback at the boundary', () => {
    const r = referenceTime({ mode: 'received', boundary: received(3), headers: [], now: NOW });
    expect(r.time).toBe(NOW);
    expect(r.findings).toEqual([
      expect.objectContaining({
        id: 'envelope.time-fallback',
        severity: 'info',
        evidence: [{ kind: 'header', index: 3 }],
      }),
    ]);
  });

  it('TIME-2: given no boundary, when chosen by default, then now is used without a finding', () => {
    const r = referenceTime({ mode: 'received', boundary: null, headers: [], now: NOW });
    expect(r.time).toBe(NOW);
    expect(r.findings).toEqual([]);
  });

  it('TIME-1: given mode date, when chosen, then the Date field is used', () => {
    const r = referenceTime({
      mode: 'date',
      boundary: null,
      headers: [dateField(5, ' Sat, 24 Oct 2026 09:03:18 +0900')],
      now: NOW,
    });
    expect(r.time.toISOString()).toBe('2026-10-24T00:03:18.000Z');
  });

  it('TIME-2: given mode date and an unparsable Date field, when chosen, then now is used with the finding at the Date field', () => {
    const r = referenceTime({
      mode: 'date',
      boundary: null,
      headers: [dateField(5, ' soon')],
      now: NOW,
    });
    expect(r.time).toBe(NOW);
    expect(r.findings[0]?.evidence).toEqual([{ kind: 'header', index: 5 }]);
  });

  it('TIME-1: given mode now, when chosen, then now is used', () => {
    expect(
      referenceTime({
        mode: 'now',
        boundary: received(0, '2020-01-01T00:00:00Z'),
        headers: [],
        now: NOW,
      }).time,
    ).toBe(NOW);
  });
});

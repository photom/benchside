import { describe, expect, it } from 'vitest';
import { splitHeaders } from '../message/headers.ts';
import { headerEntries } from './header-entries.ts';

const fields = (lines: string[]) =>
  splitHeaders(new TextEncoder().encode(`${lines.join('\r\n')}\r\n\r\nbody\r\n`)).headers;
const entries = (lines: string[], time: 'received' | 'date' | 'now' = 'received') =>
  headerEntries(fields(lines), time);

describe('header entries', () => {
  it('REP-9: given the fields each check reads, when listed, then each says which check reads it', () => {
    const e = entries([
      'Received: from a.example by mx.example.org; Mon, 5 Oct 2026 10:00:00 +0000',
      'Return-Path: <b@example.com>',
      'Authentication-Results: mx.example.org; spf=pass',
      'ARC-Seal: i=1; cv=none',
      'ARC-Message-Signature: i=1; h=subject',
      'ARC-Authentication-Results: i=1; mx.example.org; spf=pass',
      'DKIM-Signature: v=1; d=example.com; h=to',
      'From: a@example.com',
      'X-Other: unrelated',
    ]);
    expect(e.map((f) => [f.name, f.usedBy])).toEqual([
      ['Received', ['delivery']],
      ['Return-Path', ['delivery']],
      ['Authentication-Results', ['receiver']],
      ['ARC-Seal', ['arc']],
      ['ARC-Message-Signature', ['arc']],
      ['ARC-Authentication-Results', ['arc']],
      ['DKIM-Signature', ['dkim']],
      ['From', ['dkim', 'dmarc']],
      ['X-Other', []],
    ]);
  });

  it('REP-9: given fields a DKIM signature selects with h=, when listed, then they are read by DKIM, bottom-up and once per name', () => {
    const e = entries([
      'Subject: old',
      'Subject: new',
      'DKIM-Signature: v=1; d=example.com; h=From : subject; b=x',
      'From: a@example.com',
    ]);
    expect(e.map((f) => f.usedBy)).toEqual([[], ['dkim'], ['dkim'], ['dkim', 'dmarc']]);
  });

  it('REP-9: given fields an ARC message signature selects with h=, when listed, then they are read by ARC', () => {
    const e = entries([
      'ARC-Message-Signature: i=1; h=to:subject',
      'To: b@example.org',
      'Subject: hi',
    ]);
    expect(e.map((f) => f.usedBy)).toEqual([['arc'], ['arc'], ['arc']]);
  });

  it('REP-9: given a Date field, when the reference time mode is date, then only then it is read for delivery details', () => {
    const lines = ['Date: Mon, 5 Oct 2026 10:00:00 +0000'];
    expect(entries(lines, 'received')[0]?.usedBy).toEqual([]);
    expect(entries(lines, 'date')[0]?.usedBy).toEqual(['delivery']);
  });

  it('REP-9: given Received-SPF, when listed, then no check reads it', () => {
    expect(entries(['Received-SPF: pass'])[0]?.usedBy).toEqual([]);
  });

  it('REP-10: given a folded field a check reads, when listed, then its unfolded value is present; a field no check reads has none', () => {
    const [from, other] = entries(['From: Alice\r\n <a@example.com>', 'X-Other: hidden']);
    expect(from).toEqual({
      index: 0,
      name: 'From',
      usedBy: ['dmarc'],
      value: ' Alice <a@example.com>',
    });
    expect(other).toEqual({ index: 1, name: 'X-Other', usedBy: [] });
  });

  it('REP-9: given a signature whose h= does not parse, when listed, then only the signature itself is read', () => {
    const e = entries(['DKIM-Signature: v=1; h', 'X-Other: hi']);
    expect(e.map((f) => f.usedBy)).toEqual([['dkim'], []]);
  });

  it('REP-9: given two Date fields in date mode, when listed, then only the first is read', () => {
    const e = entries(
      ['Date: Mon, 5 Oct 2026 10:00:00 +0000', 'Date: Tue, 6 Oct 2026 10:00:00 +0000'],
      'date',
    );
    expect(e.map((f) => f.usedBy)).toEqual([['delivery'], []]);
  });

  it('REP-9: given h= with an empty name and a malformed line, when listed, then the line is read like the verifier selects it', () => {
    const e = entries(['DKIM-Signature: v=1; h=from::subject', 'From: a@example.com', 'no colon']);
    expect(e.map((f) => f.usedBy)).toEqual([['dkim'], ['dkim', 'dmarc'], ['dkim']]);
  });

  it('REP-9: given a DKIM signature, when listed, then From and the should-sign fields it leaves out are read by DKIM', () => {
    const e = entries([
      'DKIM-Signature: v=1; h=subject',
      'From: a@example.com',
      'To: b@example.org',
      'X-Other: c',
    ]);
    expect(e.map((f) => f.usedBy)).toEqual([['dkim'], ['dkim', 'dmarc'], ['dkim'], []]);
  });
});

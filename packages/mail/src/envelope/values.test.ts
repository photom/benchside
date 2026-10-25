import { describe, expect, it } from 'vitest';
import { splitHeaders } from '../message/headers.ts';
import { readReceived } from './received.ts';
import { envelopeValues } from './values.ts';

const DATE = '; Mon, 5 Oct 2026 10:00:00 +0000';

function values(lines: string[]) {
  const { headers } = splitHeaders(
    new TextEncoder().encode(`${lines.join('\r\n')}\r\n\r\nbody\r\n`),
  );
  const [boundary = null] = readReceived(headers).received;
  return envelopeValues(headers, boundary);
}

describe('envelope values', () => {
  it('ENV-11, ENV-12, ENV-15: given a boundary Received field, when read, then client IP and HELO come from it with their sources', () => {
    const { envelope } = values([
      `Received: from mx.example.net (mx.example.net [192.0.2.1]) by mx.example.org with ESMTP${DATE}`,
    ]);
    expect(envelope.clientIp).toEqual({ value: '192.0.2.1', source: { field: 0, rule: 'ENV-11' } });
    expect(envelope.helo).toEqual({
      value: 'mx.example.net',
      source: { field: 0, rule: 'ENV-12' },
    });
  });

  it('ENV-13: given Return-Path with an address, when read, then MAIL FROM is the address between the angle brackets', () => {
    const { envelope } = values(['Return-Path: (bounce) < bounce@example.com > ']);
    expect(envelope.mailFrom).toEqual({
      value: 'bounce@example.com',
      source: { field: 0, rule: 'ENV-13' },
    });
  });

  it('ENV-13: given Return-Path <>, when read, then MAIL FROM is the null reverse-path', () => {
    expect(values(['Return-Path: <>']).envelope.mailFrom?.value).toBe('');
  });

  it('ENV-13: given Return-Path without angle brackets, when read, then MAIL FROM is the trimmed value', () => {
    expect(values(['Return-Path:  bounce@example.com ']).envelope.mailFrom?.value).toBe(
      'bounce@example.com',
    );
  });

  it('ENV-13: given two Return-Path fields, when read, then the topmost is used with envelope.multiple-return-path', () => {
    const r = values(['Return-Path: <a@example.com>', 'Return-Path: <b@example.com>']);
    expect(r.envelope.mailFrom?.value).toBe('a@example.com');
    expect(r.findings).toEqual([
      expect.objectContaining({
        id: 'envelope.multiple-return-path',
        severity: 'warning',
        evidence: [
          { kind: 'header', index: 0 },
          { kind: 'header', index: 1 },
        ],
      }),
    ]);
  });

  it('ENV-11..13: given no Received or Return-Path, when read, then no values are found', () => {
    expect(values(['From: a@example.com'])).toEqual({ envelope: {}, findings: [] });
  });
});

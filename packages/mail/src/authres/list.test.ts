import { describe, expect, it } from 'vitest';
import { chooseBoundary } from '../envelope/boundary.ts';
import { readReceived } from '../envelope/received.ts';
import { splitHeaders } from '../message/headers.ts';
import { listReceiverResults } from './list.ts';

const DATE = '; Mon, 5 Oct 2026 10:00:00 +0000';
const RECEIVED_INTERNAL = `Received: by 2001:db8::5 with SMTP id abc${DATE}`;
const RECEIVED_BOUNDARY = `Received: from out.example.com (out.example.com. [192.0.2.1]) by mx.example.org with ESMTPS id x1${DATE}`;
const RECEIVED_SENDER = `Received: from client.example.com (client.example.com [198.51.100.9]) by out.example.com with ESMTP id y2${DATE}`;
const AR = (id: string) =>
  `Authentication-Results: ${id}; spf=pass smtp.mailfrom=bounce@example.com`;

function list(lines: string[], userBoundary?: number) {
  const { headers } = splitHeaders(
    new TextEncoder().encode(`${lines.join('\r\n')}\r\n\r\nbody\r\n`),
  );
  const { received } = readReceived(headers);
  const { boundary } = chooseBoundary(received, userBoundary);
  return listReceiverResults(headers, received, boundary);
}

describe('receiver results: trust and listing', () => {
  it('AR-4: given results above the boundary Received, when listed, then they are trusted', () => {
    const { results, findings } = list([
      AR('anything.example'),
      RECEIVED_BOUNDARY,
      'From: a@example.com',
    ]);
    expect(results).toEqual([expect.objectContaining({ field: 0, trusted: true })]);
    expect(findings).toEqual([]);
  });

  it('AR-4: given results just below the boundary with authserv-id equal to its by host, when listed, then they are trusted', () => {
    const { results } = list([RECEIVED_BOUNDARY, AR('mx.example.org'), 'From: a@example.com']);
    expect(results).toEqual([expect.objectContaining({ field: 1, trusted: true })]);
  });

  it('AR-4: given results just below the boundary with another authserv-id, when listed, then they are untrusted with authres.untrusted', () => {
    const { results, findings } = list([
      RECEIVED_BOUNDARY,
      AR('mx.attacker.example'),
      'From: a@example.com',
    ]);
    expect(results).toEqual([expect.objectContaining({ field: 1, trusted: false })]);
    expect(findings).toEqual([
      expect.objectContaining({
        id: 'authres.untrusted',
        severity: 'info',
        evidence: [{ kind: 'header', index: 1 }],
      }),
    ]);
  });

  it('AR-4: given results below the next Received, when listed, then they are untrusted even with a matching authserv-id', () => {
    const { results } = list([RECEIVED_BOUNDARY, RECEIVED_SENDER, AR('mx.example.org')]);
    expect(results).toEqual([expect.objectContaining({ field: 2, trusted: false })]);
  });

  it('AR-4: given authserv-id in different case, when listed, then it still matches', () => {
    const { results } = list([RECEIVED_BOUNDARY, AR('MX.Example.ORG')]);
    expect(results[0]?.trusted).toBe(true);
  });

  it('AR-4: given a boundary chosen by the user, when listed, then trust follows that boundary', () => {
    // Field 1 is the sender's own hop; with it as the boundary, out.example.com is the trusted host.
    const { results } = list([RECEIVED_BOUNDARY, RECEIVED_SENDER, AR('out.example.com')], 1);
    expect(results[0]?.trusted).toBe(true);
  });

  it('AR-4: given no Received fields, when listed, then every result is untrusted', () => {
    const { results } = list([AR('mx.example.org'), 'From: a@example.com']);
    expect(results).toEqual([expect.objectContaining({ trusted: false })]);
  });

  it('ENV-16: given a sender with HELO "by" and a forged result claiming authserv-id "by", when listed, then it is untrusted', () => {
    const { results } = list([
      `Received: from by (attacker.example [203.0.113.5]) by mx.example.org with ESMTP${DATE}`,
      'Authentication-Results: by; spf=pass smtp.mailfrom=a@bank.example; dmarc=pass header.from=bank.example',
    ]);
    expect(results[0]?.trusted).toBe(false);
  });

  it('AR-10: given several results, when listed, then they are in header order with field index, authserv-id, and entries', () => {
    const { results } = list([
      AR('a.example'),
      RECEIVED_BOUNDARY,
      AR('mx.example.org'),
      'From: a@example.com',
    ]);
    expect(results).toEqual([
      {
        field: 0,
        trusted: true,
        authservId: 'a.example',
        entries: [
          { method: 'spf', result: 'pass', props: { 'smtp.mailfrom': 'bounce@example.com' } },
        ],
      },
      {
        field: 2,
        trusted: true,
        authservId: 'mx.example.org',
        entries: [
          { method: 'spf', result: 'pass', props: { 'smtp.mailfrom': 'bounce@example.com' } },
        ],
      },
    ]);
  });

  it('AR-1: given an unparsable entry, when listed, then authres.syntax is passed on', () => {
    const { findings } = list([
      RECEIVED_BOUNDARY,
      'Authentication-Results: mx.example.org; dkim pass',
    ]);
    expect(findings.map((f) => f.id)).toEqual(['authres.syntax']);
  });

  it('REQ-MAIL-008: given a Gmail-style message, when listed, then mx results below its Received are trusted', () => {
    const { results } = list([
      'Delivered-To: user@example.org',
      RECEIVED_INTERNAL,
      'Return-Path: <bounce@example.com>',
      RECEIVED_BOUNDARY,
      'Authentication-Results: mx.example.org; dkim=pass header.i=@example.com header.s=sel1 header.b=AbCdEfGh; spf=pass (mx.example.org: domain of bounce@example.com designates 192.0.2.1 as permitted sender) smtp.mailfrom=bounce@example.com; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=example.com',
      'From: News <news@example.com>',
    ]);
    expect(results).toEqual([
      expect.objectContaining({ field: 4, trusted: true, authservId: 'mx.example.org' }),
    ]);
    expect(results[0]?.entries.map((e) => `${e.method}=${e.result}`)).toEqual([
      'dkim=pass',
      'spf=pass',
      'dmarc=pass',
    ]);
  });
});

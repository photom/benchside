import { describe, expect, it } from 'vitest';
import type { HeaderField } from '../message/headers.ts';
import { parseReceived, readReceived } from './received.ts';

const DATE = '; Mon, 5 Oct 2026 10:00:00 +0000';

describe('Received: grammar', () => {
  it('ENV-1: given from Domain (Domain [IP]) by Domain with ESMTP id X for <a>; date, when parsed, then confidence is grammar with HELO, client IP, and by', () => {
    const r = parseReceived(
      3,
      ` from mx.example.net (mail.example.net [192.0.2.1])\r\n\tby mx.example.org with ESMTPS id ABC123 for <user@example.org>${DATE}`,
    );
    expect(r).toMatchObject({
      field: 3,
      confidence: 'grammar',
      rule: 'ENV-1',
      helo: 'mx.example.net',
      clientIp: '192.0.2.1',
      by: 'mx.example.org',
    });
  });

  it('ENV-1: given a comment between clauses, when parsed, then the grammar still succeeds', () => {
    const r = parseReceived(
      0,
      ` from mx.example.net (mx.example.net [192.0.2.1]) (using TLSv1.3 with cipher X (256/256 bits)) by mx.example.org (Postfix) with ESMTPS id 4X${DATE}`,
    );
    expect(r).toMatchObject({
      confidence: 'grammar',
      helo: 'mx.example.net',
      clientIp: '192.0.2.1',
    });
  });

  it('ENV-1: given an address-literal as the from domain, when parsed, then HELO is the literal and the IP comes from TCP-info', () => {
    const r = parseReceived(
      0,
      ` from [192.0.2.9] ([192.0.2.1]) by mx.example.org with SMTP${DATE}`,
    );
    expect(r).toMatchObject({ confidence: 'grammar', helo: '[192.0.2.9]', clientIp: '192.0.2.1' });
  });

  it('ENV-1: given a from clause without TCP-info, when parsed, then the grammar fails', () => {
    const r = parseReceived(0, ` from mx.example.net by mx.example.org with SMTP${DATE}`);
    expect(r.confidence).not.toBe('grammar');
  });

  it('ENV-1: given keywords in mixed case, when parsed, then they are recognized', () => {
    const r = parseReceived(
      0,
      ` FROM mx.example.net (mx.example.net [192.0.2.1]) By mx.example.org WITH ESMTP${DATE}`,
    );
    expect(r).toMatchObject({ confidence: 'grammar', by: 'mx.example.org' });
  });
});

describe('Received: heuristics', () => {
  it('ENV-2 H2: given the Exim form, when parsed, then HELO comes from helo= and confidence is heuristic', () => {
    const r = parseReceived(
      0,
      ` from host.example ([192.0.2.1] helo=mx.example.net) by mx.example.org with esmtps (Exim 4.96)${DATE}`,
    );
    expect(r).toMatchObject({
      confidence: 'heuristic',
      rule: 'H2',
      helo: 'mx.example.net',
      clientIp: '192.0.2.1',
    });
  });

  it('ENV-2 H3: given the Microsoft form with a bare IP, when parsed, then HELO and client IP are found', () => {
    const r = parseReceived(
      0,
      ` from mail.example.net (192.0.2.1) by mx.example.org (192.0.2.2) with Microsoft SMTP Server (version=TLS1_2, cipher=X) id 15.20.1${DATE}`,
    );
    expect(r).toMatchObject({
      confidence: 'heuristic',
      rule: 'H3',
      helo: 'mail.example.net',
      clientIp: '192.0.2.1',
      by: 'mx.example.org',
    });
  });

  it('ENV-2 H4: given the Gmail form with a trailing dot, when parsed, then HELO and client IP are found', () => {
    const r = parseReceived(
      0,
      ` from mx.example.net (mx.example.net. [192.0.2.1])\r\n        by mx.example.org with ESMTPS id x1si2 for <user@example.org>\r\n        (version=TLS1_3 cipher=TLS_AES_256_GCM_SHA384 bits=256/256)${DATE}`,
    );
    expect(r).toMatchObject({
      confidence: 'heuristic',
      rule: 'H4',
      helo: 'mx.example.net',
      clientIp: '192.0.2.1',
      by: 'mx.example.org',
    });
  });

  it('ENV-2 H1: given the Postfix form when the rest of the field breaks the grammar, when parsed, then H1 finds HELO and client IP', () => {
    // No date: the grammar needs "; date-time".
    const r = parseReceived(
      0,
      ' from mx.example.net (rdns.example.net [192.0.2.1]) by mx.example.org with ESMTP',
    );
    expect(r).toMatchObject({
      confidence: 'heuristic',
      rule: 'H1',
      helo: 'mx.example.net',
      clientIp: '192.0.2.1',
    });
  });

  it('ENV-2 H5: given any literal in the from clause, when parsed, then the client IP is that literal', () => {
    const r = parseReceived(
      0,
      ` from unknown (HELO bad_name) ([192.0.2.1]) by mx.example.org${DATE}`,
    );
    expect(r).toMatchObject({
      confidence: 'heuristic',
      rule: 'H5',
      helo: 'unknown',
      clientIp: '192.0.2.1',
    });
  });

  it('ENV-6: given an IPv6 literal in the from clause, when parsed, then the client IP is in RFC 5952 form', () => {
    const r = parseReceived(
      0,
      ` from mx.example.net (mx.example.net [IPv6:2001:DB8:0:0:0:0:0:1]) by mx.example.org with ESMTP${DATE}`,
    );
    expect(r.clientIp).toBe('2001:db8::1');
  });

  it('ENV-4: given no from clause, when read, then confidence is none and envelope.unparsed-received is reported', () => {
    const { received, findings } = readReceived([
      field(2, 'Received', ` by 2001:db8::5 with SMTP id abc${DATE}`),
    ]);
    expect(received).toEqual([expect.objectContaining({ field: 2, confidence: 'none' })]);
    expect(findings).toEqual([
      expect.objectContaining({
        id: 'envelope.unparsed-received',
        severity: 'info',
        evidence: [{ kind: 'header', index: 2 }],
      }),
    ]);
  });

  it('ENV-16: given a field that only heuristics parse, when parsed, then by is still the first atom after by', () => {
    const r = parseReceived(
      0,
      ` from host.example ([192.0.2.1] helo=mx.example.net) by mx.example.org${DATE}`,
    );
    expect(r.by).toBe('mx.example.org');
  });

  it('ENV-16: given a field with confidence none, when parsed, then by is still found', () => {
    expect(parseReceived(0, ` by mx.example.org with SMTP${DATE}`)).toMatchObject({
      confidence: 'none',
      by: 'mx.example.org',
    });
  });

  it('ENV-16: given no by clause, when parsed, then by is absent', () => {
    expect(
      parseReceived(0, ` from mx.example.net (mx.example.net [192.0.2.1])${DATE}`).by,
    ).toBeUndefined();
  });

  it('given header fields of other kinds, when read, then only Received fields are parsed, in order', () => {
    const { received } = readReceived([
      field(0, 'Received', ` from a.example (a.example [192.0.2.1]) by b.example with SMTP${DATE}`),
      field(1, 'Subject', ' from x (x [192.0.2.2]) by y'),
      field(2, 'RECEIVED', ` from c.example (c.example [192.0.2.3]) by d.example with SMTP${DATE}`),
    ]);
    expect(received.map((r) => r.field)).toEqual([0, 2]);
  });
});

describe('Received: by host', () => {
  it('ENV-16: given a sender whose HELO name is "by", when parsed, then by is the receiving host, not the HELO', () => {
    const r = parseReceived(
      0,
      ` from by (attacker.example [203.0.113.5]) by mx.example.org with ESMTP${DATE}`,
    );
    expect(r.by).toBe('mx.example.org');
  });

  it('ENV-16: given a heuristic field whose HELO name is "by", when parsed, then by is the receiving host', () => {
    const r = parseReceived(
      0,
      ` from by (attacker.example. [203.0.113.5]) by mx.example.org with ESMTPS${DATE}`,
    );
    expect(r.by).toBe('mx.example.org');
  });
});

describe('Received: malformed input', () => {
  it('given an empty value, when parsed, then confidence is none without throwing', () => {
    expect(parseReceived(0, '')).toMatchObject({ confidence: 'none' });
  });

  it('given an unclosed comment or literal, when parsed, then it does not throw', () => {
    expect(() => parseReceived(0, ' from x (y [192.0.2.1')).not.toThrow();
    expect(() => parseReceived(0, ' from x ([192.0.2.1 by y')).not.toThrow();
    expect(() => parseReceived(0, ' from "x\\')).not.toThrow();
  });

  it('given deeply nested comments, when parsed, then it does not throw', () => {
    const deep = `${'('.repeat(10_000)}x${')'.repeat(10_000)}`;
    expect(parseReceived(0, ` from a ${deep} by b${DATE}`)).toMatchObject({ by: 'b' });
  });
});

function field(index: number, name: string, value: string): HeaderField {
  return { index, name, lname: name.toLowerCase(), raw: { start: 0, end: 0 }, value };
}

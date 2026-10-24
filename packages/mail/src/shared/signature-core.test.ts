import { describe, expect, it } from 'vitest';
import { signMessage } from '../../test/support/dkim-signer.ts';
import { rsaKey } from '../../test/support/keys.ts';
import { splitHeaders } from '../message/headers.ts';
import { decodeBase64 } from './base64.ts';
import { importDkimKey, verifySignature } from './crypto.ts';
import { headerHashData, selectHeaders, signatureFieldWithoutValue } from './signature-core.ts';
import { parseTagList } from './tag-list.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const block = (s: string) => {
  const bytes = enc.encode(s);
  return { bytes, ...splitHeaders(bytes) };
};

describe('signature core', () => {
  it('DKIM-14: given repeated names, when selected, then fields are taken bottom-up and extra names select nothing', () => {
    const m = block(
      'DKIM-Signature: x\r\nReceived: A\r\nReceived: B\r\nFrom: f\r\nReceived: C\r\n\r\n',
    );
    const sig = m.headers[0];
    if (!sig) throw new Error('no sig');
    const picked = selectHeaders(
      m.headers,
      ['received', 'from', 'received', 'received', 'received'],
      sig,
    );
    expect(picked.map((h) => h.value.trim())).toEqual(['C', 'f', 'B', 'A']);
  });

  it('DKIM-14: given h= in mixed case naming the signature itself, when selected, then the signature field is excluded', () => {
    const m = block('DKIM-Signature: x\r\nSubject: s\r\n\r\n');
    const sig = m.headers[0];
    if (!sig) throw new Error('no sig');
    expect(selectHeaders(m.headers, ['subject', 'dkim-signature'], sig).map((h) => h.name)).toEqual(
      ['Subject'],
    );
  });

  it('DKIM-14: given b= in the middle, folded, when removed, then only its value goes and there is no final CRLF', () => {
    const raw = enc.encode('DKIM-Signature: v=1; b=abc\r\n def ; bh=xyz; d=a\r\n');
    expect(dec.decode(signatureFieldWithoutValue(raw, 'b'))).toBe(
      'DKIM-Signature: v=1; b=; bh=xyz; d=a',
    );
  });

  it('DKIM-14: given b= last and a tag named bh before it, when removed, then bh is untouched', () => {
    const raw = enc.encode('DKIM-Signature: bh=xyz;\r\n\tb = abc\r\n');
    expect(dec.decode(signatureFieldWithoutValue(raw, 'b'))).toBe(
      'DKIM-Signature: bh=xyz;\r\n\tb =',
    );
  });

  for (const c of ['simple/simple', 'relaxed/relaxed'] as const) {
    it(`DKIM-14: given a message signed with c=${c}, when the hash data is rebuilt, then the signature verifies`, async () => {
      const key = await rsaKey(1024);
      const headers = [
        'From:  Alice <a@example.com>\r\n',
        'Subject: Hi\r\n\tthere\r\n',
        'To: b@example.org\r\n',
      ];
      const text = await signMessage({
        key,
        d: 'example.com',
        s: 'sel',
        headers,
        body: 'Hello\r\n',
        signed: [headers[0] as string, headers[1] as string, ''],
        h: 'from:subject:reply-to',
        c,
      });
      const m = block(text);
      const sig = m.headers[0];
      if (!sig) throw new Error('no sig');
      const tags = parseTagList(sig.value).tags;
      const selected = selectHeaders(m.headers, ['from', 'subject', 'reply-to'], sig);
      const data = headerHashData(
        m.bytes,
        selected,
        sig,
        c.startsWith('simple') ? 'simple' : 'relaxed',
      );
      const pub = await importDkimKey('rsa', decodeBase64(key.p) as Uint8Array, 'SHA-256');
      if (!pub.ok) throw new Error('import');
      expect(
        await verifySignature(pub, data, decodeBase64(tags.get('b') ?? '') as Uint8Array),
      ).toBe(true);
    });
  }

  it('DKIM-14: given a very long tag name, when the value is removed, then it does not crash', () => {
    const raw = enc.encode(`DKIM-Signature: ${'a'.repeat(300_000)}=1; b=x\r\n`);
    expect(dec.decode(signatureFieldWithoutValue(raw, 'b')).endsWith('; b=')).toBe(true);
  });

  it('DKIM-14: given a selected field without a final CRLF (header-only input), when hashed, then a CRLF is added', () => {
    const m = block('DKIM-Signature: b=x\r\nSubject: s');
    const [sig, subject] = m.headers;
    if (!sig || !subject) throw new Error('headers');
    expect(dec.decode(headerHashData(m.bytes, [subject], sig, 'simple'))).toBe(
      'Subject: s\r\nDKIM-Signature: b=',
    );
  });
});

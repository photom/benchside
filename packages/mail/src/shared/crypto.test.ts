import { describe, expect, it } from 'vitest';
import { ed25519Key, rsaKey } from '../../test/support/keys.ts';
import { decodeBase64 } from './base64.ts';
import { importDkimKey, verifySignature } from './crypto.ts';

const data = new TextEncoder().encode('header data');
const bytes = (b64: string) => decodeBase64(b64) as Uint8Array;

describe('DKIM keys and signatures', () => {
  it('DKIM-9: given an RSA key as SPKI, when imported, then it is usable and its size is known', async () => {
    const key = await rsaKey(2048);
    expect(await importDkimKey('rsa', bytes(key.p), 'SHA-256')).toMatchObject({
      ok: true,
      bits: 2048,
    });
  });

  it('DKIM-9: given an RSA key as PKCS#1 RSAPublicKey, when imported, then it is wrapped and usable', async () => {
    const key = await rsaKey(1024);
    expect(await importDkimKey('rsa', bytes(key.pkcs1 as string), 'SHA-256')).toMatchObject({
      ok: true,
      bits: 1024,
    });
  });

  it('DKIM-9: given a 32-byte Ed25519 key, when imported, then it is usable', async () => {
    const key = await ed25519Key();
    expect(await importDkimKey('ed25519', bytes(key.p), 'SHA-256')).toMatchObject({ ok: true });
  });

  it('DKIM-9: given bytes that are not a key, when imported, then it fails without throwing', async () => {
    expect(await importDkimKey('rsa', new Uint8Array([1, 2, 3]), 'SHA-256')).toEqual({ ok: false });
    expect(await importDkimKey('ed25519', new Uint8Array(31), 'SHA-256')).toEqual({ ok: false });
    expect(await importDkimKey('dsa', new Uint8Array(32), 'SHA-256')).toEqual({ ok: false });
  });

  it('DKIM-14: given RSA and Ed25519 signatures over data, when verified, then valid ones pass and changed data fails', async () => {
    const rsa = await rsaKey(1024);
    const rsaSig = new Uint8Array(
      await crypto.subtle.sign('RSASSA-PKCS1-v1_5', rsa.privateKey, data),
    );
    const rsaPub = await importDkimKey('rsa', bytes(rsa.p), 'SHA-256');
    if (!rsaPub.ok) throw new Error('import');
    expect(await verifySignature(rsaPub, data, rsaSig)).toBe(true);
    expect(await verifySignature(rsaPub, new TextEncoder().encode('other'), rsaSig)).toBe(false);

    const ed = await ed25519Key();
    const edSig = new Uint8Array(
      await crypto.subtle.sign(
        'Ed25519',
        ed.privateKey,
        await crypto.subtle.digest('SHA-256', data),
      ),
    );
    const edPub = await importDkimKey('ed25519', bytes(ed.p), 'SHA-256');
    if (!edPub.ok) throw new Error('import');
    expect(await verifySignature(edPub, data, edSig)).toBe(true);
    expect(await verifySignature(edPub, data, new Uint8Array(64))).toBe(false);
  });

  it('DKIM-9: given k= in upper case, when imported, then it is accepted', async () => {
    const key = await ed25519Key();
    expect(await importDkimKey('Ed25519', bytes(key.p), 'SHA-256')).toMatchObject({ ok: true });
  });
});

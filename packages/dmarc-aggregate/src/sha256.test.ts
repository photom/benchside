import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sha256 } from './sha256.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => {
  const h = new Sha256();
  h.update(b);
  return h.digest();
};

describe('Sha256 (XML-11, CMB-2)', () => {
  it('XML-11: given the FIPS 180-4 test messages, when hashed, then gives their digests', () => {
    expect(hex(enc(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(enc('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('XML-11: given a million bytes, when hashed, then gives the known digest', () => {
    expect(hex(new Uint8Array(1_000_000).fill(0x61))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('XML-11: given lengths around the block and padding edges, when hashed, then matches node:crypto', () => {
    for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
      expect(hex(b), `length ${n}`).toBe(createHash('sha256').update(b).digest('hex'));
    }
  });

  it('XML-11: given the same bytes in chunks of any size, when hashed, then the digest is the same', () => {
    const b = Uint8Array.from({ length: 3000 }, (_, i) => (i * 131 + 17) & 255);
    const want = createHash('sha256').update(b).digest('hex');
    let seed = 9;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let n = 0; n < 50; n++) {
      const h = new Sha256();
      for (let at = 0; at < b.length; ) {
        const len = rand() % 200;
        h.update(b.subarray(at, at + len));
        at += len;
      }
      expect(h.digest()).toBe(want);
    }
  });
});

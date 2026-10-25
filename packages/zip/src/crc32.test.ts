import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32.ts';

const ascii = (s: string) => new TextEncoder().encode(s);

describe('CRC-32', () => {
  it('EXT-4: given "123456789", when hashed, then gives the check value 0xCBF43926', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
  });

  it('EXT-4: given no bytes, when hashed, then gives 0', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('EXT-4: given bytes in two chunks, when hashed in steps, then equals hashing them at once', () => {
    expect(crc32(ascii('6789'), crc32(ascii('12345')))).toBe(0xcbf43926);
  });
});

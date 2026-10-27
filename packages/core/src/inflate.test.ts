import { deflateRawSync, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inflate } from './inflate.ts';

const text = new TextEncoder().encode('hello hello hello hello');

describe('bounded inflate', () => {
  it('0010: given zlib data, when inflated as deflate, then gives the content', async () => {
    expect(await inflate(deflateSync(text), 100, 'deflate')).toEqual({ kind: 'ok', bytes: text });
  });

  it('0010: given raw deflate data, when inflated as deflate-raw, then gives the content', async () => {
    expect(await inflate(deflateRawSync(text), 100, 'deflate-raw')).toEqual({
      kind: 'ok',
      bytes: text,
    });
  });

  it('0010: given output beyond the limit, when inflated, then exceeded', async () => {
    expect(await inflate(deflateSync(new Uint8Array(100_000)), 1000, 'deflate')).toEqual({
      kind: 'exceeded',
    });
  });

  it('0010: given bytes that are not zlib, when inflated as deflate, then error', async () => {
    expect(await inflate(Uint8Array.of(1, 2, 3, 4), 100, 'deflate')).toEqual({ kind: 'error' });
  });
});

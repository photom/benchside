import { describe, expect, it } from 'vitest';
import { blobSource, bytesSource, Reader } from './source.ts';

const counting = (bytes: Uint8Array) => {
  const reads: [number, number][] = [];
  const inner = bytesSource(bytes);
  return {
    reads,
    source: {
      byteLength: inner.byteLength,
      read: (o: number, n: number) => {
        reads.push([o, n]);
        return inner.read(o, n);
      },
    },
  };
};

describe('byte sources', () => {
  it('0007: given a Blob, when a range is read, then gives those bytes', async () => {
    const source = blobSource(new Blob([Uint8Array.from([1, 2, 3, 4, 5])]));
    expect(source.byteLength).toBe(5);
    expect([...(await source.read(1, 3))]).toEqual([2, 3, 4]);
  });

  it('0007: given a range outside the source, when read through the reader, then null', async () => {
    const reader = new Reader(bytesSource(new Uint8Array(10)));
    expect(await reader.bytes(8, 3)).toBeNull();
    expect(await reader.bytes(-1, 2)).toBeNull();
  });

  it('0007: given small reads close together, when read, then the source is read once', async () => {
    const { reads, source } = counting(Uint8Array.from({ length: 100 }, (_, i) => i));
    const reader = new Reader(source, 64);
    expect([...((await reader.bytes(10, 2)) ?? [])]).toEqual([10, 11]);
    expect([...((await reader.bytes(40, 2)) ?? [])]).toEqual([40, 41]);
    expect(reads).toEqual([[10, 64]]);
  });

  it('0007: given a read past the window, when read, then a new window starts there', async () => {
    const { reads, source } = counting(new Uint8Array(100));
    const reader = new Reader(source, 64);
    await reader.bytes(10, 2);
    await reader.bytes(80, 4);
    expect(reads).toEqual([
      [10, 64],
      [80, 20],
    ]);
  });
});

/** Random access to the archive's bytes (0007). */

export interface ByteSource {
  readonly byteLength: number;
  /** Resolves with exactly `byteLength` bytes; callers keep reads within the source. */
  read(offset: number, byteLength: number): Promise<Uint8Array>;
}

export function bytesSource(bytes: Uint8Array): ByteSource {
  return {
    byteLength: bytes.length,
    read: async (offset, byteLength) => bytes.subarray(offset, offset + byteLength),
  };
}

/** Reads a File or Blob range by range, without loading the rest. */
export function blobSource(blob: Blob): ByteSource {
  return {
    byteLength: blob.size,
    read: async (offset, byteLength) =>
      new Uint8Array(await blob.slice(offset, offset + byteLength).arrayBuffer()),
  };
}

const WINDOW = 1 << 20;

/** Serves small reads from one cached window, so many small reads become a few large ones. */
export class Reader {
  readonly source: ByteSource;
  private readonly windowSize: number;
  private start = 0;
  private window: Uint8Array = new Uint8Array();

  constructor(source: ByteSource, windowSize = WINDOW) {
    this.source = source;
    this.windowSize = windowSize;
  }

  get byteLength() {
    return this.source.byteLength;
  }

  /** The bytes at [offset, offset + byteLength), or null if any lie outside the source. */
  async bytes(offset: number, byteLength: number): Promise<Uint8Array | null> {
    if (offset < 0 || byteLength < 0 || offset + byteLength > this.byteLength) return null;
    const end = offset + byteLength;
    if (offset < this.start || end > this.start + this.window.length) {
      const size = Math.min(Math.max(byteLength, this.windowSize), this.byteLength - offset);
      this.window = await this.source.read(offset, size);
      this.start = offset;
    }
    return this.window.subarray(offset - this.start, end - this.start);
  }
}

export function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** NUM-1: a 64-bit little-endian value, or null above Number.MAX_SAFE_INTEGER. */
export function u64(v: DataView, at: number): number | null {
  const value = v.getBigUint64(at, true);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

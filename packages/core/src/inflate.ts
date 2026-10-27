/** Bounded decompression (0010). */
export type InflateResult =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'exceeded' }
  | { readonly kind: 'error' };

/**
 * Inflates with DecompressionStream, stopping as soon as the output passes `limit` bytes.
 * `deflate` is zlib-wrapped data (PDF FlateDecode); `deflate-raw` is bare deflate (ZIP method 8).
 */
export async function inflate(
  data: Uint8Array,
  limit: number,
  format: 'deflate' | 'deflate-raw',
): Promise<InflateResult> {
  // Stream the bytes as they are; wrapping them in a Blob would copy them.
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(data as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const stream = input.pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return { kind: 'exceeded' };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: 'error' };
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { kind: 'ok', bytes };
}

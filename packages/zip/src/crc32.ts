/** EXT-4: standard ZIP CRC-32 (APPNOTE 4.4.7), reflected polynomial 0xEDB88320. */
const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** Pass the previous result as `previous` to continue over another chunk. */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let c = ~previous >>> 0;
  for (const b of bytes) c = (TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return ~c >>> 0;
}

/** Number formatting for the views (zip-architecture.md#ui). */

export const hex = (n: number, width = 0) => n.toString(16).padStart(width, '0');

/** Offsets in decimal and hex: APPNOTE and hex editors use hex. */
export const offset = (n: number) => `${n} (0x${hex(n)})`;

export const crc = (n: number) => hex(n, 8);

export const bytesHex = (bytes: Uint8Array) => [...bytes].map((b) => hex(b, 2)).join(' ');

/** Rows per page in long tables. */
export const PAGE = 500;

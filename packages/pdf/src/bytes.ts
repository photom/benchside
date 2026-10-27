/** Byte searches shared by the readers. */
import { isWhite } from './lexer.ts';

const codes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** The first index of `needle` in `hay` at or after `from`, or -1. */
export function indexOf(hay: Uint8Array, needle: string, from = 0): number {
  const n = codes(needle);
  outer: for (let i = Math.max(0, from); i + n.length <= hay.length; i++) {
    for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

/** The last index of `needle` in `hay`, or -1. */
export function lastIndexOf(hay: Uint8Array, needle: string): number {
  const n = codes(needle);
  outer: for (let i = hay.length - n.length; i >= 0; i--) {
    for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

/** Index just past one end-of-line at `i` (CR LF, LF, or CR), or `i` when there is none. */
export function skipEol(bytes: Uint8Array, i: number): number {
  if (bytes[i] === 0x0d) return bytes[i + 1] === 0x0a ? i + 2 : i + 1;
  if (bytes[i] === 0x0a) return i + 1;
  return i;
}

/** MAP-2, LEX-3: true when `bytes` hold only white space and comments. */
export function isBlank(bytes: Uint8Array): boolean {
  let inComment = false;
  for (const c of bytes) {
    if (inComment) {
      if (c === 0x0d || c === 0x0a) inComment = false;
    } else if (c === 0x25) inComment = true;
    else if (!isWhite(c)) return false;
  }
  return true;
}

/** EOF-3: true when `bytes` hold only white space; a comment is not white space here. */
export const isWhiteOnly = (bytes: Uint8Array) => bytes.every((c) => isWhite(c));

/** MAP-2: the index of the first byte that is neither white space nor in a comment. */
export function firstNonBlank(bytes: Uint8Array): number {
  let inComment = false;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i] as number;
    if (inComment) {
      if (c === 0x0d || c === 0x0a) inComment = false;
    } else if (c === 0x25) inComment = true;
    else if (!isWhite(c)) return i;
  }
  return bytes.length;
}

/** Bytes as lowercase hex, two digits each. */
export const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

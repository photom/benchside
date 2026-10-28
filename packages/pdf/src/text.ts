/** Text strings (document.md: TXT-1..4). */

import type { PdfValue } from './parser.ts';
import type { Text } from './types.ts';

export type { Text };

/** TXT-3 */
export const MAX_TEXT = 65_536;

/** TXT-4 */
export const ENCRYPTED_TEXT: Text = { text: null, truncated: false };

const ESC = String.fromCharCode(0x1b);
const REPLACEMENT = String.fromCharCode(0xfffd);
// TXT-1: U+001B, a two-letter language code, an optional two-letter country code, U+001B.
const LANGUAGE_ESCAPE = new RegExp(`${ESC}[A-Za-z]{2,4}${ESC}`, 'g');
const utf16 = new TextDecoder('utf-16be');

// TXT-2: Table D.2 where PDFDocEncoding differs from Latin-1.
const DIFFERENT = new Map<number, number>([
  [0x18, 0x02d8],
  [0x19, 0x02c7],
  [0x1a, 0x02c6],
  [0x1b, 0x02d9],
  [0x1c, 0x02dd],
  [0x1d, 0x02db],
  [0x1e, 0x02da],
  [0x1f, 0x02dc],
  [0x80, 0x2022],
  [0x81, 0x2020],
  [0x82, 0x2021],
  [0x83, 0x2026],
  [0x84, 0x2014],
  [0x85, 0x2013],
  [0x86, 0x0192],
  [0x87, 0x2044],
  [0x88, 0x2039],
  [0x89, 0x203a],
  [0x8a, 0x2212],
  [0x8b, 0x2030],
  [0x8c, 0x201e],
  [0x8d, 0x201c],
  [0x8e, 0x201d],
  [0x8f, 0x2018],
  [0x90, 0x2019],
  [0x91, 0x201a],
  [0x92, 0x2122],
  [0x93, 0xfb01],
  [0x94, 0xfb02],
  [0x95, 0x0141],
  [0x96, 0x0152],
  [0x97, 0x0160],
  [0x98, 0x0178],
  [0x99, 0x017d],
  [0x9a, 0x0131],
  [0x9b, 0x0142],
  [0x9c, 0x0153],
  [0x9d, 0x0161],
  [0x9e, 0x017e],
  [0xa0, 0x20ac],
]);

const PDF_DOC: string[] = Array.from({ length: 256 }, (_, b) => {
  const mapped = DIFFERENT.get(b);
  if (mapped !== undefined) return String.fromCharCode(mapped);
  const ascii = b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e);
  const latin1 = b >= 0xa1 && b !== 0xad;
  return ascii || latin1 ? String.fromCharCode(b) : REPLACEMENT;
});

/** TXT-1..3 */
export function decodeText(bytes: Uint8Array): Text {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    // Enough bytes for the kept text and its language escapes; the rest is never decoded.
    const room = 2 + 4 * MAX_TEXT;
    const cut = bytes.length > room;
    const text = utf16.decode(bytes.subarray(2, room)).replace(LANGUAGE_ESCAPE, '');
    return keep(text, cut);
  }
  const n = Math.min(bytes.length, MAX_TEXT);
  let text = '';
  for (let i = 0; i < n; i++) text += PDF_DOC[bytes[i] as number];
  return { text, truncated: bytes.length > MAX_TEXT };
}

/** TXT-3: text from elsewhere (SCR-5), cut to the limit. */
export function keep(text: string, cut = false): Text {
  if (text.length <= MAX_TEXT) return { text, truncated: cut };
  // TXT-3: never keep half of a surrogate pair.
  const high = text.charCodeAt(MAX_TEXT - 1);
  const end = high >= 0xd800 && high <= 0xdbff ? MAX_TEXT - 1 : MAX_TEXT;
  return { text: text.slice(0, end), truncated: true };
}

/** TXT-1..4: a string value as text; null when the value is not a string. */
export function textOf(v: PdfValue | null | undefined, encrypted: boolean): Text | null {
  if (v?.kind !== 'string') return null;
  return encrypted ? ENCRYPTED_TEXT : decodeText(v.bytes);
}

/** Text that came from the analyzer, not from the file. */
export const plain = (text: string): Text => ({ text, truncated: false });

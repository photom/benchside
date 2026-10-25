/** Name and comment decoding (fields.md: NAME-1, NAME-3, NAME-4). */
import type { Text } from './types.ts';

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const lenient = new TextDecoder('utf-8', { ignoreBOM: true });

export function decodeUtf8(bytes: Uint8Array): { text: string; valid: boolean } {
  try {
    return { text: strict.decode(bytes), valid: true };
  } catch {
    return { text: lenient.decode(bytes), valid: false };
  }
}

// IBM Code Page 437, bytes 0x80–0xFF (APPNOTE D.1). The WHATWG Encoding standard has no CP437.
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export function decodeCp437(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return out;
}

/** NAME-4: the archive comment has no flag; non-ASCII UTF-8 is a guess. */
export function decodeArchiveComment(bytes: Uint8Array): Text {
  if (bytes.some((b) => b >= 0x80)) {
    const utf8 = decodeUtf8(bytes);
    if (utf8.valid) return { text: utf8.text, encoding: 'utf-8', guessed: true };
  }
  return { text: decodeCp437(bytes), encoding: 'cp437', guessed: false };
}

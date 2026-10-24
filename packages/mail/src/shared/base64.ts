/**
 * Strict base64 (RFC 2045 §6.8) that ignores whitespace, as DKIM `b=`, `bh=`, and `p=` allow.
 * Returns null for characters outside the alphabet, wrong length, or misplaced padding.
 */
export function decodeBase64(text: string): Uint8Array | null {
  const compact = text.replace(/[ \t\r\n]/g, '');
  if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;
  try {
    const binary = atob(compact);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

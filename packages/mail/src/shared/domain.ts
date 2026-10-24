const isAscii = (s: string) => [...s].every((c) => c.charCodeAt(0) < 0x80);

/** Characters the URL host parser would treat as structure, not as part of a label. */
const UNSAFE_IN_LABEL = /[@:/\\?#%[\]\s]/;

/**
 * Converts each non-ASCII label to its A-label (DNS-18), using the URL parser
 * instead of a punycode library. Returns null when a label cannot be converted
 * safely: URL syntax characters, or characters that map to a dot (U+3002, U+FF0E).
 */
export function toALabels(name: string): string | null {
  if (isAscii(name)) return name;
  const labels: string[] = [];
  for (const label of name.split('.')) {
    if (isAscii(label)) {
      labels.push(label);
      continue;
    }
    if (UNSAFE_IN_LABEL.test(label)) return null;
    let host: string;
    try {
      host = new URL(`http://${label}`).hostname;
    } catch {
      return null;
    }
    // One label in, one LDH label out; a dot here means a character mapped to a separator.
    if (!/^[a-z0-9-]+$/.test(host)) return null;
    labels.push(host);
  }
  return labels.join('.');
}

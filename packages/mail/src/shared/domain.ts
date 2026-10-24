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

/**
 * RFC 6376 §3.5 domain-name / selector: dot-separated labels of letters, digits,
 * "-", and "_" (non-ASCII labels are converted later, DNS-18). Anything else
 * must never reach a DNS query.
 */
export function isDomainName(name: string): boolean {
  return name.length > 0 && name.length <= 253 && name.split('.').every(isLabel);
}

function isLabel(label: string): boolean {
  if (label.length === 0 || label.length > 63 || label.startsWith('-') || label.endsWith('-')) {
    return false;
  }
  // ASCII characters must be letters, digits, "-", or "_"; non-ASCII is left to DNS-18.
  return [...label].every((c) => c.charCodeAt(0) >= 0x80 || /[A-Za-z0-9_-]/.test(c));
}

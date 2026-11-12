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

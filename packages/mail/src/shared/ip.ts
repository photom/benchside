import type { Ip } from '@benchside/dns';

export type { Ip };

/**
 * False for addresses that cannot be a real client on the Internet (ENV-8).
 * Documentation ranges stay public, so synthetic test data behaves like real traffic.
 */
export function isPublic(ip: Ip): boolean {
  const [a = 0, b = 0] = ip.bytes;
  if (ip.version === 4) {
    if (a === 0) return false; // 0.0.0.0/8, unspecified
    if (a >= 224) return false; // multicast, reserved, broadcast
    if (a === 10) return false; // RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return false; // RFC 1918
    if (a === 192 && b === 168) return false; // RFC 1918
    if (a === 100 && b >= 64 && b <= 127) return false; // RFC 6598
    if (a === 127) return false; // loopback
    if (a === 169 && b === 254) return false; // link-local
    return true;
  }
  if (ip.bytes.subarray(0, 15).every((x) => x === 0) && (ip.bytes[15] ?? 0) <= 1) return false; // ::, ::1
  if (a === 0xff) return false; // multicast
  if (a === 0xfe && (b & 0xc0) === 0xc0) return false; // fec0::/10, deprecated site-local
  if (a === 0xfe && (b & 0xc0) === 0x80) return false; // fe80::/10
  if ((a & 0xfe) === 0xfc) return false; // fc00::/7, RFC 4193
  return true;
}

/** Whether `ip` is inside `net`/`prefix`; addresses of different families never match (SPF-22). */
export function inCidr(ip: Ip, net: Ip, prefix: number): boolean {
  if (ip.version !== net.version) return false;
  const whole = Math.floor(prefix / 8);
  for (let i = 0; i < whole; i++) if (ip.bytes[i] !== net.bytes[i]) return false;
  const rest = prefix % 8;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return ((ip.bytes[whole] ?? 0) & mask) === ((net.bytes[whole] ?? 0) & mask);
}

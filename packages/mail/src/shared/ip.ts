export interface Ip {
  readonly version: 4 | 6;
  /** Dotted quad, or RFC 5952 text for IPv6. */
  readonly text: string;
  /** 4 or 16 bytes, network order. */
  readonly bytes: Uint8Array;
}

/**
 * Parses an IPv4 or IPv6 address, optionally in an address literal:
 * `[192.0.2.1]`, `[IPv6:2001:db8::1]`, `[2001:db8::1]`, or bare (ENV-6).
 * IPv4-mapped IPv6 becomes IPv4 (ENV-7).
 */
export function parseIp(text: string): Ip | null {
  let s = text;
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (/^ipv6:/i.test(s)) s = s.slice(5);

  const v4 = parseV4(s);
  if (v4) return ipv4(v4);
  const v6 = parseV6(s);
  if (!v6) return null;
  // RFC 4291 §2.5.5.2: ::ffff:0:0/96
  if (v6.subarray(0, 10).every((b) => b === 0) && v6[10] === 0xff && v6[11] === 0xff)
    return ipv4(v6.slice(12));
  return { version: 6, text: formatV6(v6), bytes: v6 };
}

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

function ipv4(bytes: Uint8Array): Ip {
  return { version: 4, text: Array.from(bytes).join('.'), bytes };
}

function parseV4(s: string): Uint8Array | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (const [i, part] of parts.entries()) {
    // RFC 5321 Snum: 1*3DIGIT, decimal even with leading zeros (ENV-17).
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

function parseV6(s: string): Uint8Array | null {
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const compressed = halves.length === 2;
  const head = parseGroups(halves[0] ?? '', !compressed);
  const tail = compressed ? parseGroups(halves[1] ?? '', true) : [];
  if (!head || !tail) return null;
  const zeros = 8 - head.length - tail.length;
  if (compressed ? zeros < 1 : zeros !== 0) return null;

  const out = new Uint8Array(16);
  for (const [i, g] of [...head, ...new Array<number>(zeros).fill(0), ...tail].entries()) {
    out[i * 2] = g >> 8;
    out[i * 2 + 1] = g & 0xff;
  }
  return out;
}

/** Colon-separated hex groups. An IPv4 part counts as two groups and may only end the address. */
function parseGroups(text: string, endsAddress: boolean): number[] | null {
  if (text === '') return [];
  const parts = text.split(':');
  const groups: number[] = [];
  for (const [i, part] of parts.entries()) {
    if (part.includes('.')) {
      const v4 = endsAddress && i === parts.length - 1 ? parseV4(part) : null;
      if (!v4) return null;
      const [a = 0, b = 0, c = 0, d = 0] = v4;
      groups.push((a << 8) | b, (c << 8) | d);
    } else if (/^[0-9a-f]{1,4}$/i.test(part)) {
      groups.push(Number.parseInt(part, 16));
    } else {
      return null;
    }
  }
  return groups;
}

/** RFC 5952 §4: lowercase, no leading zeros, longest run (first on tie) of 2+ zero groups as `::`. */
function formatV6(bytes: Uint8Array): string {
  const groups = Array.from(
    { length: 8 },
    (_, i) => ((bytes[i * 2] ?? 0) << 8) | (bytes[i * 2 + 1] ?? 0),
  );
  let bestStart = -1;
  let bestLen = 1;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = (gs: number[]) => gs.map((g) => g.toString(16)).join(':');
  if (bestStart < 0) return hex(groups);
  return `${hex(groups.slice(0, bestStart))}::${hex(groups.slice(bestStart + bestLen))}`;
}

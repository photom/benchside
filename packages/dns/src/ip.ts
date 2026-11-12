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
  let tagged = false;
  if (s.startsWith('[') && s.endsWith(']')) {
    s = s.slice(1, -1);
    // RFC 5321 §4.1.3: the tag exists only inside a literal and must be followed by IPv6 syntax.
    tagged = /^ipv6:/i.test(s);
    if (tagged) s = s.slice(5);
  }

  const v4 = parseV4(s);
  if (v4) return tagged ? null : ipv4(v4);
  const v6 = parseV6(s);
  if (!v6) return null;
  // RFC 4291 §2.5.5.2: ::ffff:0:0/96
  if (v6.subarray(0, 10).every((b) => b === 0) && v6[10] === 0xff && v6[11] === 0xff)
    return ipv4(v6.slice(12));
  return { version: 6, text: formatV6(v6), bytes: v6 };
}

/**
 * The PTR query name for an address: octets reversed under in-addr.arpa (RFC 1035 §3.5),
 * or the 32 nibbles reversed under ip6.arpa (RFC 3596 §2.5).
 */
export function reverseName(ip: Ip): string {
  if (ip.version === 4) return `${[...ip.bytes].reverse().join('.')}.in-addr.arpa`;
  return `${nibbleList(ip.bytes).reverse().join('.')}.ip6.arpa`;
}

/** Each byte as two lower-case hex nibbles, dot-separated, in address order (RFC 3596 §2.5, RFC 7208 §7.3). */
export function nibbles(bytes: Uint8Array): string {
  return nibbleList(bytes).join('.');
}

function nibbleList(bytes: Uint8Array): string[] {
  return Array.from(bytes).flatMap((b) => [(b >> 4).toString(16), (b & 15).toString(16)]);
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

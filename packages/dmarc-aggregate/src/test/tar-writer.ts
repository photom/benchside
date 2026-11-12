/** Builds tar archives for tests (POSIX.1-2017 pax, "ustar Interchange Format"). */

const enc = (s: string) => new TextEncoder().encode(s);
const NUL = String.fromCharCode(0);

export interface TarEntryInput {
  readonly name: string;
  readonly data?: Uint8Array | string;
  /** Type flag, `0` by default. */
  readonly type?: string;
  /** Written in the `prefix` field (POSIX magic only). */
  readonly prefix?: string;
  /** GNU magic `ustar  NUL` instead of POSIX `ustar NUL 00`. */
  readonly gnu?: boolean;
  /** Size written as base-256 instead of octal. */
  readonly base256?: boolean;
  /** Checksum written instead of the right one. */
  readonly checksum?: number;
  /** Checksum computed over signed bytes. */
  readonly signedChecksum?: boolean;
  /** Size field value instead of the data length. */
  readonly size?: number;
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

export function tarHeader(e: TarEntryInput, dataLength: number): Uint8Array {
  const h = new Uint8Array(512);
  const put = (at: number, s: string | Uint8Array) => h.set(typeof s === 'string' ? enc(s) : s, at);
  put(0, enc(e.name).subarray(0, 100));
  put(100, octal(0o644, 8));
  put(108, octal(0, 8));
  put(116, octal(0, 8));
  const size = e.size ?? dataLength;
  if (e.base256) {
    h[124] = 0x80;
    let v = size;
    for (let i = 135; i > 124; i--) {
      h[i] = v % 256;
      v = Math.floor(v / 256);
    }
  } else {
    put(124, octal(size, 12));
  }
  put(136, octal(0, 12));
  put(148, '        ');
  put(156, e.type ?? '0');
  put(257, e.gnu ? `ustar  ${NUL}` : `ustar${NUL}00`);
  if (e.prefix) put(345, e.prefix);
  let sum = 0;
  for (const b of h) sum += e.signedChecksum && b > 127 ? b - 256 : b;
  put(148, `${(e.checksum ?? sum).toString(8).padStart(6, '0')}\0 `);
  return h;
}

const pad = (n: number) => (512 - (n % 512)) % 512;

/** One entry: header, data, padding. */
export function tarEntry(e: TarEntryInput): Uint8Array {
  const data = typeof e.data === 'string' ? enc(e.data) : (e.data ?? new Uint8Array(0));
  const out = new Uint8Array(512 + data.length + pad(data.length));
  out.set(tarHeader(e, data.length), 0);
  out.set(data, 512);
  return out;
}

/** A pax extended header (type `x`) with the given records. */
export function paxEntry(records: Record<string, string>): Uint8Array {
  let body = '';
  for (const [k, v] of Object.entries(records)) {
    const rest = ` ${k}=${v}\n`;
    // The length counts its own digits.
    let len = enc(rest).length + 1;
    while (String(len).length + enc(rest).length !== len) len++;
    body += `${len}${rest}`;
  }
  return tarEntry({ name: 'PaxHeader', type: 'x', data: body });
}

export function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Entries followed by the two zero blocks that end an archive. */
export function tar(...entries: Uint8Array[]): Uint8Array {
  return cat(...entries, new Uint8Array(1024));
}

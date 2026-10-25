/** Header field decoding (fields.md). */
import type { DosDateTime, Flags, Method, Version } from './types.ts';

// APPNOTE 4.4.2.2
const HOSTS = [
  'MS-DOS and OS/2 (FAT / VFAT / FAT32)',
  'Amiga',
  'OpenVMS',
  'UNIX',
  'VM/CMS',
  'Atari ST',
  'OS/2 H.P.F.S.',
  'Macintosh',
  'Z-System',
  'CP/M',
  'Windows NTFS',
  'MVS (OS/390 - Z/OS)',
  'VSE',
  'Acorn Risc',
  'VFAT',
  'alternate MVS',
  'BeOS',
  'Tandem',
  'OS/400',
  'OS X (Darwin)',
];

const spec = (low: number) => `${Math.floor(low / 10)}.${low % 10}`;

/** FLD-1 */
export function versionMadeBy(raw: number): Version {
  return { raw, host: HOSTS[raw >>> 8] ?? 'unused', spec: spec(raw & 0xff) };
}

/** FLD-2 */
export function versionNeeded(raw: number): Version {
  return { raw, spec: spec(raw & 0xff) };
}

// APPNOTE 4.4.4
const FLAG_NAMES: Record<number, string> = {
  0: 'Encrypted',
  3: 'Data descriptor',
  4: 'Enhanced deflating (reserved)',
  5: 'Compressed patched data',
  6: 'Strong encryption',
  7: 'Unused',
  8: 'Unused',
  9: 'Unused',
  10: 'Unused',
  11: 'UTF-8 names and comments (EFS)',
  12: 'Reserved',
  13: 'Local header values masked',
  14: 'Reserved',
  15: 'Reserved',
};

const DEFLATE_OPTIONS = ['Normal', 'Maximum', 'Fast', 'Super Fast'];

/** FLD-3: bits 1 and 2 depend on the method. */
function methodBit(bit: 1 | 2, raw: number, method: number): string {
  switch (method) {
    case 6:
      return bit === 1 ? '8K sliding dictionary' : '3 Shannon-Fano trees';
    case 8:
    case 9: {
      const option = (raw >>> 1) & 3;
      return `${DEFLATE_OPTIONS[option]} compression (bits 2-1 = ${option.toString(2).padStart(2, '0')})`;
    }
    case 14:
      if (bit === 1) return 'LZMA end-of-stream marker';
  }
  return 'Undefined for this method';
}

export function flags(raw: number, method: number): Flags {
  const bits: { bit: number; name: string }[] = [];
  for (let bit = 0; bit < 16; bit++) {
    if (!(raw & (1 << bit))) continue;
    const name = bit === 1 || bit === 2 ? methodBit(bit, raw, method) : FLAG_NAMES[bit];
    bits.push({ bit, name: name ?? 'Unused' });
  }
  return { raw, bits };
}

// APPNOTE 4.4.5
const METHODS: Record<number, string> = {
  0: 'Stored',
  1: 'Shrunk',
  2: 'Reduced (factor 1)',
  3: 'Reduced (factor 2)',
  4: 'Reduced (factor 3)',
  5: 'Reduced (factor 4)',
  6: 'Imploded',
  7: 'Reserved (Tokenizing)',
  8: 'Deflated',
  9: 'Deflate64',
  10: 'PKWARE DCL Imploded',
  11: 'Reserved',
  12: 'BZIP2',
  13: 'Reserved',
  14: 'LZMA',
  15: 'Reserved',
  16: 'IBM z/OS CMPSC',
  17: 'Reserved',
  18: 'IBM TERSE (new)',
  19: 'IBM LZ77 z Architecture',
  20: 'Deprecated (zstd)',
  93: 'Zstandard (zstd)',
  94: 'MP3',
  95: 'XZ',
  96: 'JPEG variant',
  97: 'WavPack',
  98: 'PPMd version I, Rev 1',
  99: 'AE-x encryption marker',
};

/** FLD-4 */
export function method(code: number): Method {
  return { code, name: METHODS[code] ?? 'Unknown' };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** FLD-5: MS-DOS date and time (4.4.6), no time zone. */
export function dosDateTime(time: number, date: number): DosDateTime {
  const year = (date >>> 9) + 1980;
  const month = (date >>> 5) & 0x0f;
  const day = date & 0x1f;
  const hour = time >>> 11;
  const minute = (time >>> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const valid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59;
  const text = valid
    ? `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`
    : null;
  return { time, date, text };
}

/** FLD-6 */
export function internalAttributes(raw: number) {
  return { raw, text: (raw & 1) !== 0 };
}

const DOS_ATTRIBUTES: readonly [number, string][] = [
  [0x01, 'read-only'],
  [0x02, 'hidden'],
  [0x04, 'system'],
  [0x10, 'directory'],
  [0x20, 'archive'],
];

// File type: mode >>> 12 (S_IFMT). Decimal keys; octal keys get mangled by the formatter.
const UNIX_TYPES: Record<number, string> = {
  12: 's',
  10: 'l',
  8: '-',
  6: 'b',
  4: 'd',
  2: 'c',
  1: 'p',
};

/** FLD-7: MS-DOS low byte; UNIX mode in the upper 16 bits (an Info-ZIP convention). */
export function externalAttributes(raw: number, host: number) {
  const dos = DOS_ATTRIBUTES.filter(([bit]) => raw & bit).map(([, name]) => name);
  return { raw, dos, unixMode: host === 3 ? unixMode(raw >>> 16) : null };
}

function unixMode(mode: number): string {
  const type = UNIX_TYPES[mode >>> 12] ?? '?';
  const rwx = (shift: number) => {
    const p = (mode >>> shift) & 7;
    return `${p & 4 ? 'r' : '-'}${p & 2 ? 'w' : '-'}${p & 1 ? 'x' : '-'}`;
  };
  return type + rwx(6) + rwx(3) + rwx(0);
}

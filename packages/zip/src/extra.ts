/** Extra field blocks (fields.md: EXT-1..3; structure.md: Z64-5..7; NAME-2). */
import { crc32 } from './crc32.ts';
import type { FindingList } from './findings.ts';
import { u64, view } from './source.ts';
import { decodeUtf8 } from './text.ts';
import type { ExtraBlock, UnicodePath, Zip64Values } from './types.ts';

export interface RawBlock {
  /** null for the malformed rest (EXT-1). */
  readonly id: number | null;
  /** Offset of the block header in the archive. */
  readonly offset: number;
  readonly data: Uint8Array;
}

/** EXT-1: Header ID (2), Data Size (2), data (4.5.1). */
export function splitExtra(
  bytes: Uint8Array,
  offset: number,
  findings: FindingList,
  entry: number,
): RawBlock[] {
  const v = view(bytes);
  const blocks: RawBlock[] = [];
  let at = 0;
  while (at < bytes.length) {
    const size = at + 4 <= bytes.length ? v.getUint16(at + 2, true) : -1;
    if (size < 0 || at + 4 + size > bytes.length) {
      findings.add(
        'zip.extra.malformed',
        `The extra field's last ${bytes.length - at} bytes do not form a whole block.`,
        { offset: offset + at, entry },
      );
      blocks.push({ id: null, offset: offset + at, data: bytes.subarray(at) });
      break;
    }
    blocks.push({
      id: v.getUint16(at, true),
      offset: offset + at,
      data: bytes.subarray(at + 4, at + 4 + size),
    });
    at += 4 + size;
  }
  return blocks;
}

// APPNOTE 4.5.2 (PKWARE) and 4.6.1 (third party).
const NAMES: Record<number, string> = {
  1: 'Zip64 extended information',
  7: 'AV Info',
  8: 'Extended language encoding data (reserved)',
  9: 'OS/2',
  10: 'NTFS',
  12: 'OpenVMS',
  13: 'UNIX',
  14: 'File stream and fork descriptors (reserved)',
  15: 'Patch Descriptor',
  20: 'PKCS#7 Store for X.509 Certificates',
  21: 'X.509 Certificate ID and Signature for individual file',
  22: 'X.509 Certificate ID for Central Directory',
  23: 'Strong Encryption Header',
  24: 'Record Management Controls',
  25: 'PKCS#7 Encryption Recipient Certificate List',
  32: 'Timestamp record (reserved)',
  33: 'Policy Decryption Key Record',
  34: 'Smartcrypt Key Provider Record',
  35: 'Smartcrypt Policy Key Data Record',
  101: 'IBM S/390 (Z390), AS/400 (I400) attributes - uncompressed',
  102: 'IBM S/390 (Z390), AS/400 (I400) attributes - compressed (reserved)',
  18064: 'POSZIP 4690 (reserved)',
  1992: 'Macintosh',
  6534: 'Pixar USD header ID',
  9733: 'ZipIt Macintosh',
  9989: 'ZipIt Macintosh 1.3.5+',
  10245: 'ZipIt Macintosh 1.3.5+',
  13133: 'Info-ZIP Macintosh',
  16724: 'Tandem',
  17217: 'Acorn/SparkFS',
  17491: 'Windows NT security descriptor (binary ACL)',
  18180: 'VM/CMS',
  18191: 'MVS',
  18516: 'THEOS (old?)',
  19270: 'FWKCS MD5',
  19521: 'OS/2 access control list (text ACL)',
  19785: 'Info-ZIP OpenVMS',
  19811: 'Macintosh Smartzip',
  20300: 'Xceed original location extra field',
  21334: 'AOS/VS (ACL)',
  21589: 'Extended timestamp',
  21838: 'Xceed unicode extra field',
  22613: 'Info-ZIP UNIX (original)',
  25461: 'Info-ZIP Unicode Comment',
  25922: 'BeOS/BeBox',
  26708: 'THEOS',
  28789: 'Info-ZIP Unicode Path',
  29761: 'AtheOS/Syllable',
  30062: 'ASi UNIX',
  30805: 'Info-ZIP UNIX (new)',
  30837: 'Info-ZIP UNIX (newer UID/GID)',
  41246: 'Data Stream Alignment (Apache Commons-Compress)',
  41504: 'Microsoft Open Packaging Growth Hint',
  51966: 'Java JAR file',
  55605: 'Android ZIP Alignment',
  58746: 'Korean ZIP code page info',
  64842: 'SMS/QDOS',
  39169: 'AE-x encryption structure',
  39170: 'unknown (0x9902)',
};

/** EXT-2 */
export function extraName(id: number | null): string {
  return id === null ? 'Malformed' : (NAMES[id] ?? 'Unknown');
}

export interface Zip64Need {
  readonly uncompressedSize: boolean;
  readonly compressedSize: boolean;
  readonly localHeaderOffset: boolean;
  readonly diskStart: boolean;
}

/** Z64-5: the needed values, in this fixed order (4.5.3). */
export function zip64Fields(
  data: Uint8Array,
  need: Zip64Need,
): { values: Zip64Values; short: boolean; tooLarge: boolean } {
  const v = view(data);
  const values: { -readonly [K in keyof Zip64Values]: number } = {};
  let at = 0;
  let short = false;
  let tooLarge = false;
  for (const key of ['uncompressedSize', 'compressedSize', 'localHeaderOffset'] as const) {
    if (!need[key]) continue;
    if (at + 8 > data.length) {
      short = true;
      break;
    }
    const value = u64(v, at);
    at += 8;
    if (value === null) tooLarge = true;
    else values[key] = value;
  }
  if (need.diskStart && !short) {
    if (at + 4 > data.length) short = true;
    else values.diskStart = v.getUint32(at, true);
  }
  return { values, short, tooLarge };
}

/** NAME-2: Info-ZIP Unicode Path (4.6.9); null when too short to hold its fixed fields. */
export function unicodePath(data: Uint8Array, nameBytes: Uint8Array): UnicodePath | null {
  if (data.length < 5) return null;
  const version = data[0] as number;
  const nameCrc32 = view(data).getUint32(1, true);
  return {
    version,
    nameCrc32,
    name: decodeUtf8(data.subarray(5)).text,
    matches: version === 1 && nameCrc32 === crc32(nameBytes),
  };
}

const PREVIEW = 64;

/** EXT-3: keep the size and the first 64 bytes. */
export function toBlock(
  raw: RawBlock,
  decoded: { zip64?: Zip64Values; unicodePath?: UnicodePath } = {},
): ExtraBlock {
  return {
    id: raw.id,
    name: extraName(raw.id),
    offset: raw.offset,
    byteLength: raw.data.length,
    preview: raw.data.slice(0, PREVIEW),
    ...decoded,
  };
}

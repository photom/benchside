/** Decoding of more extra field blocks (fields.md: EXT-5..9, EXT-11). */
import { tooLarge } from './end-records.ts';
import { extraName, type RawBlock } from './extra.ts';
import { method, pad } from './fields.ts';
import type { FindingList } from './findings.ts';
import { view } from './source.ts';
import type { DecodedExtra, NtfsTime, UnixTime } from './types.ts';

export interface Where {
  readonly header: 'central' | 'local';
  /** EXT-9: where the file data starts, for local headers. */
  readonly dataOffset?: number;
}

interface Context {
  readonly raw: RawBlock;
  readonly where: Where;
  readonly findings: FindingList;
  readonly entry: number;
}

function decoderFor(id: number | null): ((c: Context) => DecodedExtra | undefined) | undefined {
  switch (id) {
    case 0x5455:
      return timestamp;
    case 0x7875:
      return unixOwner;
    case 0x000a:
      return ntfs;
    case 0x9901:
      return aes;
    case 0xd935:
      return alignment;
    default:
      return undefined;
  }
}

/** EXT-3: decoded values for the IDs that have a decoder; undefined for the others. */
export function decodeExtra(
  raw: RawBlock,
  where: Where,
  findings: FindingList,
  entry: number,
): DecodedExtra | undefined {
  return decoderFor(raw.id)?.({ raw, where, findings, entry });
}

/** `{ decoded }` for spreading into toBlock's values, or nothing. */
export function decodedValues(
  raw: RawBlock,
  where: Where,
  findings: FindingList,
  entry: number,
): { decoded?: DecodedExtra } {
  const decoded = decodeExtra(raw, where, findings, entry);
  return decoded ? { decoded } : {};
}

function malformed(c: Context, detail: string) {
  c.findings.add('zip.extra.malformed', `The ${extraName(c.raw.id)} extra field ${detail}.`, {
    offset: c.raw.offset,
    entry: c.entry,
  });
}

/** EXT-11: `YYYY-MM-DD hh:mm:ss`, plus the fraction digits given. */
function utc(ms: number, fraction = ''): string {
  const d = new Date(ms);
  const date = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${date} ${time}${fraction} UTC`;
}

const unixTime = (seconds: number): UnixTime => ({ seconds, text: utc(seconds * 1000) });

// Seconds from 1601-01-01 to 1970-01-01, and FILETIME ticks per second.
const EPOCH_1601 = 11_644_473_600n;
const TICKS_PER_SECOND = 10_000_000n;

function ntfsTime(ticks: bigint): NtfsTime {
  if (ticks === 0n) return { ticks: '0', text: null };
  const seconds = ticks / TICKS_PER_SECOND - EPOCH_1601;
  const fraction = pad(Number(ticks % TICKS_PER_SECOND), 7);
  return { ticks: String(ticks), text: utc(Number(seconds) * 1000, `.${fraction}`) };
}

const TIME_NAMES = ['modified', 'accessed', 'created'] as const;

/** EXT-5: Info-ZIP extended timestamp. */
function timestamp(c: Context): DecodedExtra | undefined {
  const data = c.raw.data;
  if (data.length === 0) {
    malformed(c, 'is empty');
    return undefined;
  }
  const flags = data[0] as number;
  // The central block holds the modification time only (extrafld.txt).
  const bits = c.where.header === 'central' ? [0] : [0, 1, 2];
  const v = view(data);
  const times: { -readonly [K in (typeof TIME_NAMES)[number]]?: UnixTime } = {};
  let at = 1;
  let short = false;
  for (const bit of bits) {
    if (!(flags & (1 << bit))) continue;
    if (at + 4 > data.length) {
      short = true;
      break;
    }
    times[TIME_NAMES[bit] as (typeof TIME_NAMES)[number]] = unixTime(v.getInt32(at, true));
    at += 4;
  }
  if (short) malformed(c, 'is shorter than its flags say');
  return { kind: 'timestamp', flags, ...times };
}

/** EXT-6: Info-ZIP UNIX UID and GID, version 1. */
function unixOwner(c: Context): DecodedExtra | undefined {
  const data = c.raw.data;
  if (data.length === 0) {
    malformed(c, 'is empty');
    return undefined;
  }
  const version = data[0] as number;
  if (version !== 1) return { kind: 'unix-owner', version };
  // Keep the values that decode, as EXT-5 and EXT-7 do.
  const uid = idField(data, 1);
  const gid = uid.kind === 'ok' ? idField(data, uid.next) : null;
  if (uid.kind === 'bad' || gid?.kind === 'bad') {
    malformed(c, 'has a UID or GID that does not fit');
  } else if (uid.kind === 'big' || gid?.kind === 'big') {
    tooLarge(c.findings, c.raw.offset, 'Info-ZIP UNIX UID/GID extra field', c.entry);
  }
  return {
    kind: 'unix-owner',
    version,
    ...(uid.kind === 'ok' && uid.value !== null ? { uid: uid.value } : {}),
    ...(gid?.kind === 'ok' && gid.value !== null ? { gid: gid.value } : {}),
  };
}

type IdField =
  | { readonly kind: 'ok'; readonly value: number | null; readonly next: number }
  | { readonly kind: 'bad' }
  | { readonly kind: 'big' };

/** A size byte, then that many bytes, little-endian. A size of 0 is no value. */
function idField(data: Uint8Array, at: number): IdField {
  const size = data[at];
  if (size === undefined || size > 8 || at + 1 + size > data.length) return { kind: 'bad' };
  let value = 0n;
  for (let i = size - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[at + 1 + i] as number);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: 'big' };
  return { kind: 'ok', value: size === 0 ? null : Number(value), next: at + 1 + size };
}

const NTFS_TIMES = 0x0001;
const NTFS_TIMES_SIZE = 24;

/** EXT-7: NTFS attributes (4.5.5). */
function ntfs(c: Context): DecodedExtra | undefined {
  const data = c.raw.data;
  if (data.length < 4) {
    malformed(c, 'is shorter than its 4 reserved bytes');
    return undefined;
  }
  const v = view(data);
  const attributes: { tag: number; byteLength: number }[] = [];
  let times: Partial<Record<(typeof TIME_NAMES)[number], NtfsTime>> = {};
  let at = 4;
  while (at < data.length) {
    if (at + 4 > data.length) {
      malformed(c, 'ends inside an attribute header');
      break;
    }
    const tag = v.getUint16(at, true);
    const size = v.getUint16(at + 2, true);
    if (at + 4 + size > data.length) {
      malformed(c, `has attribute ${tag} reaching past the block`);
      break;
    }
    attributes.push({ tag, byteLength: size });
    if (tag === NTFS_TIMES) {
      if (size === NTFS_TIMES_SIZE) {
        times = {
          modified: ntfsTime(v.getBigUint64(at + 4, true)),
          accessed: ntfsTime(v.getBigUint64(at + 12, true)),
          created: ntfsTime(v.getBigUint64(at + 20, true)),
        };
      } else {
        malformed(c, `has a time attribute of ${size} bytes, not 24`);
      }
    }
    at += 4 + size;
  }
  return { kind: 'ntfs', attributes, ...times };
}

const AES_SIZE = 7;
const AES_VERSIONS: Record<number, 'AE-1' | 'AE-2'> = { 1: 'AE-1', 2: 'AE-2' };
const AES_KEY_BITS: Record<number, number> = { 1: 128, 2: 192, 3: 256 };

/** EXT-8: WinZip AES. */
function aes(c: Context): DecodedExtra | undefined {
  const data = c.raw.data;
  if (data.length < AES_SIZE) {
    malformed(c, `is shorter than ${AES_SIZE} bytes`);
    return undefined;
  }
  const v = view(data);
  const vendorVersion = v.getUint16(0, true);
  const strength = data[4] as number;
  return {
    kind: 'aes',
    vendorVersion,
    version: AES_VERSIONS[vendorVersion] ?? 'unknown',
    vendorId: String.fromCharCode(data[2] as number, data[3] as number),
    strength,
    keyBits: AES_KEY_BITS[strength] ?? null,
    method: method(v.getUint16(5, true)),
  };
}

/** EXT-9: Android ZIP alignment (apksig). */
function alignment(c: Context): DecodedExtra | undefined {
  const data = c.raw.data;
  if (data.length < 2) {
    malformed(c, 'is shorter than 2 bytes');
    return undefined;
  }
  const value = view(data).getUint16(0, true);
  const { header, dataOffset } = c.where;
  const checked = header === 'local' && dataOffset !== undefined && value > 0;
  return {
    kind: 'alignment',
    alignment: value,
    paddingBytes: data.length - 2,
    aligned: checked ? dataOffset % value === 0 : null,
  };
}

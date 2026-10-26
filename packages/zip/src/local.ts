/** Local headers, file data, data descriptors (structure.md: LH-*, Z64-6). */
import { type CentralEntry, readZip64Extra } from './central.ts';
import { tooLarge } from './end-records.ts';
import { splitExtra, toBlock } from './extra.ts';
import { decodedValues } from './extra-decode.ts';
import { dosDateTime, flags, method, versionNeeded } from './fields.ts';
import type { FindingList } from './findings.ts';
import { LOCAL_SIGNATURE } from './signatures.ts';
import { type Reader, u64, view } from './source.ts';
import { decodeCp437, decodeUtf8 } from './text.ts';
import type { Descriptor, LocalHeader, MismatchField, Range, Region } from './types.ts';

const DESCRIPTOR_SIGNATURE = 0x08074b50; // 4.3.9.3
const HEADER_SIZE = 30;
const DESCRIPTOR_FLAG = 0x0008; // 4.4.4 bit 3
const UTF8_FLAG = 0x0800; // 4.4.4 bit 11

export interface LocalResult {
  readonly local: LocalHeader | null;
  readonly data: Range | null;
  readonly descriptor: Descriptor | null;
  readonly mismatches: readonly MismatchField[];
  readonly hasZip64Extra: boolean;
  readonly regions: readonly Region[];
}

const NONE: LocalResult = {
  local: null,
  data: null,
  descriptor: null,
  mismatches: [],
  hasZip64Extra: false,
  regions: [],
};

export async function readLocal(
  reader: Reader,
  entry: CentralEntry,
  index: number,
  offset: number,
  findings: FindingList,
): Promise<LocalResult> {
  const size = reader.byteLength;
  // LH-1
  const fixed = await reader.bytes(offset, HEADER_SIZE);
  if (!fixed) return outOfRange(findings, offset, index);
  const v = view(fixed);
  if (v.getUint32(0, true) !== LOCAL_SIGNATURE) {
    findings.add('zip.local.bad-signature', `No local file header signature at offset ${offset}.`, {
      offset,
      entry: index,
    });
    return NONE;
  }
  const nameLength = v.getUint16(26, true);
  const extraLength = v.getUint16(28, true);
  const headerLength = HEADER_SIZE + nameLength + extraLength;
  const header = await reader.bytes(offset, headerLength);
  if (!header) return outOfRange(findings, offset, index);

  const rawFlags = v.getUint16(6, true);
  const rawMethod = v.getUint16(8, true);
  const compressedSize = v.getUint32(18, true);
  const uncompressedSize = v.getUint32(22, true);
  const nameBytes = header.slice(HEADER_SIZE, HEADER_SIZE + nameLength);
  const raw = splitExtra(
    header.subarray(HEADER_SIZE + nameLength),
    offset + HEADER_SIZE + nameLength,
    findings,
    index,
    true,
  );
  // Z64-6: the local ZIP64 extra field holds both sizes.
  const sentinel = compressedSize === 0xffffffff || uncompressedSize === 0xffffffff;
  const zip64 = readZip64Extra(
    raw,
    {
      uncompressedSize: sentinel,
      compressedSize: sentinel,
      localHeaderOffset: false,
      diskStart: false,
    },
    offset,
    index,
    findings,
    'local file header',
  );
  // LH-3: the file data follows the local header; EXT-9 checks its alignment.
  const dataOffset = offset + headerLength;
  const where = { header: 'local', dataOffset } as const;
  const local: LocalHeader = {
    offset,
    versionNeeded: versionNeeded(v.getUint16(4, true)),
    flags: flags(rawFlags, rawMethod),
    method: method(rawMethod),
    modified: dosDateTime(v.getUint16(10, true), v.getUint16(12, true)),
    crc32: v.getUint32(14, true),
    compressedSize,
    uncompressedSize,
    nameLength,
    extraLength,
    nameBytes,
    extra: raw.map((block) =>
      toBlock(block, {
        ...(block === zip64.block ? { zip64: zip64.values } : {}),
        ...decodedValues(block, where, findings, index),
      }),
    ),
    effectiveCompressedSize: zip64.values.compressedSize ?? compressedSize,
    effectiveUncompressedSize: zip64.values.uncompressedSize ?? uncompressedSize,
  };
  const hasZip64Extra = raw.some((b) => b.id === 0x0001);

  const differences = compare(local, entry);
  const mismatches = differences.map((d) => d.field);
  if (differences.length > 0) {
    // RD-2: both readings, so the user sees what each kind of reader gets.
    const detail = differences.map((d) => `${d.field}: central ${d.central}, local ${d.local}`);
    findings.add(
      'zip.local.mismatch',
      `The local header and the central directory differ. ${detail.join('; ')}.`,
      { offset, entry: index },
    );
  }

  // LH-3
  const regions: Region[] = [
    { kind: 'local-header', offset, byteLength: headerLength, entry: index },
  ];
  let dataLength = entry.compressedSize;
  if (dataOffset + dataLength > size) {
    findings.add(
      'zip.data.truncated',
      `The file data needs ${dataLength} bytes but the archive ends after ${size - dataOffset}.`,
      { offset: dataOffset, entry: index },
    );
    dataLength = size - dataOffset;
  }
  const data = { offset: dataOffset, byteLength: dataLength };
  if (dataLength > 0) regions.push({ kind: 'file-data', ...data, entry: index });

  // LH-4
  let descriptor: Descriptor | null = null;
  if (rawFlags & DESCRIPTOR_FLAG && dataLength === entry.compressedSize) {
    descriptor = await readDescriptor(
      reader,
      dataOffset + dataLength,
      entry.hasZip64Extra || hasZip64Extra,
      entry,
      index,
      findings,
    );
    if (descriptor) {
      regions.push({
        kind: 'data-descriptor',
        offset: descriptor.offset,
        byteLength: descriptor.byteLength,
        entry: index,
      });
    }
  }
  return { local, data, descriptor, mismatches, hasZip64Extra, regions };
}

function outOfRange(findings: FindingList, offset: number, index: number): LocalResult {
  findings.add(
    'zip.local.out-of-range',
    `The local file header at offset ${offset} does not fit in the archive.`,
    { offset, entry: index },
  );
  return NONE;
}

interface Difference {
  readonly field: MismatchField;
  readonly central: string;
  readonly local: string;
}

const hex = (n: number) => `0x${n.toString(16)}`;

/** LH-2; RD-2: each differing field with both values. */
function compare(local: LocalHeader, entry: CentralEntry): Difference[] {
  const c = entry.central;
  const out: Difference[] = [];
  const check = (field: MismatchField, central: number | string, mine: number | string) => {
    if (central !== mine) out.push({ field, central: String(central), local: String(mine) });
  };
  // Each header's name as a reader of that header would decode it.
  const name = (bytes: Uint8Array, flags: number) =>
    JSON.stringify(flags & UTF8_FLAG ? decodeUtf8(bytes).text : decodeCp437(bytes));
  check('versionNeeded', c.versionNeeded.raw, local.versionNeeded.raw);
  check('flags', hex(c.flags.raw), hex(local.flags.raw));
  check('method', c.method.code, local.method.code);
  check('time', hex(c.modified.time), hex(local.modified.time));
  check('date', hex(c.modified.date), hex(local.modified.date));
  // The bytes, and the name each header's own UTF-8 flag gives them (RD-2).
  const centralName = name(c.nameBytes, c.flags.raw);
  const localName = name(local.nameBytes, local.flags.raw);
  if (!sameBytes(local.nameBytes, c.nameBytes) || centralName !== localName) {
    out.push({
      field: 'name',
      central: centralName,
      local: localName,
    });
  }
  if (!(local.flags.raw & DESCRIPTOR_FLAG)) {
    check('crc32', hex(c.crc32), hex(local.crc32));
    check('compressedSize', entry.compressedSize, local.effectiveCompressedSize);
    check('uncompressedSize', entry.uncompressedSize, local.effectiveUncompressedSize);
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** LH-4 */
async function readDescriptor(
  reader: Reader,
  offset: number,
  zip64: boolean,
  entry: CentralEntry,
  index: number,
  findings: FindingList,
): Promise<Descriptor | null> {
  const head = await reader.bytes(offset, 4);
  const signature = head !== null && view(head).getUint32(0, true) === DESCRIPTOR_SIGNATURE;
  const width = zip64 ? 8 : 4;
  const byteLength = (signature ? 4 : 0) + 4 + 2 * width;
  const bytes = await reader.bytes(offset, byteLength);
  if (!bytes) {
    findings.add(
      'zip.descriptor.truncated',
      `The data descriptor at offset ${offset} does not fit in the archive.`,
      { offset, entry: index },
    );
    return null;
  }
  const v = view(bytes);
  const at = signature ? 4 : 0;
  const crc32 = v.getUint32(at, true);
  const compressedSize = zip64 ? u64(v, at + 4) : v.getUint32(at + 4, true);
  const uncompressedSize = zip64 ? u64(v, at + 12) : v.getUint32(at + 8, true);
  if (compressedSize === null || uncompressedSize === null) {
    tooLarge(findings, offset, 'data descriptor', index);
    return null;
  }
  const differing = [
    crc32 !== entry.central.crc32 && 'crc32',
    compressedSize !== entry.compressedSize && 'compressedSize',
    uncompressedSize !== entry.uncompressedSize && 'uncompressedSize',
  ].filter(Boolean);
  if (differing.length > 0) {
    findings.add(
      'zip.descriptor.mismatch',
      `The data descriptor and the central directory differ in: ${differing.join(', ')}.`,
      { offset, entry: index },
    );
  }
  return { offset, byteLength, signature, crc32, compressedSize, uncompressedSize };
}

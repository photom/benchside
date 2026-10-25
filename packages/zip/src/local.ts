/** Local headers, file data, data descriptors (structure.md: LH-*, Z64-6). */
import { type CentralEntry, readZip64Extra } from './central.ts';
import { tooLarge } from './end-records.ts';
import { splitExtra, toBlock } from './extra.ts';
import { dosDateTime, flags, method, versionNeeded } from './fields.ts';
import type { FindingList } from './findings.ts';
import { type Reader, u64, view } from './source.ts';
import type { Descriptor, LocalHeader, MismatchField, Range, Region } from './types.ts';

const LOCAL_SIGNATURE = 0x04034b50; // 4.3.7
const DESCRIPTOR_SIGNATURE = 0x08074b50; // 4.3.9.3
const HEADER_SIZE = 30;
const DESCRIPTOR_FLAG = 0x0008; // 4.4.4 bit 3

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
    extra: raw.map((block) => toBlock(block, block === zip64.block ? { zip64: zip64.values } : {})),
    effectiveCompressedSize: zip64.values.compressedSize ?? compressedSize,
    effectiveUncompressedSize: zip64.values.uncompressedSize ?? uncompressedSize,
  };
  const hasZip64Extra = raw.some((b) => b.id === 0x0001);

  const mismatches = compare(local, entry);
  if (mismatches.length > 0) {
    findings.add(
      'zip.local.mismatch',
      `The local header and the central directory differ in: ${mismatches.join(', ')}.`,
      { offset, entry: index },
    );
  }

  // LH-3
  const regions: Region[] = [
    { kind: 'local-header', offset, byteLength: headerLength, entry: index },
  ];
  const dataOffset = offset + headerLength;
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

/** LH-2 */
function compare(local: LocalHeader, entry: CentralEntry): MismatchField[] {
  const c = entry.central;
  const fields: MismatchField[] = [];
  if (local.versionNeeded.raw !== c.versionNeeded.raw) fields.push('versionNeeded');
  if (local.flags.raw !== c.flags.raw) fields.push('flags');
  if (local.method.code !== c.method.code) fields.push('method');
  if (local.modified.time !== c.modified.time) fields.push('time');
  if (local.modified.date !== c.modified.date) fields.push('date');
  if (!sameBytes(local.nameBytes, c.nameBytes)) fields.push('name');
  if (!(local.flags.raw & DESCRIPTOR_FLAG)) {
    if (local.crc32 !== c.crc32) fields.push('crc32');
    if (local.effectiveCompressedSize !== entry.compressedSize) fields.push('compressedSize');
    if (local.effectiveUncompressedSize !== entry.uncompressedSize) fields.push('uncompressedSize');
  }
  return fields;
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

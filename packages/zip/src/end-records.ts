/** End of central directory record and ZIP64 end records (structure.md: EOCD-*, Z64-1..4). */
import { versionMadeBy, versionNeeded } from './fields.ts';
import type { FindingList } from './findings.ts';
import { type Reader, u64, view } from './source.ts';
import { decodeArchiveComment } from './text.ts';
import type { Eocd, Region, Text, Zip64Record } from './types.ts';

const EOCD_SIGNATURE = 0x06054b50; // 4.3.16
const LOCATOR_SIGNATURE = 0x07064b50; // 4.3.15
const ZIP64_SIGNATURE = 0x06064b50; // 4.3.14
const EOCD_SIZE = 22;
const LOCATOR_SIZE = 20;
const ZIP64_SIZE = 56;
const MAX_COMMENT = 0xffff;

export interface EndDraft {
  readonly eocd: Eocd;
  readonly zip64: Zip64Record | null;
  readonly comment: Text;
  /** Z64-2; 0 when not found there. */
  readonly shift: number;
  /** CD-1: where the central directory must end. */
  readonly endStart: number;
  readonly entryCount: number;
  readonly cdOffset: number;
  readonly cdByteLength: number;
  readonly regions: readonly Region[];
  /** REP-11 */
  readonly eocdCandidates: readonly number[];
}

export async function readEnd(reader: Reader, findings: FindingList): Promise<EndDraft | null> {
  const size = reader.byteLength;
  const found = await findEocd(reader);
  if (!found) {
    findings.add('zip.eocd.missing', 'No end of central directory record was found.');
    return null;
  }
  const { eocd, comment, candidates } = found;
  const regions: Region[] = [
    { kind: 'eocd', offset: eocd.offset, byteLength: EOCD_SIZE + eocd.commentLength },
  ];
  const eocdEnd = eocd.offset + EOCD_SIZE + eocd.commentLength;
  if (eocdEnd < size) {
    // EOCD-2
    regions.push({ kind: 'trailing', offset: eocdEnd, byteLength: size - eocdEnd });
    findings.add(
      'zip.eocd.trailing-data',
      `${size - eocdEnd} bytes follow the end of central directory record.`,
      { offset: eocdEnd },
    );
  }

  const zip64 = await readZip64(reader, eocd.offset, findings);
  if (zip64) {
    regions.push(
      { kind: 'zip64-eocd', offset: zip64.record.offset, byteLength: zip64.record.byteLength },
      { kind: 'zip64-locator', offset: zip64.record.locatorOffset, byteLength: LOCATOR_SIZE },
    );
  }
  const values = effectiveValues(eocd, zip64?.record ?? null, findings);

  // EOCD-4, Z64-1
  if (values.disk !== 0 || values.cdDisk !== 0 || values.entriesOnDisk !== values.entries) {
    findings.add(
      'zip.multi-disk',
      'The disk numbers say this archive is split or spanned; only this file is read.',
      { offset: eocd.offset },
    );
  }

  return {
    eocd,
    zip64: zip64?.record ?? null,
    comment,
    shift: zip64?.shift ?? 0,
    endStart: zip64?.record.offset ?? eocd.offset,
    entryCount: values.entries,
    cdOffset: values.cdOffset,
    cdByteLength: values.cdByteLength,
    regions,
    eocdCandidates: candidates,
  };
}

/** EOCD-1, EOCD-2 */
async function findEocd(
  reader: Reader,
): Promise<{ eocd: Eocd; comment: Text; candidates: number[] } | null> {
  const size = reader.byteLength;
  const tailLength = Math.min(size, EOCD_SIZE + MAX_COMMENT);
  const base = size - tailLength;
  const tail = await reader.bytes(base, tailLength);
  if (!tail) return null;
  const v = view(tail);
  let fitting: number | null = null;
  let exact: number | null = null;
  // REP-11: every signature with a whole record after it, highest first.
  const candidates: number[] = [];
  for (let p = tailLength - EOCD_SIZE; p >= 0; p--) {
    if (v.getUint32(p, true) !== EOCD_SIGNATURE) continue;
    candidates.push(base + p);
    const end = base + p + EOCD_SIZE + v.getUint16(p + 20, true);
    if (end === size && exact === null) exact = p;
    if (end < size && fitting === null) fitting = p;
  }
  const p = exact ?? fitting;
  if (p === null) return null;
  const commentLength = v.getUint16(p + 20, true);
  const eocd: Eocd = {
    offset: base + p,
    disk: v.getUint16(p + 4, true),
    cdDisk: v.getUint16(p + 6, true),
    entriesOnDisk: v.getUint16(p + 8, true),
    entries: v.getUint16(p + 10, true),
    cdByteLength: v.getUint32(p + 12, true),
    cdOffset: v.getUint32(p + 16, true),
    commentLength,
  };
  const comment = decodeArchiveComment(tail.subarray(p + EOCD_SIZE, p + EOCD_SIZE + commentLength));
  return { eocd, comment, candidates };
}

/** Z64-1..3 */
async function readZip64(
  reader: Reader,
  eocdOffset: number,
  findings: FindingList,
): Promise<{ record: Zip64Record; shift: number } | null> {
  const locatorOffset = eocdOffset - LOCATOR_SIZE;
  const locator = await reader.bytes(locatorOffset, LOCATOR_SIZE);
  if (!locator || view(locator).getUint32(0, true) !== LOCATOR_SIGNATURE) return null;
  const lv = view(locator);
  const locatorDisk = lv.getUint32(4, true);
  const stated = u64(lv, 8);
  const totalDisks = lv.getUint32(16, true);
  if (stated === null) {
    tooLarge(findings, locatorOffset, 'ZIP64 end of central directory locator');
    return null;
  }
  // Z64-1
  if (locatorDisk !== 0 || totalDisks > 1) {
    findings.add(
      'zip.multi-disk',
      'The ZIP64 locator says this archive spans several disks; only this file is read.',
      { offset: locatorOffset },
    );
  }

  for (const offset of [stated, locatorOffset - ZIP64_SIZE]) {
    if (offset < 0 || offset + ZIP64_SIZE > locatorOffset) continue;
    const bytes = await reader.bytes(offset, ZIP64_SIZE);
    if (!bytes || view(bytes).getUint32(0, true) !== ZIP64_SIGNATURE) continue;
    const v = view(bytes);
    const sizeField = u64(v, 4);
    const big = [24, 32, 40, 48].map((at) => u64(v, at));
    const [entriesOnDisk, entries, cdByteLength, cdOffset] = big;
    if (
      sizeField === null ||
      entriesOnDisk == null ||
      entries == null ||
      cdByteLength == null ||
      cdOffset == null
    ) {
      tooLarge(findings, offset, 'ZIP64 end of central directory record');
      return null;
    }
    let byteLength = 12 + sizeField;
    if (sizeField < ZIP64_SIZE - 12 || offset + byteLength > locatorOffset) {
      findings.add(
        'zip64.record-size',
        `The ZIP64 record's size field (${sizeField}) is not usable; 56 bytes are assumed.`,
        { offset: offset + 4 },
      );
      byteLength = ZIP64_SIZE;
    }
    const shift = offset - stated;
    if (shift !== 0) {
      offsetsShifted(findings, shift, offset);
    }
    return {
      shift,
      record: {
        locatorOffset,
        locatorDisk,
        recordOffsetStated: stated,
        totalDisks,
        offset,
        byteLength,
        versionMadeBy: versionMadeBy(v.getUint16(12, true)),
        versionNeeded: versionNeeded(v.getUint16(14, true)),
        disk: v.getUint32(16, true),
        cdDisk: v.getUint32(20, true),
        entriesOnDisk,
        entries,
        cdByteLength,
        cdOffset,
      },
    };
  }
  findings.add(
    'zip64.record-missing',
    'A ZIP64 locator is present, but no ZIP64 end of central directory record was found.',
    { offset: locatorOffset },
  );
  return null;
}

const FIELDS = [
  ['disk', 0xffff],
  ['cdDisk', 0xffff],
  ['entriesOnDisk', 0xffff],
  ['entries', 0xffff],
  ['cdByteLength', 0xffffffff],
  ['cdOffset', 0xffffffff],
] as const;

type Values = Record<(typeof FIELDS)[number][0], number>;

/** Z64-4 */
function effectiveValues(eocd: Eocd, zip64: Zip64Record | null, findings: FindingList): Values {
  const values = {} as Values;
  const differing: string[] = [];
  const sentinels: string[] = [];
  for (const [field, sentinel] of FIELDS) {
    const raw = eocd[field];
    if (zip64) {
      values[field] = zip64[field];
      if (raw !== sentinel && raw !== zip64[field]) differing.push(field);
    } else {
      values[field] = raw;
      if (raw === sentinel) sentinels.push(field);
    }
  }
  if (differing.length > 0) {
    findings.add(
      'zip64.mismatch',
      `The EOCD and the ZIP64 record disagree on: ${differing.join(', ')}. The ZIP64 values are used.`,
      { offset: eocd.offset },
    );
  }
  if (sentinels.length > 0) {
    findings.add(
      'zip64.missing',
      `EOCD fields hold the ZIP64 sentinel, but there is no ZIP64 record: ${sentinels.join(', ')}.`,
      { offset: eocd.offset },
    );
  }
  return values;
}

export function tooLarge(findings: FindingList, offset: number, what: string, entry?: number) {
  findings.add(
    'zip.value-too-large',
    `A 64-bit value in the ${what} is too large to use; the ${what} is ignored.`,
    entry === undefined ? { offset } : { offset, entry },
  );
}

export function offsetsShifted(findings: FindingList, shift: number, offset: number) {
  findings.add(
    'zip.offsets-shifted',
    `Offsets in the archive are off by ${Math.abs(shift)} bytes, as if bytes were ${shift > 0 ? 'added before' : 'removed from'} the archive.`,
    { offset },
  );
}

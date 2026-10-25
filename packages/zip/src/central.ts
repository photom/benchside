/** Central directory (structure.md: CD-*, Z64-5, Z64-7; fields.md: NAME-*). */
import type { EndDraft } from './end-records.ts';
import { offsetsShifted, tooLarge } from './end-records.ts';
import { type RawBlock, splitExtra, toBlock, unicodePath, zip64Fields } from './extra.ts';
import {
  dosDateTime,
  externalAttributes,
  flags,
  internalAttributes,
  method,
  versionMadeBy,
  versionNeeded,
} from './fields.ts';
import type { FindingList } from './findings.ts';
import { type Reader, view } from './source.ts';
import { decodeCp437, decodeUtf8 } from './text.ts';
import type { CentralHeader, ExtraBlock, Name, Region, Text, Zip64Values } from './types.ts';

const CENTRAL_SIGNATURE = 0x02014b50; // 4.3.12
const SIGNATURE_RECORD = 0x05054b50; // 4.3.13
const HEADER_SIZE = 46;
const UTF8_FLAG = 0x0800; // 4.4.4 bit 11

export interface CentralEntry {
  readonly central: CentralHeader;
  readonly name: Name;
  readonly comment: Text;
  /** REP-4: effective values; the local header offset without the shift. */
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly hasZip64Extra: boolean;
}

export interface CentralResult {
  readonly entries: readonly CentralEntry[];
  readonly regions: readonly Region[];
  /** CD-2: the shift, possibly found here. */
  readonly shift: number;
}

export async function readCentral(
  reader: Reader,
  end: EndDraft,
  findings: FindingList,
  maxEntries: number,
): Promise<CentralResult> {
  const shift = await findShift(reader, end, findings);
  const start = end.cdOffset + shift;
  const entries: CentralEntry[] = [];
  const regions: Region[] = [];

  // CD-1
  if (start < 0 || start > end.endStart) {
    findings.add(
      'zip.cd.out-of-range',
      'The central directory offset points outside the archive.',
      { offset: end.eocd.offset },
    );
    return { entries, regions, shift };
  }
  let cdEnd = start + end.cdByteLength;
  if (cdEnd > end.endStart) {
    findings.add(
      'zip.cd.out-of-range',
      'The central directory size reaches past the end records; only the bytes before them are read.',
      { offset: start },
    );
    cdEnd = end.endStart;
  }

  // CD-3, CD-5
  let at = start;
  let stopped = false;
  for (let index = 0; index < end.entryCount; index++) {
    if (index >= maxEntries) {
      findings.add(
        'zip.too-many-entries',
        `Only the first ${maxEntries} of ${end.entryCount} entries are read.`,
      );
      stopped = true;
      break;
    }
    const remaining = cdEnd - at;
    if (remaining === 0) {
      findings.add(
        'zip.cd.count-mismatch',
        `The central directory ends after ${index} of ${end.entryCount} entries.`,
        { offset: at },
      );
      stopped = true;
      break;
    }
    const fixed = remaining >= HEADER_SIZE ? await reader.bytes(at, HEADER_SIZE) : null;
    if (!fixed) {
      truncated(findings, at);
      stopped = true;
      break;
    }
    const v = view(fixed);
    if (v.getUint32(0, true) !== CENTRAL_SIGNATURE) {
      findings.add(
        'zip.cd.bad-signature',
        `No central directory header signature at offset ${at}; reading stops.`,
        { offset: at },
      );
      stopped = true;
      break;
    }
    const nameLength = v.getUint16(28, true);
    const extraLength = v.getUint16(30, true);
    const commentLength = v.getUint16(32, true);
    const byteLength = HEADER_SIZE + nameLength + extraLength + commentLength;
    const header = byteLength <= remaining ? await reader.bytes(at, byteLength) : null;
    if (!header) {
      truncated(findings, at);
      stopped = true;
      break;
    }
    entries.push(parseHeader(header, at, index, findings));
    regions.push({ kind: 'central-header', offset: at, byteLength, entry: index });
    at += byteLength;
  }

  // CD-4
  if (!stopped && at < cdEnd) {
    const head = cdEnd - at >= 6 ? await reader.bytes(at, 6) : null;
    if (head && view(head).getUint32(0, true) === SIGNATURE_RECORD) {
      const byteLength = 6 + view(head).getUint16(4, true);
      if (at + byteLength <= cdEnd) {
        regions.push({ kind: 'digital-signature', offset: at, byteLength });
        at += byteLength;
      }
    }
    if (at < cdEnd) {
      findings.add(
        'zip.cd.size-mismatch',
        `${cdEnd - at} bytes of the central directory follow the last entry.`,
        { offset: at },
      );
    }
  }
  return { entries, regions, shift };
}

/** CD-2 */
async function findShift(reader: Reader, end: EndDraft, findings: FindingList): Promise<number> {
  if (end.shift !== 0 || end.entryCount === 0) return end.shift;
  if (await hasSignature(reader, end.cdOffset)) return 0;
  const expected = end.endStart - end.cdByteLength;
  if (expected === end.cdOffset || !(await hasSignature(reader, expected))) return 0;
  const shift = expected - end.cdOffset;
  offsetsShifted(findings, shift, expected);
  return shift;
}

async function hasSignature(reader: Reader, offset: number): Promise<boolean> {
  const bytes = await reader.bytes(offset, 4);
  return bytes !== null && view(bytes).getUint32(0, true) === CENTRAL_SIGNATURE;
}

function truncated(findings: FindingList, at: number) {
  findings.add(
    'zip.cd.truncated',
    `The central directory header at offset ${at} does not fit in the central directory; reading stops.`,
    { offset: at },
  );
}

function parseHeader(
  bytes: Uint8Array,
  offset: number,
  index: number,
  findings: FindingList,
): CentralEntry {
  const v = view(bytes);
  const madeBy = v.getUint16(4, true);
  const rawFlags = v.getUint16(8, true);
  const rawMethod = v.getUint16(10, true);
  const nameLength = v.getUint16(28, true);
  const extraLength = v.getUint16(30, true);
  const commentLength = v.getUint16(32, true);
  const nameBytes = bytes.slice(HEADER_SIZE, HEADER_SIZE + nameLength);
  const extraStart = HEADER_SIZE + nameLength;
  const raw = splitExtra(
    bytes.subarray(extraStart, extraStart + extraLength),
    offset + extraStart,
    findings,
    index,
  );
  const commentBytes = bytes.subarray(
    extraStart + extraLength,
    extraStart + extraLength + commentLength,
  );

  const compressedSize = v.getUint32(20, true);
  const uncompressedSize = v.getUint32(24, true);
  const diskStart = v.getUint16(34, true);
  const localHeaderOffset = v.getUint32(42, true);
  const zip64 = readZip64Extra(
    raw,
    {
      uncompressedSize: uncompressedSize === 0xffffffff,
      compressedSize: compressedSize === 0xffffffff,
      localHeaderOffset: localHeaderOffset === 0xffffffff,
      diskStart: diskStart === 0xffff,
    },
    offset,
    index,
    findings,
    'central directory header',
  );
  const utf8 = (rawFlags & UTF8_FLAG) !== 0;
  const { name, unicode } = decodeName(nameBytes, utf8, raw, offset, index, findings);
  const extra: ExtraBlock[] = raw.map((block) =>
    toBlock(block, {
      ...(block === zip64.block ? { zip64: zip64.values } : {}),
      ...(block === unicode?.block ? { unicodePath: unicode.path } : {}),
    }),
  );

  const central: CentralHeader = {
    offset,
    versionMadeBy: versionMadeBy(madeBy),
    versionNeeded: versionNeeded(v.getUint16(6, true)),
    flags: flags(rawFlags, rawMethod),
    method: method(rawMethod),
    modified: dosDateTime(v.getUint16(12, true), v.getUint16(14, true)),
    crc32: v.getUint32(16, true),
    compressedSize,
    uncompressedSize,
    nameLength,
    extraLength,
    commentLength,
    diskStart,
    internalAttributes: internalAttributes(v.getUint16(36, true)),
    externalAttributes: externalAttributes(v.getUint32(38, true), madeBy >>> 8),
    localHeaderOffset,
    nameBytes,
    extra,
  };
  return {
    central,
    name,
    comment: utf8
      ? { text: decodeUtf8(commentBytes).text, encoding: 'utf-8', guessed: false }
      : { text: decodeCp437(commentBytes), encoding: 'cp437', guessed: false },
    compressedSize: zip64.values.compressedSize ?? compressedSize,
    uncompressedSize: zip64.values.uncompressedSize ?? uncompressedSize,
    localHeaderOffset: zip64.values.localHeaderOffset ?? localHeaderOffset,
    hasZip64Extra: raw.some((b) => b.id === 0x0001),
  };
}

/** Z64-5..7, shared with local headers. */
export function readZip64Extra(
  raw: readonly RawBlock[],
  need: Parameters<typeof zip64Fields>[1],
  offset: number,
  entry: number,
  findings: FindingList,
  where: string,
): { block: RawBlock | null; values: Zip64Values } {
  const block = raw.find((b) => b.id === 0x0001) ?? null;
  if (!Object.values(need).some(Boolean)) return { block, values: {} };
  if (!block) {
    findings.add(
      'zip64.extra-missing',
      `The ${where} holds a ZIP64 sentinel but has no ZIP64 extra field.`,
      { offset, entry },
    );
    return { block, values: {} };
  }
  const { values, short, tooLarge: big } = zip64Fields(block.data, need);
  if (big) {
    tooLarge(findings, block.offset, `ZIP64 extra field of the ${where}`, entry);
    findings.add(
      'zip64.extra-missing',
      `The ${where} holds a ZIP64 sentinel but its ZIP64 extra field is ignored.`,
      { offset, entry },
    );
    return { block, values: {} };
  }
  if (short) {
    findings.add(
      'zip64.extra-short',
      `The ZIP64 extra field of the ${where} is shorter than the fields it must hold.`,
      { offset: block.offset, entry },
    );
  }
  return { block, values };
}

/** NAME-1..3 */
function decodeName(
  bytes: Uint8Array,
  utf8: boolean,
  raw: readonly RawBlock[],
  offset: number,
  index: number,
  findings: FindingList,
): {
  name: Name;
  unicode: { block: RawBlock; path: NonNullable<ReturnType<typeof unicodePath>> } | null;
} {
  const block = raw.find((b) => b.id === 0x7075);
  const path = block ? unicodePath(block.data, bytes) : null;
  const unicode = block && path ? { block, path } : null;
  if (utf8) {
    const { text, valid } = decodeUtf8(bytes);
    if (!valid) {
      findings.add(
        'zip.name.invalid-utf8',
        'The name is marked UTF-8 (flag bit 11) but is not valid UTF-8.',
        { offset, entry: index },
      );
    }
    return {
      name: { text, encoding: 'utf-8', guessed: false, source: 'utf-8-flag', bytes },
      unicode,
    };
  }
  if (unicode?.path.matches) {
    return {
      name: {
        text: unicode.path.name,
        encoding: 'utf-8',
        guessed: false,
        source: 'unicode-path',
        bytes,
      },
      unicode,
    };
  }
  if (unicode && unicode.path.version === 1) {
    findings.add(
      'zip.unicode-path.stale',
      'The Unicode Path extra field does not match the name (CRC-32 differs) and is ignored.',
      { offset: unicode.block.offset, entry: index },
    );
  }
  return {
    name: { text: decodeCp437(bytes), encoding: 'cp437', guessed: false, source: 'cp437', bytes },
    unicode,
  };
}

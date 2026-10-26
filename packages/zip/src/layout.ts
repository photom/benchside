/** Field layouts of byte-map regions (hex-view.md: HEX-6, HEX-10, HEX-11). */
import type { ExtraBlock, Region, ZipReport } from './types.ts';

export interface FieldSpan {
  readonly name: string;
  readonly offset: number;
  readonly byteLength: number;
  /** HEX-7: a little-endian number, not text or opaque data. */
  readonly numeric: boolean;
}

type Fixed = readonly (readonly [name: string, byteLength: number])[];

// APPNOTE 4.3.7
const LOCAL: Fixed = [
  ['local file header signature', 4],
  ['version needed to extract', 2],
  ['general purpose bit flag', 2],
  ['compression method', 2],
  ['last mod file time', 2],
  ['last mod file date', 2],
  ['crc-32', 4],
  ['compressed size', 4],
  ['uncompressed size', 4],
  ['file name length', 2],
  ['extra field length', 2],
];

// APPNOTE 4.3.12
const CENTRAL: Fixed = [
  ['central file header signature', 4],
  ['version made by', 2],
  ['version needed to extract', 2],
  ['general purpose bit flag', 2],
  ['compression method', 2],
  ['last mod file time', 2],
  ['last mod file date', 2],
  ['crc-32', 4],
  ['compressed size', 4],
  ['uncompressed size', 4],
  ['file name length', 2],
  ['extra field length', 2],
  ['file comment length', 2],
  ['disk number start', 2],
  ['internal file attributes', 2],
  ['external file attributes', 4],
  ['relative offset of local header', 4],
];

// APPNOTE 4.3.16
const EOCD: Fixed = [
  ['end of central dir signature', 4],
  ['number of this disk', 2],
  ['number of the disk with the start of the central directory', 2],
  ['total number of entries in the central directory on this disk', 2],
  ['total number of entries in the central directory', 2],
  ['size of the central directory', 4],
  ['offset of start of central directory', 4],
  ['.ZIP file comment length', 2],
];

// APPNOTE 4.3.14
const ZIP64_EOCD: Fixed = [
  ['zip64 end of central dir signature', 4],
  ['size of zip64 end of central directory record', 8],
  ['version made by', 2],
  ['version needed to extract', 2],
  ['number of this disk', 4],
  ['number of the disk with the start of the central directory', 4],
  ['total number of entries in the central directory on this disk', 8],
  ['total number of entries in the central directory', 8],
  ['size of the central directory', 8],
  ['offset of start of central directory', 8],
];

// APPNOTE 4.3.15
const ZIP64_LOCATOR: Fixed = [
  ['zip64 end of central dir locator signature', 4],
  ['number of the disk with the start of the zip64 end of central directory', 4],
  ['relative offset of the zip64 end of central directory record', 8],
  ['total number of disks', 4],
];

// APPNOTE 4.3.13
const DIGITAL_SIGNATURE: Fixed = [
  ['header signature', 4],
  ['size of data', 2],
];

/** HEX-6: the fields of a region, in order; none for regions without a layout. */
export function regionFields(report: ZipReport, region: Region): FieldSpan[] {
  return cut(layout(report, region), region);
}

function layout(report: ZipReport, region: Region): FieldSpan[] {
  const entry = region.entry === undefined ? undefined : report.entries[region.entry];
  const at = new Cursor(region.offset);
  switch (region.kind) {
    case 'local-header': {
      const local = entry?.local;
      if (!local) return [];
      return [
        ...at.fixed(LOCAL),
        at.next('file name', local.nameLength, false),
        ...extraFields(local.extra),
      ];
    }
    case 'central-header': {
      const central = entry?.central;
      if (!central) return [];
      const fields = [
        ...at.fixed(CENTRAL),
        at.next('file name', central.nameLength, false),
        ...extraFields(central.extra),
      ];
      at.skip(central.extraLength);
      return [...fields, at.next('file comment', central.commentLength, false)];
    }
    case 'data-descriptor': {
      const descriptor = entry?.descriptor;
      if (!descriptor) return [];
      // 4.3.9.1: ZIP64 sizes are 8 bytes each.
      const width = (descriptor.byteLength - (descriptor.signature ? 4 : 0) - 4) / 2;
      return [
        ...(descriptor.signature ? [at.next('signature', 4)] : []),
        at.next('crc-32', 4),
        at.next('compressed size', width),
        at.next('uncompressed size', width),
      ];
    }
    case 'eocd':
      return [...at.fixed(EOCD), at.rest('.ZIP file comment', region)];
    case 'zip64-eocd':
      return [...at.fixed(ZIP64_EOCD), at.rest('zip64 extensible data sector', region)];
    case 'zip64-locator':
      return at.fixed(ZIP64_LOCATOR);
    case 'digital-signature':
      return [...at.fixed(DIGITAL_SIGNATURE), at.rest('signature data', region)];
    case 'file-data':
    case 'prepended':
    case 'gap':
    case 'trailing':
    case 'unknown':
      return [];
    default: {
      const never: never = region.kind;
      return never;
    }
  }
}

/** HEX-10: each block's header ID, data size, and data; a block with no ID is one field. */
function extraFields(blocks: readonly ExtraBlock[]): FieldSpan[] {
  return blocks.flatMap((b) => {
    if (b.id === null) {
      return [{ name: b.name, offset: b.offset, byteLength: b.byteLength, numeric: false }];
    }
    const label = `extra 0x${b.id.toString(16).padStart(4, '0')} ${b.name}`;
    return [
      { name: `${label}: header ID`, offset: b.offset, byteLength: 2, numeric: true },
      { name: `${label}: data size`, offset: b.offset + 2, byteLength: 2, numeric: true },
      { name: `${label}: data`, offset: b.offset + 4, byteLength: b.byteLength, numeric: false },
    ];
  });
}

/** HEX-11: fields stop at the region's end; empty ones are dropped. */
function cut(fields: FieldSpan[], region: Region): FieldSpan[] {
  const end = region.offset + region.byteLength;
  return fields
    .map((f) => ({ ...f, byteLength: Math.min(f.byteLength, end - f.offset) }))
    .filter((f) => f.byteLength > 0);
}

class Cursor {
  private at: number;

  constructor(offset: number) {
    this.at = offset;
  }

  next(name: string, byteLength: number, numeric = true): FieldSpan {
    const field = { name, offset: this.at, byteLength, numeric };
    this.at += byteLength;
    return field;
  }

  fixed(fields: Fixed): FieldSpan[] {
    return fields.map(([name, byteLength]) => this.next(name, byteLength));
  }

  skip(byteLength: number) {
    this.at += byteLength;
  }

  rest(name: string, region: Region): FieldSpan {
    return this.next(name, region.offset + region.byteLength - this.at, false);
  }
}

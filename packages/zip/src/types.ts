/** The report data model (report.md). Plain data, safe for postMessage. */
import type { Parameters } from './parameters.ts';

export type Severity = 'error' | 'warning' | 'info';

/** REP-10 */
export type Category = 'structure' | 'security' | 'disagreement';

export interface Finding {
  readonly id: FindingId;
  readonly severity: Severity;
  readonly category: Category;
  readonly message: string;
  /** REP-7: the APPNOTE section behind the finding. */
  readonly section?: string;
  readonly offset?: number;
  readonly entry?: number;
}

export type FindingId =
  | 'zip.eocd.missing'
  | 'zip.eocd.trailing-data'
  | 'zip.multi-disk'
  | 'zip.value-too-large'
  | 'zip64.record-missing'
  | 'zip64.record-size'
  | 'zip64.mismatch'
  | 'zip64.missing'
  | 'zip64.extra-missing'
  | 'zip64.extra-short'
  | 'zip.offsets-shifted'
  | 'zip.cd.out-of-range'
  | 'zip.cd.bad-signature'
  | 'zip.cd.truncated'
  | 'zip.cd.size-mismatch'
  | 'zip.cd.count-mismatch'
  | 'zip.too-many-entries'
  | 'zip.local.out-of-range'
  | 'zip.local.bad-signature'
  | 'zip.local.mismatch'
  | 'zip.data.truncated'
  | 'zip.descriptor.truncated'
  | 'zip.descriptor.mismatch'
  | 'zip.gap'
  | 'zip.overlap'
  | 'zip.name.invalid-utf8'
  | 'zip.unicode-path.stale'
  | 'zip.extra.malformed'
  | 'zip.too-many-findings'
  | 'nested.size-mismatch'
  | 'nested.crc-mismatch'
  | 'sec.path-traversal'
  | 'sec.absolute-path'
  | 'sec.backslash'
  | 'sec.duplicate-name'
  | 'sec.name-collision'
  | 'sec.reserved-name'
  | 'sec.symlink'
  | 'sec.control-character'
  | 'sec.bidi-character'
  | 'sec.long-path'
  | 'sec.compression-ratio'
  | 'sec.archive-ratio'
  | 'sec.total-size'
  | 'sec.file-count'
  | 'sec.overlapping-entries'
  | 'rd.eocd-candidates'
  | 'rd.name-encoding'
  | 'rd.hidden-header'
  | 'rd.scan-limit';

export interface Range {
  readonly offset: number;
  readonly byteLength: number;
}

export type RegionKind =
  | 'local-header'
  | 'file-data'
  | 'data-descriptor'
  | 'central-header'
  | 'digital-signature'
  | 'zip64-eocd'
  | 'zip64-locator'
  | 'eocd'
  | 'prepended'
  | 'gap'
  | 'trailing'
  | 'unknown';

export interface Region extends Range {
  readonly kind: RegionKind;
  readonly entry?: number;
}

export interface Text {
  readonly text: string;
  readonly encoding: 'utf-8' | 'cp437';
  /** NAME-4: true when the encoding was guessed. */
  readonly guessed: boolean;
}

export interface Name extends Text {
  /** NAME-1..3: where the name came from. */
  readonly source: 'utf-8-flag' | 'unicode-path' | 'cp437';
  /** NAME-5 */
  readonly bytes: Uint8Array;
}

export interface Version {
  readonly raw: number;
  /** FLD-1: only for "version made by". */
  readonly host?: string;
  /** "6.3" */
  readonly spec: string;
}

export interface Flags {
  readonly raw: number;
  readonly bits: readonly { readonly bit: number; readonly name: string }[];
}

export interface Method {
  readonly code: number;
  readonly name: string;
}

export interface DosDateTime {
  readonly time: number;
  readonly date: number;
  /** FLD-5: `YYYY-MM-DD hh:mm:ss`, or null when invalid. */
  readonly text: string | null;
}

export interface Zip64Values {
  readonly uncompressedSize?: number;
  readonly compressedSize?: number;
  readonly localHeaderOffset?: number;
  readonly diskStart?: number;
}

export interface UnicodePath {
  readonly version: number;
  readonly nameCrc32: number;
  readonly name: string;
  /** NAME-2: the CRC-32 matches the header's name bytes. */
  readonly matches: boolean;
}

export interface ExtraBlock {
  /** null for the malformed rest (EXT-1). */
  readonly id: number | null;
  readonly name: string;
  /** Offset of the block's header in the archive. */
  readonly offset: number;
  /** Data size, excluding the 4-byte header. */
  readonly byteLength: number;
  /** EXT-3: the first 64 bytes of data. */
  readonly preview: Uint8Array;
  readonly zip64?: Zip64Values;
  readonly unicodePath?: UnicodePath;
  /** EXT-5..9 */
  readonly decoded?: DecodedExtra;
  /** EXT-10: zero padding; `id` is null as for a malformed rest. */
  readonly padding?: true;
}

/** EXT-5, EXT-11 */
export interface UnixTime {
  readonly seconds: number;
  /** `YYYY-MM-DD hh:mm:ss UTC` */
  readonly text: string;
}

/** EXT-7, EXT-11 */
export interface NtfsTime {
  /** The 64-bit FILETIME, in decimal. */
  readonly ticks: string;
  /** null when the FILETIME is 0 (not set). */
  readonly text: string | null;
}

export type DecodedExtra =
  | {
      readonly kind: 'timestamp';
      readonly flags: number;
      readonly modified?: UnixTime;
      readonly accessed?: UnixTime;
      readonly created?: UnixTime;
    }
  | {
      readonly kind: 'unix-owner';
      readonly version: number;
      readonly uid?: number;
      readonly gid?: number;
    }
  | {
      readonly kind: 'ntfs';
      readonly attributes: readonly { readonly tag: number; readonly byteLength: number }[];
      readonly modified?: NtfsTime;
      readonly accessed?: NtfsTime;
      readonly created?: NtfsTime;
    }
  | {
      readonly kind: 'aes';
      readonly vendorVersion: number;
      readonly version: 'AE-1' | 'AE-2' | 'unknown';
      readonly vendorId: string;
      readonly strength: number;
      readonly keyBits: number | null;
      readonly method: Method;
    }
  | {
      readonly kind: 'alignment';
      readonly alignment: number;
      readonly paddingBytes: number;
      /** Local header only; null when not checked. */
      readonly aligned: boolean | null;
    };

interface CommonHeader {
  readonly offset: number;
  readonly versionNeeded: Version;
  readonly flags: Flags;
  readonly method: Method;
  readonly modified: DosDateTime;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly nameLength: number;
  readonly extraLength: number;
  readonly nameBytes: Uint8Array;
  readonly extra: readonly ExtraBlock[];
}

export interface CentralHeader extends CommonHeader {
  readonly versionMadeBy: Version;
  readonly commentLength: number;
  readonly diskStart: number;
  readonly internalAttributes: { readonly raw: number; readonly text: boolean };
  readonly externalAttributes: {
    readonly raw: number;
    readonly dos: readonly string[];
    readonly unixMode: string | null;
  };
  readonly localHeaderOffset: number;
}

export interface LocalHeader extends CommonHeader {
  /** Z64-6: sizes after the ZIP64 extra field. */
  readonly effectiveCompressedSize: number;
  readonly effectiveUncompressedSize: number;
}

export interface Descriptor extends Range {
  readonly signature: boolean;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
}

export type MismatchField =
  | 'versionNeeded'
  | 'flags'
  | 'method'
  | 'time'
  | 'date'
  | 'name'
  | 'crc32'
  | 'compressedSize'
  | 'uncompressedSize';

export interface Entry {
  readonly index: number;
  readonly kind: 'file' | 'directory';
  readonly name: Name;
  readonly comment: Text;
  readonly central: CentralHeader;
  readonly local: LocalHeader | null;
  /** REP-4: effective values. */
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc32: number;
  readonly localHeaderOffset: number;
  readonly zip64: boolean;
  readonly data: Range | null;
  readonly descriptor: Descriptor | null;
  readonly mismatches: readonly MismatchField[];
  readonly archiveHint: boolean;
}

export interface Eocd {
  readonly offset: number;
  readonly disk: number;
  readonly cdDisk: number;
  readonly entriesOnDisk: number;
  readonly entries: number;
  readonly cdByteLength: number;
  readonly cdOffset: number;
  readonly commentLength: number;
}

export interface Zip64Record {
  readonly locatorOffset: number;
  readonly locatorDisk: number;
  readonly recordOffsetStated: number;
  readonly totalDisks: number;
  readonly offset: number;
  readonly byteLength: number;
  readonly versionMadeBy: Version;
  readonly versionNeeded: Version;
  readonly disk: number;
  readonly cdDisk: number;
  readonly entriesOnDisk: number;
  readonly entries: number;
  readonly cdByteLength: number;
  readonly cdOffset: number;
}

export interface EndRecords {
  readonly eocd: Eocd;
  readonly zip64: Zip64Record | null;
  /** CD-2, Z64-2 */
  readonly shift: number;
  /** REP-2: effective values; cdOffset without the shift. */
  readonly entryCount: number;
  readonly cdOffset: number;
  readonly cdByteLength: number;
  readonly comment: Text;
  /** REP-11 */
  readonly eocdCandidates: readonly number[];
}

export interface ZipReport {
  readonly byteLength: number;
  readonly path: readonly number[];
  readonly end: EndRecords | null;
  readonly entries: readonly Entry[];
  readonly regions: readonly Region[];
  readonly findings: readonly Finding[];
  /** REP-9 */
  readonly parameters: Parameters;
}

export type RefusalReason =
  | 'directory'
  | 'too-deep'
  | 'encrypted'
  | 'unsupported-method'
  | 'unreadable'
  | 'too-large'
  | 'size-exceeded'
  | 'inflate-failed';

export type NestedResult =
  | { readonly kind: 'report'; readonly report: ZipReport }
  | { readonly kind: 'refused'; readonly reason: RefusalReason };

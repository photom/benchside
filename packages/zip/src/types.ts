/** The report data model (report.md). Plain data, safe for postMessage. */

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  readonly id: FindingId;
  readonly severity: Severity;
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
  | 'nested.crc-mismatch';

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
}

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
}

export interface ZipReport {
  readonly byteLength: number;
  readonly path: readonly number[];
  readonly end: EndRecords | null;
  readonly entries: readonly Entry[];
  readonly regions: readonly Region[];
  readonly findings: readonly Finding[];
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

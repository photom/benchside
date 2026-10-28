/** The report data model (report.md). Plain data, safe for postMessage. */

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  readonly id: FindingId;
  readonly severity: Severity;
  readonly message: string;
  /** REP-6: the ISO 32000-1 clause behind the finding. */
  readonly clause?: string;
  readonly offset?: number;
  readonly object?: number;
}

export type FindingId =
  | 'pdf.header.missing'
  | 'pdf.header.offset'
  | 'pdf.header.version'
  | 'pdf.startxref.missing'
  | 'pdf.eof.missing'
  | 'pdf.eof.trailing'
  | 'pdf.xref.out-of-range'
  | 'pdf.xref.not-found'
  | 'pdf.xref.entry-format'
  | 'pdf.xref.duplicate-entry'
  | 'pdf.xref.first-entry'
  | 'pdf.trailer.missing'
  | 'pdf.trailer.root'
  | 'pdf.trailer.size'
  | 'pdf.xref-stream.dict'
  | 'pdf.xref-stream.filter'
  | 'pdf.xref-stream.decode'
  | 'pdf.xref-stream.short'
  | 'pdf.xref.loop'
  | 'pdf.xref.too-many-sections'
  | 'pdf.object.out-of-range'
  | 'pdf.object.header-mismatch'
  | 'pdf.object.endobj-missing'
  | 'pdf.object.too-large'
  | 'pdf.stream.eol'
  | 'pdf.stream.length'
  | 'pdf.syntax.error'
  | 'pdf.syntax.depth'
  | 'pdf.dict.key'
  | 'pdf.dict.duplicate-key'
  | 'pdf.value-too-large'
  | 'pdf.encrypted'
  | 'pdf.gap'
  | 'pdf.overlap'
  | 'pdf.too-many-objects'
  | 'pdf.too-many-findings'
  | 'pdf.filter.error'
  | 'pdf.filter.unsupported'
  | 'pdf.filter.limit'
  | 'pdf.objstm.invalid'
  | 'pdf.objstm.missing'
  | 'pdf.catalog.missing'
  | 'pdf.catalog.type'
  | 'pdf.info.invalid'
  | 'pdf.pages.missing'
  | 'pdf.pages.kid'
  | 'pdf.pages.loop'
  | 'pdf.pages.count'
  | 'pdf.page.mediabox'
  | 'pdf.tree.loop'
  | 'pdf.tree.limit'
  | 'pdf.action.unknown'
  | 'pdf.action.loop'
  | 'pdf.action.javascript'
  | 'pdf.action.launch'
  | 'pdf.action.submit-form'
  | 'pdf.action.import-data'
  | 'pdf.action.remote'
  | 'pdf.action.automatic'
  | 'pdf.too-many-actions';

/** An indirect reference `n g R` (OBJ-8). */
export interface Ref {
  readonly number: number;
  readonly generation: number;
}

export interface Header {
  readonly offset: number;
  /** HDR-2: as written, e.g. "1.7". */
  readonly version: string;
  /** HDR-3 */
  readonly binaryMarker: boolean;
}

/** TRL-2 */
export interface Trailer {
  readonly size: number | null;
  readonly prev: number | null;
  readonly root: Ref | null;
  readonly info: Ref | null;
  readonly encrypt: boolean;
  /** REP-2: the two ID strings in hex. */
  readonly id: readonly string[] | null;
  readonly xrefStm: number | null;
}

export interface Revision {
  /** REP-1: 0 is the oldest. */
  readonly index: number;
  readonly offset: number;
  readonly kind: 'table' | 'stream';
  readonly trailer: Trailer;
  /** REV-2: the XRefStm stream read with this table, if any. */
  readonly xrefStm: number | null;
  readonly entryCount: number;
}

export interface StreamInfo {
  readonly dataOffset: number;
  readonly byteLength: number;
  readonly filters: readonly string[];
}

export interface PdfObject {
  readonly number: number;
  readonly generation: number;
  readonly status: 'in-use' | 'compressed' | 'free';
  readonly revision: number;
  /** REV-4: older revisions that also defined this object. */
  readonly replaced: readonly number[];
  readonly offset?: number;
  /** OBX-3: the object stream holding a compressed object, and its index there. */
  readonly container?: number;
  readonly index?: number;
  readonly type?: string;
  readonly subtype?: string;
  readonly stream?: StreamInfo;
}

export type RegionKind =
  | 'header'
  | 'object'
  | 'xref-stream'
  | 'xref-table'
  | 'trailer'
  | 'startxref'
  | 'prepended'
  | 'trailing'
  | 'gap'
  | 'unknown';

export interface Region {
  readonly kind: RegionKind;
  readonly offset: number;
  readonly byteLength: number;
  readonly object?: number;
}

/** REP-9, TXT: decoded text; null when the file is encrypted. */
export interface Text {
  readonly text: string | null;
  readonly truncated: boolean;
}

/** CAT-3 */
export interface Catalog {
  readonly object: number | null;
  readonly version: string | null;
  readonly pageLayout: string | null;
  readonly pageMode: string | null;
  readonly lang: Text | null;
  readonly keys: readonly string[];
}

/** INF-2 */
export interface InfoEntry {
  readonly key: string;
  readonly kind: 'text' | 'name' | 'other';
  readonly value: Text;
}

export interface Info {
  readonly object: number | null;
  readonly entries: readonly InfoEntry[];
}

/** ANN-1 */
export interface Annotation {
  readonly object: number | null;
  readonly subtype: string | null;
}

/** PG-2..6 */
export interface Page {
  readonly index: number;
  readonly object: number | null;
  readonly mediaBox: readonly number[] | null;
  readonly cropBox: readonly number[] | null;
  readonly rotate: number;
  readonly annotations: readonly Annotation[];
}

/** REP-8 */
export interface PdfDocument {
  readonly catalog: Catalog | null;
  readonly info: Info | null;
  readonly pageCount: number | null;
  readonly pages: readonly Page[];
  readonly outlineItems: number;
  readonly fields: number;
}

/** ACT-1 */
export type ActionSource = 'catalog' | 'names' | 'page' | 'annotation' | 'field' | 'outline';

/** ACT-7 */
export interface Script {
  readonly text: Text;
  readonly byteLength: number;
}

/** REP-10 */
export interface Action {
  readonly type: string;
  readonly source: ActionSource;
  readonly event: string;
  readonly automatic: boolean;
  readonly depth: number;
  readonly page?: number;
  readonly holder?: number;
  readonly object?: number;
  readonly label?: string;
  readonly target?: Text;
  readonly script?: Script;
}

export interface PdfReport {
  readonly byteLength: number;
  readonly header: Header | null;
  /** REP-1: newest first. */
  readonly revisions: readonly Revision[];
  readonly objects: readonly PdfObject[];
  readonly trailer: Trailer | null;
  readonly encrypted: boolean;
  readonly regions: readonly Region[];
  readonly document: PdfDocument | null;
  readonly actions: readonly Action[];
  readonly findings: readonly Finding[];
}

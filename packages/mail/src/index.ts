export type { AnalyzeDeps, AnalyzeOptions, PartialReport } from './analyze.ts';
export { analyze } from './analyze.ts';
export type {
  ArcNotEvaluatedReason,
  ArcReport,
  ArcResult,
  ArcSetTrace,
  ArcSignatureTrace,
} from './arc/verify.ts';
export type { AuthResult } from './authres/list.ts';
export type { AuthResultEntry } from './authres/parse.ts';
export type {
  DkimNotEvaluatedReason,
  DkimResult,
  DkimSignatureResult,
  DkimTrace,
} from './dkim/verify.ts';
export { createDnsCache, type DnsCache } from './dns/cache.ts';
export { type ComposedResolver, composeResolver, dnsFindings } from './dns/compose.ts';
export { type ManualRecord, offlineTransport } from './dns/offline.ts';
export { joinTxtData } from './dns/txt.ts';
export type {
  DnsAnswer,
  DnsLogEntry,
  DnsQuery,
  DnsType,
  Lookup,
  Rcode,
  Transport,
} from './dns/types.ts';
export type { ParsedReceived } from './envelope/received.ts';
export type { ReferenceTimeMode } from './envelope/reference-time.ts';
export type { Envelope, EnvelopeValue, FieldSource } from './envelope/values.ts';
export type { HeaderBlock, HeaderField } from './message/headers.ts';
export { splitHeaders } from './message/headers.ts';
export type { SummaryLine } from './report/summary.ts';
export type { ByteRange } from './shared/bytes.ts';
export type { Evidence, Finding, Severity } from './shared/findings.ts';
export type {
  SpfIdentityResult,
  SpfNode,
  SpfNotEvaluatedReason,
  SpfResult,
  SpfResults,
  SpfTermTrace,
} from './spf/evaluate.ts';

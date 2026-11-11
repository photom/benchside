// The DoH transport is a separate entry point, `@benchside/dns/doh`: only app workers import it (0014).
export { createDnsCache, type DnsCache } from './cache.ts';
export { type ComposedResolver, composeResolver } from './compose.ts';
export { toALabels } from './idna.ts';
export { type Ip, parseIp, reverseName } from './ip.ts';
export { type ManualRecord, offlineTransport } from './offline.ts';
export { joinTxtData } from './txt.ts';
export type {
  DnsAnswer,
  DnsLogEntry,
  DnsQuery,
  DnsType,
  Lookup,
  Rcode,
  Transport,
} from './types.ts';

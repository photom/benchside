/** Resolver contract (docs/reference/mail/dns.md). */
export type DnsType = 'TXT' | 'A' | 'AAAA' | 'MX' | 'PTR';

export type Rcode =
  | 'NOERROR'
  | 'NXDOMAIN'
  | 'SERVFAIL'
  | 'TIMEOUT'
  | 'BUDGET'
  | 'BLOCKED'
  | 'OFFLINE';

export interface DnsQuery {
  readonly name: string;
  readonly type: DnsType;
  /** `sensitive` names carry more than domain names from the message (DNS-9). */
  readonly sensitivity: 'domain' | 'sensitive';
  /** Why the check asks, shown in the log: for example `DKIM key for sel._domainkey.example.com`. */
  readonly purpose: string;
}

/** What a transport returns. `NOERROR` with no records is NODATA (DNS-2). */
export interface Lookup {
  readonly rcode: Rcode;
  readonly records: readonly string[];
  readonly authenticated: boolean;
}

export interface DnsAnswer extends Lookup {
  readonly queryId: string;
}

/** The only way out to DNS. The app passes DoH; tests and offline mode pass their own (DNS-1). */
export type Transport = (
  q: { readonly name: string; readonly type: DnsType },
  signal: AbortSignal,
) => Promise<Lookup>;

/** DNS-15 */
export interface DnsLogEntry extends DnsAnswer {
  readonly name: string;
  readonly type: DnsType;
  readonly sensitivity: DnsQuery['sensitivity'];
  readonly purpose: string;
  readonly durationMs: number;
  readonly cacheHit: boolean;
}

import type { DnsType, Lookup } from './types.ts';

/**
 * Finished answers per `(source, name, type)`, kept until the page closes (DNS-14).
 * Shared across analyses, so it never holds pending lookups.
 */
export interface DnsCache {
  readonly answers: Map<string, Lookup>;
}

export function createDnsCache(): DnsCache {
  return { answers: new Map() };
}

/** `name` is already in A-label form (DNS-18). */
export function cacheKey(source: string, name: string, type: DnsType): string {
  return `${source} ${type} ${name.toLowerCase()}`;
}

/** DNS-14: only these are cached; failures may succeed on the next try. */
export function isCacheable(answer: Lookup): boolean {
  return answer.rcode === 'NOERROR' || answer.rcode === 'NXDOMAIN';
}

import { toALabels } from '../shared/domain.ts';
import type { Finding } from '../shared/findings.ts';
import { cacheKey, type DnsCache, isCacheable } from './cache.ts';
import type { DnsAnswer, DnsLogEntry, DnsQuery, Lookup, Transport } from './types.ts';

export interface ComposedResolver {
  resolve(query: DnsQuery, signal: AbortSignal): Promise<DnsAnswer>;
  /** Finished queries in `queryId` order, including blocked, over-budget, and cached ones (DNS-15). */
  readonly log: readonly DnsLogEntry[];
}

/**
 * One resolver per analysis. Steps inside `resolve`: log → budget → policy →
 * cache → transport (design: mail-design/dns.md). Only `cache` is shared across analyses.
 */
export function composeResolver(o: {
  transport: Transport;
  /** `cloudflare`, `google`, or `offline`: part of the cache key (DNS-14). */
  source: string;
  cache: DnsCache;
  budget: number;
  allowSensitive: boolean;
}): ComposedResolver {
  /** Indexed by queryId number − 1; a query that threw leaves its slot empty. */
  const slots: (DnsLogEntry | undefined)[] = [];
  /** This analysis only: identical concurrent queries share one request (DNS-14). */
  const inFlight = new Map<string, Promise<Lookup>>();
  let issued = 0;

  async function lookup(
    q: DnsQuery,
    n: number,
    signal: AbortSignal,
  ): Promise<Lookup & { cacheHit: boolean }> {
    // DNS-13: the n-th query of this analysis; counted before the cache, so cache hits count.
    if (n > o.budget) return { ...empty('BUDGET'), cacheHit: false };
    // DNS-10
    if (q.sensitivity === 'sensitive' && !o.allowSensitive) {
      return { ...empty('BLOCKED'), cacheHit: false };
    }
    // DNS-18
    const name = toALabels(q.name);
    if (name === null) return { ...empty('SERVFAIL'), cacheHit: false };

    const key = cacheKey(o.source, name, q.type);
    const cached = o.cache.answers.get(key);
    if (cached) return { ...cached, cacheHit: true };
    const shared = inFlight.get(key);
    if (shared) {
      const answer = await shared;
      return { ...answer, cacheHit: isCacheable(answer) };
    }
    const pending = o.transport({ name, type: q.type }, signal);
    inFlight.set(key, pending);
    try {
      const answer = await pending;
      if (isCacheable(answer)) o.cache.answers.set(key, answer);
      return { ...answer, cacheHit: false };
    } finally {
      inFlight.delete(key);
    }
  }

  return {
    get log() {
      return slots.filter((e) => e !== undefined);
    },
    async resolve(q, signal) {
      const n = ++issued;
      const queryId = `q${n}`;
      const started = performance.now();
      const { cacheHit, ...answer } = await lookup(q, n, signal);
      slots[n - 1] = {
        ...answer,
        queryId,
        name: q.name,
        type: q.type,
        sensitivity: q.sensitivity,
        purpose: q.purpose,
        durationMs: performance.now() - started,
        cacheHit,
      };
      return { ...answer, queryId };
    },
  };
}

function empty(rcode: 'BUDGET' | 'BLOCKED' | 'SERVFAIL'): Lookup {
  return { rcode, records: [], authenticated: false };
}

/** Findings that follow from the log alone (design: mail-design/dns.md). */
export function dnsFindings(log: readonly DnsLogEntry[]): Finding[] {
  const findings: Finding[] = [];
  const over = log.filter((e) => e.rcode === 'BUDGET');
  if (over.length > 0) {
    findings.push({
      id: 'dns.budget-exhausted',
      severity: 'error',
      message: `More than the allowed number of DNS queries were needed. ${over.length} were not sent.`,
      evidence: over.map((e) => ({ kind: 'dns', queryId: e.queryId })),
    });
  }
  const blocked = log.filter((e) => e.rcode === 'BLOCKED');
  if (blocked.length > 0) {
    findings.push({
      id: 'dns.blocked-sensitive',
      severity: 'info',
      message:
        'Some DNS queries would have revealed more than domain names, so they were not sent.',
      evidence: blocked.map((e) => ({ kind: 'dns', queryId: e.queryId })),
    });
  }
  return findings;
}

/** RFC 9989 policy discovery and organizational domain (DMARC-4..6, DMARC-22). */
import type { DnsAnswer, DnsQuery } from '../dns/types.ts';
import type { Finding } from '../shared/findings.ts';
import { looksLikeDmarc, parseDmarcRecord } from './record.ts';

export interface DmarcRecordAt {
  /** The domain whose `_dmarc` name holds the record. */
  readonly name: string;
  readonly text: string;
  readonly tags: ReadonlyMap<string, string>;
  readonly queryId: string;
}

export interface Walk {
  /** The first valid record found (DMARC-4, DMARC-5). */
  readonly policy: DmarcRecordAt | null;
  readonly orgDomain: string;
  readonly orgDomainRule: string;
  readonly queryIds: readonly string[];
  readonly findings: readonly Finding[];
  /** A DNS outcome that stopped the walk (DMARC-23). */
  readonly error?: 'temperror' | 'offline' | 'sensitive-query-blocked';
}

export interface WalkContext {
  readonly resolve: (query: DnsQuery, signal: AbortSignal) => Promise<DnsAnswer>;
  readonly signal: AbortSignal;
}

const MAX_QUERIES = 8; // DMARC-5
const MAX_LABELS = 8; // DMARC-5: more labels than this start the walk at the rightmost 7

export async function treeWalk(ctx: WalkContext, domain: string): Promise<Walk> {
  const labels = domain.split('.');
  // DMARC-4, DMARC-5: the author domain, then from its parent (or its rightmost 7 labels) up.
  const start = labels.length > MAX_LABELS ? labels.length - (MAX_LABELS - 1) : 1;
  const names = [domain, ...labels.slice(start).map((_, i) => labels.slice(start + i).join('.'))];
  const records: DmarcRecordAt[] = [];
  const queryIds: string[] = [];
  const findings: Finding[] = [];
  const result = (error?: Walk['error']): Walk => {
    const org = organizationalDomain(domain, records);
    return {
      policy: records[0] ?? null,
      orgDomain: org.name,
      orgDomainRule: org.rule,
      queryIds,
      findings,
      ...(error ? { error } : {}),
    };
  };

  for (const name of names.slice(0, MAX_QUERIES)) {
    const answer = await ctx.resolve(
      {
        name: `_dmarc.${name}`,
        type: 'TXT',
        sensitivity: 'domain',
        purpose: `DMARC record for ${name}`,
      },
      ctx.signal,
    );
    queryIds.push(answer.queryId);
    // DMARC-22: after a record is found, a lookup problem only ends the walk.
    const failed = answer.rcode !== 'NOERROR' && answer.rcode !== 'NXDOMAIN';
    if (failed && records.length > 0) break;
    switch (answer.rcode) {
      case 'SERVFAIL':
      case 'TIMEOUT':
      case 'BUDGET':
        return result('temperror');
      case 'OFFLINE':
        return result('offline');
      case 'BLOCKED':
        return result('sensitive-query-blocked');
    }
    const candidates = answer.records.filter(looksLikeDmarc);
    if (candidates.length > 1) {
      findings.push({
        id: 'dmarc.multiple-records',
        severity: 'error',
        message: `_dmarc.${name} has more than one DMARC record, so none is used.`,
        evidence: [{ kind: 'dns', queryId: answer.queryId }],
      });
      continue;
    }
    const [text] = candidates;
    const tags = text === undefined ? null : parseDmarcRecord(text);
    if (text === undefined || !tags) continue;
    records.push({ name, text, tags, queryId: answer.queryId });
    // DMARC-22: a psd tag marks the top of the walk.
    const psd = tags.get('psd')?.toLowerCase();
    if (psd === 'y' || psd === 'n') break;
  }
  return result();
}

/** DMARC-6, DMARC-22: from the records found, longest name first. */
function organizationalDomain(
  domain: string,
  records: readonly DmarcRecordAt[],
): { name: string; rule: string } {
  for (const r of records) {
    const psd = r.tags.get('psd')?.toLowerCase();
    if (psd === 'n') return { name: r.name, rule: `psd=n at ${r.name}` };
    if (psd === 'y' && r.name !== domain) {
      const below = domain
        .split('.')
        .slice(-(r.name.split('.').length + 1))
        .join('.');
      return { name: below, rule: `one label below psd=y at ${r.name}` };
    }
  }
  const shortest = records.at(-1);
  if (shortest) return { name: shortest.name, rule: 'shortest name with a DMARC record' };
  return { name: domain, rule: 'no DMARC record found; the domain itself' };
}

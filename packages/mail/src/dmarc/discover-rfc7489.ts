/** RFC 7489 policy discovery: the author domain, then its PSL organizational domain (DMARC-7, DMARC-8). */
import { organizationalDomain, type PublicSuffixList } from '../psl/lookup.ts';
import type { Finding } from '../shared/findings.ts';
import type { DmarcRecordAt, Walk, WalkContext } from './discover-rfc9989.ts';
import { looksLikeDmarc, parseDmarcRecord } from './record.ts';

export async function discover7489(
  ctx: WalkContext,
  psl: PublicSuffixList,
  domain: string,
): Promise<Walk> {
  const org = organizationalDomain(psl, domain);
  const names = org.domain === domain ? [domain] : [domain, org.domain];
  const queryIds: string[] = [];
  const findings: Finding[] = [];
  const result = (policy: DmarcRecordAt | null, error?: Walk['error']): Walk => ({
    policy,
    orgDomain: org.domain,
    orgDomainRule: `PSL rule ${org.rule}`,
    queryIds,
    findings,
    ...(error ? { error } : {}),
  });

  for (const name of names) {
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
    ctx.onQuery?.(answer.queryId);
    // DMARC-23
    switch (answer.rcode) {
      case 'SERVFAIL':
      case 'TIMEOUT':
      case 'BUDGET':
        return result(null, 'temperror');
      case 'OFFLINE':
        return result(null, 'offline');
      case 'BLOCKED':
        return result(null, 'sensitive-query-blocked');
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
    if (text !== undefined && tags) {
      return result({ name, text, tags, queryId: answer.queryId });
    }
  }
  return result(null);
}

import type { DnsLogEntry } from '@benchside/dns';
import type { Finding } from '../shared/findings.ts';

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

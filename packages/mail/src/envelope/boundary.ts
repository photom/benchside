import type { Finding } from '../shared/findings.ts';
import { isPublic, parseIp } from '../shared/ip.ts';
import type { ParsedReceived } from './received.ts';

/**
 * Picks the trust-boundary `Received` field (ENV-8..10).
 * `userChoice` is a header field index; one that is not a `Received` field is ignored.
 */
export function chooseBoundary(
  received: readonly ParsedReceived[],
  userChoice?: number,
): { boundary: ParsedReceived | null; findings: Finding[] } {
  const chosen = received.find((r) => r.field === userChoice);
  if (chosen) return { boundary: chosen, findings: [] };

  const publicHop = received.find((r) => {
    const ip = r.clientIp === undefined ? null : parseIp(r.clientIp);
    return ip !== null && isPublic(ip);
  });
  if (publicHop) return { boundary: publicHop, findings: [] };

  const top = received[0];
  if (!top) return { boundary: null, findings: [] };
  return {
    boundary: top,
    findings: [
      {
        id: 'envelope.no-public-hop',
        severity: 'warning',
        message:
          'No Received field has a public client IP. The topmost one is used as the trust boundary.',
        evidence: [{ kind: 'header', index: top.field }],
      },
    ],
  };
}

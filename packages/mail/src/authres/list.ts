import type { ParsedReceived } from '../envelope/received.ts';
import type { HeaderField } from '../message/headers.ts';
import type { Finding } from '../shared/findings.ts';
import { type AuthResultEntry, parseAuthResults } from './parse.ts';

export interface AuthResult {
  /** Header field index. */
  readonly field: number;
  readonly trusted: boolean;
  readonly authservId: string;
  readonly entries: readonly AuthResultEntry[];
}

/** Lists every `Authentication-Results` field in header order with its trust (AR-1, AR-4, AR-10). */
export function listReceiverResults(
  headers: readonly HeaderField[],
  received: readonly ParsedReceived[],
  boundary: ParsedReceived | null,
): { results: AuthResult[]; findings: Finding[] } {
  const results: AuthResult[] = [];
  const findings: Finding[] = [];
  for (const h of headers) {
    if (h.lname !== 'authentication-results') continue;
    const parsed = parseAuthResults(h.index, h.value);
    findings.push(...parsed.findings);
    const trusted = isTrusted(h.index, parsed.authservId, received, boundary);
    if (!trusted) {
      findings.push({
        id: 'authres.untrusted',
        severity: 'info',
        message: 'These results may have been written by the sender, so they are not compared.',
        evidence: [{ kind: 'header', index: h.index }],
      });
    }
    results.push({
      field: h.index,
      trusted,
      authservId: parsed.authservId,
      entries: parsed.entries,
    });
  }
  return { results, findings };
}

/**
 * AR-4: above the boundary, or between the boundary and the next `Received`
 * with the boundary's `by` host as authserv-id. RFC 8601 §5 makes the border
 * MTA delete incoming fields that claim its own authserv-id.
 */
function isTrusted(
  field: number,
  authservId: string,
  received: readonly ParsedReceived[],
  boundary: ParsedReceived | null,
): boolean {
  if (!boundary) return false;
  if (field < boundary.field) return true;
  const next = received.find((r) => r.field > boundary.field)?.field ?? Number.POSITIVE_INFINITY;
  return (
    field < next &&
    boundary.by !== undefined &&
    authservId !== '' &&
    authservId.toLowerCase() === boundary.by.toLowerCase()
  );
}

/** The report attachment name (INP-8..10; RFC 9990 §3.5.2, RFC 7489 §7.2.1.1). */

export interface ParsedFilename {
  readonly receiver: string;
  readonly policyDomain: string;
  readonly begin: number;
  readonly end: number;
  readonly uniqueId: string | null;
  /** Everything from the first `.` after the last `!`, without that dot. */
  readonly extension: string;
}

export type FilenamePart = 'policy-domain' | 'begin' | 'end';

const DIGITS = /^\d+$/;

/**
 * INP-8: `receiver "!" policy-domain "!" begin "!" end [ "!" unique-id ] "." extension`, read from
 * the last path segment (`/` or `\`). Null for any other name; that is not a finding.
 */
export function parseFilename(path: string): ParsedFilename | null {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const bang = name.lastIndexOf('!');
  const dot = name.indexOf('.', bang + 1);
  const stem = dot === -1 ? name : name.slice(0, dot);
  const parts = stem.split('!');
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [receiver, policyDomain, begin, end, uniqueId] = parts as [
    string,
    string,
    string,
    string,
    string | undefined,
  ];
  if (!receiver || !policyDomain || uniqueId === '') return null;
  if (!DIGITS.test(begin) || !DIGITS.test(end)) return null;
  // Longer digit strings would round, and equal values would compare unequal.
  if (!Number.isSafeInteger(Number(begin)) || !Number.isSafeInteger(Number(end))) return null;
  return {
    receiver,
    policyDomain,
    begin: Number(begin),
    end: Number(end),
    uniqueId: uniqueId ?? null,
    extension: dot === -1 ? '' : name.slice(dot + 1),
  };
}

/** A domain for comparison: case-insensitive, trailing dot ignored (INP-9). */
const domainKey = (d: string) => d.toLowerCase().replace(/\.$/, '');

/** INP-9: the parts of the name that differ from the content; a part the content lacks is not compared. */
export function compareFilename(
  f: ParsedFilename,
  content: {
    readonly policyDomain: string;
    readonly begin: number | null;
    readonly end: number | null;
  },
): FilenamePart[] {
  const parts: FilenamePart[] = [];
  if (domainKey(f.policyDomain) !== domainKey(content.policyDomain)) parts.push('policy-domain');
  if (content.begin !== null && f.begin !== content.begin) parts.push('begin');
  if (content.end !== null && f.end !== content.end) parts.push('end');
  return parts;
}

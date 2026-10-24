import type { HeaderField } from '../message/headers.ts';
import type { Finding } from '../shared/findings.ts';
import { parseIp } from '../shared/ip.ts';
import { isAtom, type Token, tokenize } from '../shared/rfc5322-tokens.ts';

export type ReceivedRule = 'ENV-1' | 'H1' | 'H2' | 'H3' | 'H4' | 'H5';

export interface ParsedReceived {
  /** Header field index. */
  readonly field: number;
  readonly confidence: 'grammar' | 'heuristic' | 'none';
  readonly rule?: ReceivedRule;
  readonly helo?: string;
  /** Dotted quad or RFC 5952 text (ENV-6, ENV-7). */
  readonly clientIp?: string;
  /** First atom after `by` (ENV-16). */
  readonly by?: string;
}

/** Parses every `Received` field, top to bottom (ENV-1..4). */
export function readReceived(headers: readonly HeaderField[]): {
  received: ParsedReceived[];
  findings: Finding[];
} {
  const received: ParsedReceived[] = [];
  const findings: Finding[] = [];
  for (const h of headers) {
    if (h.lname !== 'received') continue;
    const parsed = parseReceived(h.index, h.value);
    received.push(parsed);
    if (parsed.confidence === 'none') {
      findings.push({
        id: 'envelope.unparsed-received',
        severity: 'info',
        message: 'A Received field could not be parsed for a client IP.',
        evidence: [{ kind: 'header', index: h.index }],
      });
    }
  }
  return { received, findings };
}

const KEYWORDS = new Set(['from', 'by', 'via', 'with', 'id', 'for']);

/** RFC 5321 §4.1.2 Domain: sub-domain *("." sub-domain), sub-domain = Let-dig [Ldh-str]. */
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

export function parseReceived(field: number, value: string): ParsedReceived {
  const all = tokenize(value, ';');
  // ENV-3: the date-time follows the last ";".
  const lastSemi = all.findLastIndex((t) => t.kind === 'special');
  const clauses = lastSemi < 0 ? all : all.slice(0, lastSemi);
  const by = byHost(clauses);
  const base = by === undefined ? { field } : { field, by };

  const grammar = lastSemi < 0 ? null : parseGrammar(clauses);
  if (grammar) return { ...base, confidence: 'grammar', rule: 'ENV-1', ...grammar };
  const heuristic = parseHeuristics(clauses);
  if (heuristic) return { ...base, confidence: 'heuristic', ...heuristic };
  return { ...base, confidence: 'none' };
}

interface FromInfo {
  helo: string;
  clientIp: string;
}

/** RFC 5321 §4.4 Stamp, up to the ";". Comments outside TCP-info are CFWS. */
function parseGrammar(tokens: readonly Token[]): FromInfo | null {
  let i = 0;
  const skipComments = () => {
    while (tokens[i]?.kind === 'comment') i++;
  };

  skipComments();
  if (!isAtom(tokens[i], 'from')) return null;
  i++;
  const fromDomain = tokens[i];
  if (!isExtendedDomainHead(fromDomain)) return null;
  i++;
  const tcpInfo = tokens[i];
  const ip = tcpInfo?.kind === 'comment' ? parseTcpInfo(tcpInfo.text) : null;
  // Without TCP-info there is no client IP, so the grammar is no use (ENV-1).
  if (!ip) return null;
  i++;

  skipComments();
  if (!isAtom(tokens[i], 'by')) return null;
  i++;
  if (!isExtendedDomainHead(tokens[i])) return null;
  i++;

  // Opt-info: [Via] [With] [ID] [For] and Additional-Registered-Clauses, each "keyword value".
  for (;;) {
    skipComments();
    const keyword = tokens[i];
    if (!keyword) break;
    if (keyword.kind !== 'atom' || isAtom(keyword, 'from') || isAtom(keyword, 'by')) return null;
    i++;
    skipComments();
    const value = tokens[i];
    if (!value || value.kind === 'special') return null;
    i++;
  }
  return { helo: fromDomain.text, clientIp: ip };
}

function isExtendedDomainHead(t: Token | undefined): t is Token {
  if (t?.kind === 'atom') return DOMAIN.test(t.text);
  if (t?.kind === 'literal') return parseIp(t.text) !== null;
  return false;
}

/** TCP-info = address-literal / ( Domain FWS address-literal ). */
function parseTcpInfo(comment: string): string | null {
  const inner = tokenize(comment, '');
  const literal = inner.at(-1);
  if (literal?.kind !== 'literal') return null;
  if (inner.length === 2) {
    const host = inner[0];
    if (host?.kind !== 'atom' || !DOMAIN.test(host.text)) return null;
  } else if (inner.length !== 1) {
    return null;
  }
  return parseIp(literal.text)?.text ?? null;
}

type Heuristic = (fromHost: Token, comments: readonly Token[][]) => FromInfo | null;

/** ENV-2: tried in order, the first match wins. Examples in docs/reference/mail/envelope.md. */
const HEURISTICS: readonly (readonly [ReceivedRule, Heuristic])[] = [
  // H1: from HELO (RDNS [IP])
  ['H1', (host, comments) => rdnsAndLiteral(host, comments, (rdns) => !rdns.endsWith('.'))],
  // H2: from RDNS ([IP] helo=HELO)
  [
    'H2',
    (_host, comments) => {
      for (const c of comments) {
        const literal = c.find((t) => t.kind === 'literal');
        const helo = c.find((t) => t.kind === 'atom' && /^helo=/i.test(t.text));
        const ip = literal && parseIp(literal.text);
        if (ip && helo) return { helo: helo.text.slice(5), clientIp: ip.text };
      }
      return null;
    },
  ],
  // H3: from HOST (IP)
  [
    'H3',
    (host, comments) => {
      if (host.kind !== 'atom') return null;
      for (const c of comments) {
        const ip = c.length === 1 && c[0]?.kind === 'atom' ? parseIp(c[0].text) : null;
        if (ip) return { helo: host.text, clientIp: ip.text };
      }
      return null;
    },
  ],
  // H4: from HOST (HOST. [IP])
  ['H4', (host, comments) => rdnsAndLiteral(host, comments, (rdns) => rdns.endsWith('.'))],
  // H5: any literal in the from clause
  [
    'H5',
    (host, comments) => {
      for (const t of [host, ...comments.flat()]) {
        const ip = t.kind === 'literal' ? parseIp(t.text) : null;
        if (ip) return { helo: host.text, clientIp: ip.text };
      }
      return null;
    },
  ],
];

function rdnsAndLiteral(
  host: Token,
  comments: readonly Token[][],
  rdnsOk: (rdns: string) => boolean,
): FromInfo | null {
  if (host.kind !== 'atom') return null;
  for (const [rdns, literal, ...rest] of comments) {
    if (rest.length || rdns?.kind !== 'atom' || literal?.kind !== 'literal' || !rdnsOk(rdns.text))
      continue;
    const ip = parseIp(literal.text);
    if (ip) return { helo: host.text, clientIp: ip.text };
  }
  return null;
}

function parseHeuristics(tokens: readonly Token[]): (FromInfo & { rule: ReceivedRule }) | null {
  const start = tokens.findIndex((t) => isAtom(t, 'from'));
  const host = tokens[start + 1];
  if (start < 0 || !host || host.kind === 'comment' || host.kind === 'special') return null;

  const comments: Token[][] = [];
  for (const t of tokens.slice(start + 2)) {
    if (t.kind === 'atom' && KEYWORDS.has(t.text.toLowerCase())) break;
    if (t.kind === 'comment') comments.push(tokenize(t.text, ''));
  }
  for (const [rule, heuristic] of HEURISTICS) {
    const found = heuristic(host, comments);
    if (found) return { rule, ...found };
  }
  return null;
}

/** ENV-16: the `by` keyword is searched after `from` and its domain, so a HELO name "by" is skipped. */
function byHost(tokens: readonly Token[]): string | undefined {
  const from = tokens.findIndex((t) => isAtom(t, 'from'));
  const start = from < 0 ? 0 : from + 2;
  const i = tokens.findIndex((t, j) => j >= start && isAtom(t, 'by'));
  const next = i < 0 ? undefined : tokens.slice(i + 1).find((t) => t.kind !== 'comment');
  return next?.kind === 'atom' ? next.text : undefined;
}

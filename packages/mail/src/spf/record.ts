/** SPF record syntax (RFC 7208 §4.6, §12; SPF-8, SPF-9). */
import { type Ip, parseIp } from '../shared/ip.ts';
import { type MacroString, parseMacroString } from './macro.ts';

export type Qualifier = '+' | '-' | '~' | '?';
interface Base {
  /** The term as written, for the trace. */
  readonly text: string;
}
export type Term = Base &
  (
    | { readonly kind: 'all'; readonly q: Qualifier }
    | { readonly kind: 'include' | 'exists'; readonly q: Qualifier; readonly spec: MacroString }
    | {
        readonly kind: 'a' | 'mx';
        readonly q: Qualifier;
        readonly spec?: MacroString;
        readonly cidr4: number;
        readonly cidr6: number;
      }
    | { readonly kind: 'ptr'; readonly q: Qualifier; readonly spec?: MacroString }
    | {
        readonly kind: 'ip4' | 'ip6';
        readonly q: Qualifier;
        readonly net: Ip;
        readonly prefix: number;
      }
    | { readonly kind: 'redirect' | 'exp'; readonly spec: MacroString }
  );

/** Parses a whole record, `v=spf1` included. Any error rejects the record (SPF-8). */
export function parseRecord(text: string): { terms: Term[] } | { error: string } {
  const body = text.replace(/^v=spf1(?= |$)/i, '');
  if (body === text) return { error: 'The record does not start with v=spf1.' };
  const terms: Term[] = [];
  const seen = new Set<string>();
  for (const word of body.split(' ').filter((w) => w !== '')) {
    const term = parseTerm(word);
    if (typeof term === 'string') return { error: `${term} (${word})` };
    if (term === null) continue;
    if (term.kind === 'redirect' || term.kind === 'exp') {
      if (seen.has(term.kind)) return { error: `More than one ${term.kind} modifier.` };
      seen.add(term.kind);
    }
    terms.push(term);
  }
  return { terms };
}

/** Always matches, possibly empty: `/ip4-len`, `//ip6-len`, or both, at the end. */
const TRAILING_CIDR = /(?:\/(0|[1-9]\d{0,2}))?(?:\/\/(0|[1-9]\d{0,2}))?$/;
/** RFC 7208 §12 ip4-network: qnum is 0 to 255 without leading zeros. */
const IP4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** A term, null for an unknown modifier (ignored, SPF-9), or an error message. */
function parseTerm(text: string): Term | null | string {
  const modifier = /^([a-z][a-z0-9_.-]*)=(.*)$/i.exec(text);
  if (modifier) {
    const [, rawName = '', value = ''] = modifier;
    const name = rawName.toLowerCase();
    if (name === 'redirect' || name === 'exp') {
      const spec = domainSpec(value);
      return spec ? { text, kind: name, spec } : `Invalid ${name} target.`;
    }
    return parseMacroString(value, { exp: false }) ? null : 'Invalid modifier value.';
  }
  const m = /^([+\-~?]?)([a-z][a-z0-9]*)(.*)$/i.exec(text);
  if (!m) return 'Unknown term.';
  const [, qualifier = '', rawKind = '', rest = ''] = m;
  const q = (qualifier || '+') as Qualifier;
  const kind = rawKind.toLowerCase();
  switch (kind) {
    case 'all':
      return rest === '' ? { text, kind, q } : 'all takes no argument.';
    case 'include':
    case 'exists': {
      const spec = rest.startsWith(':') ? domainSpec(rest.slice(1)) : null;
      return spec ? { text, kind, q, spec } : `${kind} needs a valid domain.`;
    }
    case 'a':
    case 'mx': {
      // Only a trailing CIDR is split off: "/" is also a macro delimiter (%{l/}).
      const cidr = TRAILING_CIDR.exec(rest) as RegExpExecArray;
      const head = rest.slice(0, rest.length - cidr[0].length);
      if (head !== '' && !head.startsWith(':')) return `Invalid ${kind} term.`;
      const cidr4 = cidr[1] === undefined ? 32 : Number(cidr[1]);
      const cidr6 = cidr[2] === undefined ? 128 : Number(cidr[2]);
      if (cidr4 > 32 || cidr6 > 128) return 'CIDR length out of range.';
      if (head === '') return { text, kind, q, cidr4, cidr6 };
      const spec = domainSpec(head.slice(1));
      return spec ? { text, kind, q, spec, cidr4, cidr6 } : `${kind} needs a valid domain.`;
    }
    case 'ptr': {
      if (rest === '') return { text, kind, q };
      const spec = rest.startsWith(':') ? domainSpec(rest.slice(1)) : null;
      return spec ? { text, kind, q, spec } : 'ptr needs a valid domain.';
    }
    case 'ip4':
    case 'ip6': {
      const parts = /^:([^/]+)(?:\/(0|[1-9]\d{0,2}))?$/.exec(rest);
      const version = kind === 'ip4' ? 4 : 6;
      const net = parts?.[1] ? networkAddress(parts[1], version) : null;
      if (!parts || !net) return `Invalid ${kind} address.`;
      const prefix = parts[2] === undefined ? (version === 4 ? 32 : 128) : Number(parts[2]);
      if (prefix > (version === 4 ? 32 : 128)) return 'CIDR length out of range.';
      return { text, kind, q, net, prefix };
    }
    default:
      return 'Unknown mechanism.';
  }
}

/**
 * RFC 7208 §12 ip4-network / ip6-network, stricter than the envelope parser:
 * no address literal brackets, no `IPv6:` prefix, no leading zeros. An
 * IPv4-mapped IPv6 network stays IPv6, so it never matches an IPv4 client.
 */
function networkAddress(text: string, version: 4 | 6): Ip | null {
  if (version === 4) return IP4.test(text) ? parseIp(text) : null;
  if (!text.includes(':') || /[[\]]|^ipv6:/i.test(text)) return null;
  const ip = parseIp(text);
  if (!ip) return null;
  if (ip.version === 6) return ip;
  const bytes = new Uint8Array(16);
  bytes.set([0xff, 0xff], 10);
  bytes.set(ip.bytes, 12);
  return { version: 6, text: `::ffff:${ip.text}`, bytes };
}

/** A domain-spec: a macro-string; without macros it must already be a domain (SPF-24). */
function domainSpec(text: string): MacroString | null {
  const spec = parseMacroString(text, { exp: false });
  if (!spec || spec.length === 0) return null;
  if (spec.every((p) => typeof p === 'string') && !isSpfDomain(spec.join(''))) return null;
  return spec;
}

/**
 * RFC 7208 §4.3, §7.1: at least two labels of 1 to 63 octets, 253 octets in all,
 * and a top label of letters, digits, and "-" that is not all digits.
 */
export function isSpfDomain(name: string): boolean {
  const bare = name.endsWith('.') ? name.slice(0, -1) : name;
  if (bare.length === 0 || bare.length > 253) return false;
  const labels = bare.split('.');
  if (labels.length < 2 || labels.some((l) => l.length === 0 || l.length > 63)) return false;
  const top = labels.at(-1) ?? '';
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(top) && /[a-z-]/i.test(top);
}

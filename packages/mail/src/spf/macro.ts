/** SPF macros (RFC 7208 §7; SPF-12, SPF-26, SPF-27). */
import type { Ip } from '../shared/ip.ts';

export interface Macro {
  readonly letter: string;
  /** Uppercase letters are URL-escaped after expansion. */
  readonly upper: boolean;
  readonly digits?: number;
  readonly reverse: boolean;
  readonly delimiters: string;
}
export type MacroString = readonly (string | Macro)[];

export interface MacroEnv {
  readonly sender: string;
  readonly local: string;
  readonly senderDomain: string;
  /** The current domain of check_host. */
  readonly domain: string;
  readonly ip: Ip;
  readonly helo: string;
  readonly receiver: string;
  /** Reference time in seconds. */
  readonly time: number;
  readonly validatedName: () => Promise<string>;
}

const LETTERS = 'slodiphv';
const EXP_ONLY = 'crt';
/** DNS-9: letters that put more than domain names into a query. */
const SENSITIVE = 'slicp';

/**
 * RFC 7208 §7.1 macro-string, or null on a syntax error. In an explanation
 * (`exp`), spaces are literals and `c`, `r`, `t` are allowed.
 */
export function parseMacroString(text: string, o: { exp: boolean }): MacroString | null {
  const out: (string | Macro)[] = [];
  let literal = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    const code = ch.charCodeAt(0);
    if (ch !== '%') {
      // macro-literal = %x21-24 / %x26-7E; an explanation also allows SP.
      if ((code < 0x21 || code > 0x7e) && !(o.exp && code === 0x20)) return null;
      literal += ch;
      i++;
      continue;
    }
    const next = text[i + 1];
    if (next === '%' || next === '_' || next === '-') {
      literal += next === '%' ? '%' : next === '_' ? ' ' : '%20';
      i += 2;
      continue;
    }
    if (next !== '{') return null;
    const end = text.indexOf('}', i + 2);
    if (end < 0) return null;
    const m = /^([a-z])(\d*)(r?)([.\-+,/_=]*)$/i.exec(text.slice(i + 2, end));
    if (!m) return null;
    const [, raw = '', digits = '', reverse = '', delimiters = ''] = m;
    const letter = raw.toLowerCase();
    if (!LETTERS.includes(letter) && !(o.exp && EXP_ONLY.includes(letter))) return null;
    if (digits !== '' && Number(digits) === 0) return null;
    if (literal) out.push(literal);
    literal = '';
    out.push({
      letter,
      upper: raw !== letter,
      ...(digits !== '' ? { digits: Number(digits) } : {}),
      reverse: reverse !== '',
      delimiters: delimiters || '.',
    });
    i = end + 1;
  }
  if (literal) out.push(literal);
  return out;
}

export async function expandMacro(
  m: MacroString,
  env: MacroEnv,
): Promise<{ text: string; sensitive: boolean }> {
  let text = '';
  let sensitive = false;
  for (const part of m) {
    if (typeof part === 'string') {
      text += part;
      continue;
    }
    if (SENSITIVE.includes(part.letter)) sensitive = true;
    const value = await letterValue(part.letter, env);
    const split = new RegExp(`[${part.delimiters.replace(/[-\]\\]/g, '\\$&')}]`);
    let labels = value.split(split);
    if (part.reverse) labels.reverse();
    if (part.digits !== undefined && part.digits < labels.length) {
      labels = labels.slice(-part.digits);
    }
    const joined = labels.join('.');
    text += part.upper ? urlEscape(joined) : joined;
  }
  return { text, sensitive };
}

async function letterValue(letter: string, env: MacroEnv): Promise<string> {
  switch (letter) {
    case 's':
      return env.sender;
    case 'l':
      return env.local;
    case 'o':
      return env.senderDomain;
    case 'd':
      return env.domain;
    case 'i':
      return env.ip.version === 4 ? env.ip.text : nibbles(env.ip.bytes);
    case 'p':
      return env.validatedName();
    case 'v':
      return env.ip.version === 4 ? 'in-addr' : 'ip6';
    case 'h':
      return env.helo;
    case 'c':
      return env.ip.text;
    case 'r':
      return env.receiver;
    default:
      return String(env.time);
  }
}

/** RFC 7208 §7.3: an IPv6 `i` is 32 dot-separated hex nibbles. */
export function nibbles(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => `${(b >> 4).toString(16)}.${(b & 15).toString(16)}`).join('.');
}

/** RFC 3986 §2.3: everything but unreserved characters is percent-encoded. */
function urlEscape(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => {
    const c = String.fromCharCode(b);
    return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
}

/** The `From` address list (DMARC-21, RFC 5322 §3.4). */
import { isDomainName } from '../shared/domain.ts';
import { isSpecial, type Token, tokenize } from '../shared/rfc5322-tokens.ts';

/** The lowercase domain of each address, or null if any address is unusable or there is none. */
export function addressDomains(value: string): string[] | null {
  const tokens = tokenize(value, ',:;<>@').filter((t) => t.kind !== 'comment');
  const domains: string[] = [];
  let segment: Token[] = [];
  let angle: Token[] | null = null;
  let inAngle = false;
  // One address ends at "," or ";" outside angle brackets; ":" there starts a group.
  const finish = (): boolean => {
    const parts = angle ?? segment;
    segment = [];
    angle = null;
    if (parts.length === 0) return true;
    const domain = addrSpecDomain(parts);
    if (domain === null) return false;
    domains.push(domain);
    return true;
  };
  for (const t of tokens) {
    if (inAngle) {
      if (isSpecial(t, '>')) inAngle = false;
      else angle?.push(t);
    } else if (isSpecial(t, '<')) {
      inAngle = true;
      angle = [];
    } else if (isSpecial(t, ',') || isSpecial(t, ';')) {
      if (!finish()) return null;
    } else if (isSpecial(t, ':')) {
      // A group's display name is not an address.
      segment = [];
    } else if (angle === null) {
      segment.push(t);
    }
  }
  if (!finish()) return null;
  return domains.length > 0 ? domains : null;
}

/** `local-part "@" domain`, after an obsolete route (`@a,@b:`) is dropped. */
function addrSpecDomain(parts: readonly Token[]): string | null {
  const colon = parts.findLastIndex((t) => isSpecial(t, ':'));
  const spec = parts.slice(colon + 1);
  const at = spec.findLastIndex((t) => isSpecial(t, '@'));
  if (at < 1 || at !== spec.length - 2) return null;
  const domain = spec[at + 1];
  if (domain?.kind !== 'atom') return null; // a domain literal has no DMARC policy
  const name = domain.text.toLowerCase().replace(/\.$/, '');
  return isDomainName(name) ? name : null;
}

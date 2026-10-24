import type { Finding } from '../shared/findings.ts';
import { isAtom, isSpecial, type Token, tokenize } from '../shared/rfc5322-tokens.ts';

export interface AuthResultEntry {
  /** Lowercase, without a method version (`dkim/1` → `dkim`). */
  readonly method: string;
  /** Lowercase. */
  readonly result: string;
  readonly reason?: string;
  /** Keys are lowercase, usually `ptype.property` (`header.d`, `smtp.mailfrom`); values as written. */
  readonly props: Readonly<Record<string, string>>;
}

export interface ParsedAuthResults {
  readonly authservId: string;
  readonly entries: AuthResultEntry[];
  readonly findings: Finding[];
}

/** Parses an `Authentication-Results` value (AR-1, RFC 8601 §2.2). Methods are not filtered (AR-3). */
export function parseAuthResults(field: number, value: string): ParsedAuthResults {
  const syntax = (message: string): Finding => ({
    id: 'authres.syntax',
    severity: 'warning',
    message,
    evidence: [{ kind: 'header', index: field }],
  });

  const [head = [], ...resinfos] = splitOnSemicolons(
    tokenize(value, ';=').filter((t) => t.kind !== 'comment'),
  );
  const findings: Finding[] = [];
  let authservId = '';
  // Tokens before the first ";" that are not authserv-id or version.
  let stray: Token[] = [];
  if (isSpecial(head[1], '=')) {
    // AR-12: no authserv-id; the field starts with an entry (Microsoft 365).
    findings.push(syntax('The field has no authserv-id.'));
    stray = head;
  } else {
    const id = head[0];
    if (id?.kind !== 'atom' && id?.kind !== 'quoted') {
      return { authservId: '', entries: [], findings: [syntax('The field has no authserv-id.')] };
    }
    authservId = id.text;
    const afterVersion = head.slice(isAtom(head[1]) && /^\d+$/.test(head[1].text) ? 2 : 1);
    if (afterVersion.length > 0) {
      // AR-13
      findings.push(syntax('Unexpected text after the authserv-id. A ";" may be missing.'));
      stray = afterVersion;
    }
  }

  const entries: AuthResultEntry[] = [];
  const strayEntry = stray.length > 0 ? parseResinfo(stray) : null;
  if (strayEntry) entries.push(strayEntry);
  const nonEmpty = resinfos.filter((r) => r.length > 0);
  const [only] = nonEmpty;
  // no-result: [CFWS] ";" [CFWS] "none"
  if (
    stray.length === 0 &&
    nonEmpty.length === 1 &&
    only?.length === 1 &&
    isAtom(only[0], 'none')
  ) {
    return { authservId, entries, findings };
  }
  for (const resinfo of nonEmpty) {
    const entry = parseResinfo(resinfo);
    if (entry) entries.push(entry);
    else
      findings.push(
        syntax(
          `Skipped an entry that could not be parsed: ${resinfo.map((t) => t.text).join(' ')}`,
        ),
      );
  }
  return { authservId, entries, findings };
}

function splitOnSemicolons(tokens: readonly Token[]): Token[][] {
  const parts: Token[][] = [[]];
  for (const t of tokens) {
    if (isSpecial(t, ';')) parts.push([]);
    else parts.at(-1)?.push(t);
  }
  return parts;
}

/** resinfo = methodspec [reasonspec] [1*propspec], each "key = value". */
function parseResinfo(tokens: readonly Token[]): AuthResultEntry | null {
  const pairs: [string, string][] = [];
  let i = 0;
  while (i < tokens.length) {
    const key = tokens[i];
    const eq = tokens[i + 1];
    const val = tokens[i + 2];
    if (!isAtom(key) || !isSpecial(eq, '=')) return null;
    if (val?.kind !== 'atom' && val?.kind !== 'quoted' && val?.kind !== 'literal') return null;
    let text = val.text;
    i += 3;
    const next = tokens[i];
    if (val.kind === 'quoted' && isAtom(next) && next.text.startsWith('@')) {
      // AR-14: pvalue = local-part "@" domain-name, with a quoted local part.
      text = `"${val.text.replace(/[\\"]/g, '\\$&')}"${next.text}`;
      i++;
    }
    // Unquoted base64 values may end in "=" padding.
    while (val.kind === 'atom' && isSpecial(tokens[i], '=')) {
      text += '=';
      i++;
    }
    pairs.push([key.text, text]);
  }

  const [methodspec, ...rest] = pairs;
  if (!methodspec) return null;
  const method = (methodspec[0].split('/')[0] ?? '').toLowerCase();
  const result = methodspec[1].toLowerCase();
  let reason: string | undefined;
  const props: Record<string, string> = {};
  for (const [key, val] of rest) {
    const lkey = key.toLowerCase();
    // AR-14: properties without a ptype (Microsoft's action=none) are kept as written.
    if (lkey === 'reason' && reason === undefined) reason = val;
    else props[lkey] = val;
  }
  return reason === undefined ? { method, result, props } : { method, result, reason, props };
}

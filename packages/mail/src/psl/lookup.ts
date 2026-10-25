/** Public Suffix List (DMARC-7, DMARC-26; https://github.com/publicsuffix/list/wiki/Format). */
import { toALabels } from '../shared/domain.ts';

export interface PublicSuffixList {
  /** The `// VERSION:` header, or null without one. */
  readonly version: string | null;
  /** A-label rule (without `!`) → the rule as written in the list. */
  readonly normal: ReadonlyMap<string, string>;
  readonly exceptions: ReadonlyMap<string, string>;
}

export function parsePsl(text: string): PublicSuffixList {
  const normal = new Map<string, string>();
  const exceptions = new Map<string, string>();
  let version: string | null = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) {
      version ??= /^\/\/ VERSION: (\S+)$/.exec(trimmed)?.[1] ?? null;
      continue;
    }
    // Each line is read up to its first whitespace.
    const rule = trimmed.split(/\s/, 1)[0];
    if (!rule) continue;
    const exception = rule.startsWith('!');
    const body = exception ? rule.slice(1) : rule;
    // `*` labels stay as they are; toALabels converts only the non-ASCII labels.
    const key = toALabels(body.toLowerCase());
    if (key === null) continue;
    (exception ? exceptions : normal).set(key, rule);
  }
  return { version, normal, exceptions };
}

/** DMARC-7: the public suffix plus one label, or the domain itself when it is a public suffix. */
export function organizationalDomain(
  psl: PublicSuffixList,
  domain: string,
): { domain: string; rule: string } {
  const labels = domain.toLowerCase().replace(/\.$/, '').split('.');
  const suffix = publicSuffix(psl, labels);
  const keep = Math.min(labels.length, suffix.labels + 1);
  return { domain: labels.slice(-keep).join('.'), rule: suffix.rule };
}

/** DMARC-26: an exception wins; otherwise the matching rule with the most labels; else `*`. */
function publicSuffix(psl: PublicSuffixList, labels: readonly string[]) {
  for (let i = 0; i < labels.length; i++) {
    const rule = psl.exceptions.get(labels.slice(i).join('.'));
    if (rule !== undefined) return { labels: labels.length - i - 1, rule };
  }
  for (let i = 0; i < labels.length; i++) {
    const name = labels.slice(i).join('.');
    const rule = psl.normal.get(name) ?? psl.normal.get(['*', ...labels.slice(i + 1)].join('.'));
    if (rule !== undefined) return { labels: labels.length - i, rule };
  }
  return { labels: 1, rule: '*' };
}

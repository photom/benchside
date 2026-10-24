/** Parsed `tag=value` list (RFC 6376 §3.2), used by DKIM, DKIM keys, ARC, DMARC. */
export interface TagList {
  /** In order of appearance. For a duplicate, the first value is kept. */
  readonly tags: Map<string, string>;
  /** Names that appeared more than once: the whole list is invalid (§3.2). */
  readonly duplicates: string[];
  readonly errors: string[];
}

const TAG_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
/** Only FWS (SP, HTAB, CRLF) surrounds names and values; String.trim would also drop VT, FF, NBSP. */
const trimFws = (s: string) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
/** Replaces every non-ASCII character with `x`, so only ASCII rules apply. */
const asciiOnly = (s: string) => Array.from(s, (c) => (c.charCodeAt(0) < 0x80 ? c : 'x')).join('');
/** tval = VALCHAR (%x21-3A / %x3C-7E) runs separated by whitespace; folding is already removed. */
const TAG_VALUE = /^(?:[\x21-\x3a\x3c-\x7e]+(?:[ \t\r\n]+[\x21-\x3a\x3c-\x7e]+)*)?$/;

export function parseTagList(value: string): TagList {
  const tags = new Map<string, string>();
  const duplicates: string[] = [];
  const errors: string[] = [];
  const specs = value.split(';');
  // tag-list = tag-spec *( ";" tag-spec ) [ ";" ]: a trailing empty spec is allowed.
  if (specs.length > 1 && trimFws(specs.at(-1) ?? '') === '') specs.pop();
  for (const spec of specs) {
    const eq = spec.indexOf('=');
    if (eq < 0) {
      errors.push(`No "=" in "${trimFws(spec)}".`);
      continue;
    }
    const name = trimFws(spec.slice(0, eq));
    const tagValue = trimFws(spec.slice(eq + 1));
    if (!TAG_NAME.test(name)) {
      errors.push(`"${name}" is not a valid tag name.`);
      continue;
    }
    // Non-ASCII is tolerated (RFC 6376 §3.2 note); only ASCII control characters are errors.
    if (!TAG_VALUE.test(asciiOnly(tagValue))) {
      errors.push(`The value of "${name}" has characters that are not allowed.`);
      continue;
    }
    if (tags.has(name)) {
      if (!duplicates.includes(name)) duplicates.push(name);
      continue;
    }
    tags.set(name, tagValue);
  }
  return { tags, duplicates, errors };
}

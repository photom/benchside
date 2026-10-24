/**
 * A lenient tokenizer for structured header values (RFC 5322 §3.2).
 * Shared by `Received` (envelope) and `Authentication-Results` (authres).
 * Comments are kept as tokens because `Received` puts TCP-info in them.
 * Never throws: unclosed comments, quoted strings, and literals run to the end.
 */
export type Token =
  | { readonly kind: 'atom'; readonly text: string }
  /** Text between the outer parentheses; nested parentheses are kept. */
  | { readonly kind: 'comment'; readonly text: string }
  /** Unescaped content, without the quotes. */
  | { readonly kind: 'quoted'; readonly text: string }
  /** Including the brackets: `[192.0.2.1]`. */
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'special'; readonly text: string };

const isWsp = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n';

/** `specials` are single characters returned as `special` tokens, for example `";"` or `";="`. */
export function tokenize(value: string, specials: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < value.length) {
    const c = value[i] as string;
    if (isWsp(c)) {
      i++;
    } else if (c === '(') {
      // Iterative depth counting: nesting depth cannot exhaust the stack.
      let depth = 1;
      let j = i + 1;
      while (j < value.length && depth > 0) {
        const d = value[j];
        if (d === '\\') j++;
        else if (d === '(') depth++;
        else if (d === ')') depth--;
        j++;
      }
      tokens.push({ kind: 'comment', text: value.slice(i + 1, depth === 0 ? j - 1 : j) });
      i = j;
    } else if (c === '"') {
      let text = '';
      let j = i + 1;
      while (j < value.length && value[j] !== '"') {
        if (value[j] === '\\' && j + 1 < value.length) j++;
        text += value[j];
        j++;
      }
      tokens.push({ kind: 'quoted', text });
      i = j + 1;
    } else if (c === '[') {
      const close = value.indexOf(']', i);
      const end = close < 0 ? value.length : close + 1;
      tokens.push({ kind: 'literal', text: value.slice(i, end) });
      i = end;
    } else if (specials.includes(c)) {
      tokens.push({ kind: 'special', text: c });
      i++;
    } else {
      let j = i;
      while (j < value.length) {
        const d = value[j] as string;
        if (isWsp(d) || d === '(' || d === '"' || d === '[' || specials.includes(d)) break;
        j++;
      }
      tokens.push({ kind: 'atom', text: value.slice(i, j) });
      i = j;
    }
  }
  return tokens;
}

/** An atom, optionally equal to `text` (case-insensitive; pass `text` in lowercase). */
export function isAtom(t: Token | undefined, text?: string): t is Token & { kind: 'atom' } {
  return t?.kind === 'atom' && (text === undefined || t.text.toLowerCase() === text);
}

export function isSpecial(t: Token | undefined, char: string): boolean {
  return t?.kind === 'special' && t.text === char;
}

/**
 * Script elements in XFA text (scripts.md: SCR-4, SCR-5; ADR 0012). A tag scanner, not an
 * XML parser: it never builds a tree or checks that the XML is well formed.
 */
import { keep } from './text.ts';
import type { Text } from './types.ts';

export interface XfaScript {
  readonly language: string;
  readonly event?: string;
  readonly text: Text;
  readonly byteLength: number;
  /** Where the start tag is, in characters. */
  readonly offset: number;
}

export interface XfaScan {
  readonly scripts: XfaScript[];
  /** SCR-4: false when the work limit stopped the scan. */
  readonly complete: boolean;
}

/** SCR-4: characters examined per character of text. */
const WORK_PER_CHAR = 16;

const COMMENT = '<!--';
const CDATA = '<![CDATA[';
const NAME = /<(\/?)((?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*))/y;
const REFERENCE = /&(lt|gt|amp|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/g;
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const ATTRIBUTE = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

/** The end of a section that starts at `at` with `open`, or -1 when it never ends. */
function skip(xml: string, at: number, open: string, close: string): number {
  const end = xml.indexOf(close, at + open.length);
  return end < 0 ? -1 : end + close.length;
}

/** The index after the `>` that ends the tag at `at`, past quoted attribute values; or -1. */
function tagEnd(xml: string, at: number): number {
  let quote = '';
  for (let i = at; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i + 1;
    }
  }
  return -1;
}

/** SCR-4: attributes in order (name, `=`, a quoted value), up to the first that does not fit. */
function attributes(tag: string, from: number): Map<string, string> {
  const found = new Map<string, string>();
  ATTRIBUTE.lastIndex = from;
  for (let m = ATTRIBUTE.exec(tag); m; m = ATTRIBUTE.exec(tag)) {
    const [, name = '', double, single] = m;
    if (!found.has(name)) found.set(name, double ?? single ?? '');
  }
  return found;
}

/** UTF-8 length without encoding: 1 to 3 bytes per code unit, 4 per surrogate pair. */
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

function reference(whole: string, body: string): string {
  const named = NAMED[body];
  if (named) return named;
  const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
  const valid = code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
  return valid ? String.fromCodePoint(code) : whole;
}

/** SCR-5: CDATA unwrapped, references replaced outside it. */
function decode(content: string): string {
  let out = '';
  let i = 0;
  while (i < content.length) {
    const start = content.indexOf(CDATA, i);
    const plain = start < 0 ? content.slice(i) : content.slice(i, start);
    out += plain.replace(REFERENCE, reference);
    if (start < 0) break;
    const end = content.indexOf(']]>', start + CDATA.length);
    out += content.slice(start + CDATA.length, end < 0 ? content.length : end);
    i = end < 0 ? content.length : end + 3;
  }
  return out;
}

/**
 * The start of `</name>` after `from`, outside comments and CDATA; -1 when there is none.
 * Returns the index of `<` and the index after `>`.
 */
function endTag(xml: string, from: number, name: string): [number, number] | null {
  const close = `</${name}`;
  let i = from;
  for (;;) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) return null;
    if (xml.startsWith(COMMENT, lt) || xml.startsWith(CDATA, lt)) {
      const end = xml.startsWith(COMMENT, lt)
        ? skip(xml, lt, COMMENT, '-->')
        : skip(xml, lt, CDATA, ']]>');
      if (end < 0) return null;
      i = end;
      continue;
    }
    if (xml.startsWith(close, lt)) {
      let j = lt + close.length;
      while (j < xml.length && /\s/.test(xml[j] as string)) j++;
      if (xml[j] === '>') return [lt, j + 1];
    }
    i = lt + 1;
  }
}

/** SCR-4, SCR-5: up to `max` script elements, in document order. */
export function findXfaScripts(xml: string, max = Number.POSITIVE_INFINITY): XfaScan {
  const scripts: XfaScript[] = [];
  // Searches that run ahead (tag ends, end tags) count against this, so the scan stays linear.
  let work = WORK_PER_CHAR * xml.length;
  // Activities of the event start tags not yet closed; undefined for an event without one.
  const events: (string | undefined)[] = [];
  // A name with no end tag after some point has none after any later point either.
  const unclosed = new Set<string>();
  let i = 0;
  while (scripts.length < max) {
    if (work < 0) return { scripts, complete: false };
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    if (xml.startsWith(COMMENT, lt) || xml.startsWith(CDATA, lt)) {
      i = xml.startsWith(COMMENT, lt) ? skip(xml, lt, COMMENT, '-->') : skip(xml, lt, CDATA, ']]>');
      if (i < 0) break;
      continue;
    }
    NAME.lastIndex = lt;
    const m = NAME.exec(xml);
    const after = m ? xml[NAME.lastIndex] : undefined;
    // The name must end here: white space, `>`, or `/`. `<scripts>` is not `<script>`.
    if (!m || (after !== undefined && !/[\s/>]/.test(after))) {
      i = lt + 1;
      continue;
    }
    const [, slash, name = '', local] = m;
    const end = tagEnd(xml, NAME.lastIndex);
    work -= (end < 0 ? xml.length : end) - lt;
    if (end < 0) {
      // An unclosed quote: skip this tag and read on.
      i = lt + 1;
      continue;
    }
    i = end;
    const tag = xml.slice(lt, end);
    const attrs = attributes(tag, NAME.lastIndex - lt);
    const empty = tag.endsWith('/>');
    if (local === 'event') {
      if (slash) events.pop();
      else if (!empty) events.push(attrs.get('activity'));
      continue;
    }
    if (local !== 'script' || slash || empty || unclosed.has(name)) continue;
    const close = endTag(xml, end, name);
    work -= (close ? close[1] : xml.length) - end;
    if (!close) {
      unclosed.add(name);
      continue;
    }
    i = close[1];
    const content = xml.slice(end, close[0]);
    if (content === '') continue;
    const event = events.at(-1);
    scripts.push({
      language: attrs.get('contentType') ?? '',
      ...(event === undefined ? {} : { event }),
      text: keep(decode(content)),
      byteLength: utf8Length(content),
      offset: lt,
    });
  }
  return { scripts, complete: true };
}

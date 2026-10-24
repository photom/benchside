/**
 * Shared by DKIM signatures and ARC-Message-Signatures (design: mail-design/dkim.md).
 * Works on the CRLF-normalized bytes; header `raw` ranges point into them.
 */
import type { HeaderField } from '../message/headers.ts';
import { headerRelaxed, headerSimple } from './canonicalize.ts';

const CR = 0x0d;
const LF = 0x0a;
const SEMI = 0x3b;
const EQ = 0x3d;
const COLON = 0x3a;

/**
 * RFC 6376 §5.4.2: for each name in `h=`, the next unused field with that name,
 * from the bottom up. Names with no field left select nothing (oversigning).
 * The signature field itself is never selected.
 */
export function selectHeaders(
  headers: readonly HeaderField[],
  signedNames: readonly string[],
  signature: HeaderField,
): HeaderField[] {
  const used = new Set<number>([signature.index]);
  const selected: HeaderField[] = [];
  for (const name of signedNames) {
    const lname = name.toLowerCase();
    for (let i = headers.length - 1; i >= 0; i--) {
      const h = headers[i] as HeaderField;
      if (h.lname === lname && !used.has(h.index)) {
        used.add(h.index);
        selected.push(h);
        break;
      }
    }
  }
  return selected;
}

/**
 * The signature field with the value of tag `tag` (and the whitespace around it)
 * removed, and without the final CRLF (RFC 6376 §3.7, step 2). Other bytes stay exact.
 */
export function signatureFieldWithoutValue(raw: Uint8Array, tag: string): Uint8Array {
  let end = raw.length;
  if (end >= 2 && raw[end - 2] === CR && raw[end - 1] === LF) end -= 2;
  const colon = raw.indexOf(COLON);
  let specStart = colon + 1;
  while (specStart > 0 && specStart <= end) {
    let specEnd = raw.indexOf(SEMI, specStart);
    if (specEnd < 0 || specEnd > end) specEnd = end;
    const eq = raw.indexOf(EQ, specStart);
    if (eq >= 0 && eq < specEnd && isTagName(raw.subarray(specStart, eq), tag)) {
      const out = new Uint8Array(eq + 1 + (end - specEnd));
      out.set(raw.subarray(0, eq + 1));
      out.set(raw.subarray(specEnd, end), eq + 1);
      return out;
    }
    specStart = specEnd + 1;
  }
  return raw.slice(0, end);
}

const isFws = (b: number | undefined) => b === 0x20 || b === 0x09 || b === CR || b === LF;

/** Whether `bytes` is `tag` with optional FWS around it. Compares bytes, so any length is safe. */
function isTagName(bytes: Uint8Array, tag: string): boolean {
  let start = 0;
  let end = bytes.length;
  while (start < end && isFws(bytes[start])) start++;
  while (end > start && isFws(bytes[end - 1])) end--;
  if (end - start !== tag.length) return false;
  for (let i = 0; i < tag.length; i++) if (bytes[start + i] !== tag.charCodeAt(i)) return false;
  return true;
}

/**
 * Hash input for the header signature (RFC 6376 §3.7, step 2): the `selected`
 * fields (from `selectHeaders`) canonicalized, each ending in CRLF, then the
 * signature field without its `b=` value and without a final CRLF.
 */
export function headerHashData(
  bytes: Uint8Array,
  selected: readonly HeaderField[],
  signature: HeaderField,
  canon: 'simple' | 'relaxed',
): Uint8Array {
  const canonicalize = canon === 'simple' ? headerSimple : headerRelaxed;
  const raw = (h: HeaderField) => bytes.subarray(h.raw.start, h.raw.end);
  const parts = selected.map((h) => withCrlf(canonicalize(raw(h))));
  parts.push(canonicalize(signatureFieldWithoutValue(raw(signature), 'b')));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** "Each header field MUST be terminated with a single CRLF" (§3.7); the last field of header-only input has none. */
function withCrlf(field: Uint8Array): Uint8Array {
  if (field.length >= 2 && field[field.length - 2] === CR && field[field.length - 1] === LF)
    return field;
  const out = new Uint8Array(field.length + 2);
  out.set(field);
  out[field.length] = CR;
  out[field.length + 1] = LF;
  return out;
}

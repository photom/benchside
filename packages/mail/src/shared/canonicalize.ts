/** DKIM canonicalization over bytes (RFC 6376 §3.4). Input is CRLF-normalized (IN-7). */

const CR = 0x0d;
const LF = 0x0a;
const SP = 0x20;
const HTAB = 0x09;
const COLON = 0x3a;

const isWsp = (b: number | undefined) => b === SP || b === HTAB;

/** §3.4.1: unchanged. */
export function headerSimple(raw: Uint8Array): Uint8Array {
  return raw;
}

/**
 * §3.4.2 for one field (`raw` = name, colon, value, with folding and the final CRLF if any):
 * lowercase name, unfold, WSP runs to one SP, no WSP at the end of the value or around the colon.
 * A final CRLF is kept only if the input had one (the signature field has none).
 */
export function headerRelaxed(raw: Uint8Array): Uint8Array {
  const endsWithCrlf = raw.length >= 2 && raw[raw.length - 2] === CR && raw[raw.length - 1] === LF;
  const content = endsWithCrlf ? raw.subarray(0, raw.length - 2) : raw;
  // Relaxed output is never longer than the input.
  const out = new Uint8Array(raw.length);
  let o = 0;
  const colon = content.indexOf(COLON);
  let nameEnd = colon < 0 ? content.length : colon;
  while (nameEnd > 0 && isWsp(content[nameEnd - 1])) nameEnd--;
  for (let i = 0; i < nameEnd; i++) {
    const c = content[i] as number;
    out[o++] = c >= 0x41 && c <= 0x5a ? c + 0x20 : c;
  }
  if (colon >= 0) {
    out[o++] = COLON;
    let pendingSpace = false;
    let started = false;
    for (let i = colon + 1; i < content.length; i++) {
      const c = content[i] as number;
      if (c === CR && content[i + 1] === LF) {
        i++; // unfold: the CRLF is dropped, the WSP after it is handled below
        pendingSpace = started;
        continue;
      }
      if (isWsp(c)) {
        pendingSpace = started;
        continue;
      }
      if (pendingSpace) out[o++] = SP;
      pendingSpace = false;
      started = true;
      out[o++] = c;
    }
  }
  if (endsWithCrlf) {
    out[o++] = CR;
    out[o++] = LF;
  }
  return out.subarray(0, o);
}

/** §3.4.3: drop trailing empty lines; ensure one final CRLF (an empty body becomes CRLF). */
export function bodySimple(body: Uint8Array): Uint8Array {
  let end = body.length;
  while (end >= 2 && body[end - 2] === CR && body[end - 1] === LF) end -= 2;
  // `end` now stops after the last non-empty line's content; restore its CRLF.
  const out = new Uint8Array(end + 2);
  out.set(body.subarray(0, end));
  out[end] = CR;
  out[end + 1] = LF;
  return out;
}

/** §3.4.4: per line, WSP runs to one SP and no WSP at the end; then drop trailing empty lines. */
export function bodyRelaxed(body: Uint8Array): Uint8Array {
  // Relaxed output never grows, except for a CRLF added after an unterminated last line.
  const out = new Uint8Array(body.length + 2);
  let o = 0;
  /** End of the output after the last non-empty line. */
  let lastContentEnd = 0;
  let lineStart = 0;
  while (lineStart < body.length) {
    let lineEnd = body.indexOf(LF, lineStart);
    // A line ends at CRLF; an LF without CR before it is content.
    while (lineEnd >= 0 && (lineEnd === lineStart || body[lineEnd - 1] !== CR))
      lineEnd = body.indexOf(LF, lineEnd + 1);
    const contentEnd = lineEnd < 0 ? body.length : lineEnd - 1;
    let pendingSpace = false;
    let hasContent = false;
    for (let i = lineStart; i < contentEnd; i++) {
      const c = body[i] as number;
      if (isWsp(c)) {
        pendingSpace = true;
        continue;
      }
      if (pendingSpace) out[o++] = SP;
      pendingSpace = false;
      hasContent = true;
      out[o++] = c;
    }
    out[o++] = CR;
    out[o++] = LF;
    if (hasContent) lastContentEnd = o;
    lineStart = lineEnd < 0 ? body.length : lineEnd + 1;
  }
  return out.slice(0, lastContentEnd);
}

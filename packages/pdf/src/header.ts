/** The %PDF- header (structure.md: HDR-1..3). */
import type { Reader } from '@benchside/core';
import { indexOf } from './bytes.ts';
import type { FindingList } from './findings.ts';
import { isWhite } from './lexer.ts';
import type { Header, Region } from './types.ts';

/** README.md#limits */
const HEADER_SEARCH = 1024;
const VERSIONS = new Set(['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7']);

export async function readHeader(
  reader: Reader,
  findings: FindingList,
): Promise<{ header: Header | null; regions: Region[] }> {
  const bytes =
    (await reader.bytes(0, Math.min(HEADER_SEARCH, reader.byteLength))) ?? new Uint8Array();
  const at = indexOf(bytes, '%PDF-');
  if (at < 0) {
    findings.add('pdf.header.missing', `No "%PDF-" header in the first ${HEADER_SEARCH} bytes.`);
    return { header: null, regions: [] };
  }
  const regions: Region[] = [];
  if (at > 0) {
    findings.add('pdf.header.offset', `The header starts at offset ${at}, not 0.`, { offset: at });
    regions.push({ kind: 'prepended', offset: 0, byteLength: at });
  }
  let i = at + 5;
  while (i < bytes.length && i < at + 21 && !isWhite(bytes[i] as number) && bytes[i] !== 0x25) i++;
  const version = String.fromCharCode(...bytes.subarray(at + 5, i));
  if (!VERSIONS.has(version)) {
    findings.add('pdf.header.version', `The header says version "${version}", not 1.0 to 1.7.`, {
      offset: at,
    });
  }
  let end = lineEnd(bytes, i);
  // HDR-3: a comment line with at least four bytes of 0x80 or more.
  let binaryMarker = false;
  if (bytes[end] === 0x25) {
    const next = lineEnd(bytes, end);
    let high = 0;
    for (let k = end; k < next; k++) if ((bytes[k] as number) >= 0x80) high++;
    if (high >= 4) {
      binaryMarker = true;
      end = next;
    }
  }
  regions.push({ kind: 'header', offset: at, byteLength: end - at });
  return { header: { offset: at, version, binaryMarker }, regions };
}

/** The index just past the end-of-line that ends the line holding `i`. */
function lineEnd(bytes: Uint8Array, i: number): number {
  while (i < bytes.length && bytes[i] !== 0x0d && bytes[i] !== 0x0a) i++;
  if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) return i + 2;
  return i < bytes.length ? i + 1 : i;
}

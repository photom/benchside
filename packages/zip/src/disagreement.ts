/** Reader disagreement (disagreement.md: RD-1, RD-3..5). */
import type { FindingList } from './findings.ts';
import { CENTRAL_SIGNATURE, LOCAL_SIGNATURE } from './signatures.ts';
import { type ByteSource, view } from './source.ts';
import { decodeCp437, decodeUtf8 } from './text.ts';
import type { EndRecords, Entry, Region } from './types.ts';

const MAX_HIDDEN_NAME = 4096;

// A signature inside these records is their content (a stored nested archive), not an EOCD.
const LISTED: ReadonlySet<Region['kind']> = new Set([
  'local-header',
  'file-data',
  'data-descriptor',
  'central-header',
  'digital-signature',
  'zip64-eocd',
  'zip64-locator',
]);

/** RD-1 */
export function eocdCandidates(end: EndRecords, regions: readonly Region[], findings: FindingList) {
  const inListed = (offset: number) =>
    regions.some(
      (r) => LISTED.has(r.kind) && offset >= r.offset && offset < r.offset + r.byteLength,
    );
  const candidates = end.eocdCandidates.filter((offset) => !inListed(offset));
  if (candidates.length < 2) return;
  findings.add(
    'rd.eocd-candidates',
    `The EOCD signature appears at offsets ${candidates.join(', ')}. Readers that take the last signature and readers that check the comment length can choose differently; offset ${end.eocd.offset} is used here.`,
    { offset: end.eocd.offset },
  );
}

/** RD-3 */
export function nameEncodings(entries: readonly Entry[], findings: FindingList) {
  for (const entry of entries) {
    if (entry.name.source === 'utf-8-flag') continue;
    const bytes = entry.name.bytes;
    const readings = new Map<string, string>([['Code Page 437', decodeCp437(bytes)]]);
    const utf8 = decodeUtf8(bytes);
    if (utf8.valid) readings.set('UTF-8', utf8.text);
    const path = entry.central.extra.find((b) => b.unicodePath?.matches)?.unicodePath;
    if (path) readings.set('the Unicode Path extra field', path.name);
    if (new Set(readings.values()).size < 2) continue;
    const used =
      entry.name.source === 'unicode-path' ? 'the Unicode Path extra field' : 'Code Page 437';
    const list = [...readings].map(([how, text]) => `${how} ${JSON.stringify(text)}`).join(', ');
    findings.add(
      'rd.name-encoding',
      `Readers can show this name as ${list}. ${used} is used here.`,
      { offset: entry.central.offset, entry: entry.index },
    );
  }
}

const UNLISTED: ReadonlySet<Region['kind']> = new Set(['prepended', 'gap', 'trailing']);

/** RD-4, RD-5: headers in bytes no record accounts for, scanning at most `maxScanBytes`. */
export async function hiddenHeaders(
  source: ByteSource,
  regions: readonly Region[],
  findings: FindingList,
  maxScanBytes: number,
) {
  let budget = maxScanBytes;
  for (const region of regions) {
    if (!UNLISTED.has(region.kind)) continue;
    const length = Math.min(region.byteLength, budget);
    budget -= length;
    const bytes = await source.read(region.offset, length);
    scan(bytes, region.offset, findings);
    if (length < region.byteLength) {
      findings.add(
        'rd.scan-limit',
        `Only the first ${maxScanBytes} bytes outside the listed records were scanned for hidden headers.`,
        { offset: region.offset + length },
      );
      return;
    }
  }
}

function scan(bytes: Uint8Array, base: number, findings: FindingList) {
  const v = view(bytes);
  for (let i = 0; i + 4 <= bytes.length; i++) {
    // Cheap first test: "PK".
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b) continue;
    const signature = v.getUint32(i, true);
    const kind =
      signature === LOCAL_SIGNATURE ? 'local' : signature === CENTRAL_SIGNATURE ? 'central' : null;
    if (!kind) continue;
    const fixed = kind === 'local' ? 30 : 46;
    if (i + fixed > bytes.length) continue;
    const nameLength = v.getUint16(i + (kind === 'local' ? 26 : 28), true);
    if (nameLength < 1 || nameLength > MAX_HIDDEN_NAME || i + fixed + nameLength > bytes.length) {
      continue;
    }
    const name = decodeCp437(bytes.subarray(i + fixed, i + fixed + nameLength));
    findings.add(
      'rd.hidden-header',
      `A ${kind} file header for ${JSON.stringify(name)} sits outside the records the central directory lists. Readers that scan for headers see this entry; others do not.`,
      { offset: base + i },
    );
  }
}

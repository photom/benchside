/** Regions, gaps, and overlaps (structure.md: MAP-1..3). */
import type { Reader } from '@benchside/core';
import { firstNonBlank, isBlank } from './bytes.ts';
import type { FindingList } from './findings.ts';
import { isWhite } from './lexer.ts';
import type { Region } from './types.ts';

/** README.md#limits */
const GAP_INSPECT = 64 * 1024;

export async function byteMap(
  reader: Reader,
  regions: readonly Region[],
  findings: FindingList,
): Promise<Region[]> {
  // The same region can be found twice, e.g. the last startxref by the tail and by its section.
  const unique = new Map<string, Region>();
  for (const r of regions)
    if (r.byteLength > 0) unique.set(`${r.kind}:${r.offset}:${r.byteLength}`, r);
  const sorted = [...unique.values()].sort(
    (a, b) => a.offset - b.offset || b.byteLength - a.byteLength,
  );
  const out: Region[] = [];
  let covered = 0;
  for (const r of sorted) {
    if (r.offset > covered) await gap(reader, covered, r.offset, out, findings);
    else if (r.offset < covered) {
      // MAP-3
      findings.add(
        'pdf.overlap',
        `The ${r.kind} at offset ${r.offset} shares bytes with an earlier region.`,
        {
          offset: r.offset,
          ...(r.object === undefined ? {} : { object: r.object }),
        },
      );
    }
    out.push(r);
    covered = Math.max(covered, r.offset + r.byteLength);
  }
  if (covered < reader.byteLength) await gap(reader, covered, reader.byteLength, out, findings);
  return out.sort((a, b) => a.offset - b.offset);
}

/** MAP-2: only bytes that are not blank become a gap, trimmed to its first and last such byte. */
async function gap(
  reader: Reader,
  start: number,
  end: number,
  out: Region[],
  findings: FindingList,
) {
  const length = end - start;
  const bytes = (await reader.bytes(start, Math.min(length, GAP_INSPECT))) ?? new Uint8Array();
  const whole = length <= GAP_INSPECT;
  if (whole && isBlank(bytes)) return;
  // One pass, not one check per byte (REQ-PDF-003).
  const first = firstNonBlank(bytes);
  let last = bytes.length;
  if (whole) while (last > first && isWhite(bytes[last - 1] as number)) last--;
  const offset = start + first;
  const byteLength = (whole ? start + last : end) - offset;
  out.push({ kind: 'gap', offset, byteLength });
  findings.add(
    'pdf.gap',
    `${byteLength} bytes at offset ${offset} belong to no object or section.`,
    {
      offset,
    },
  );
}

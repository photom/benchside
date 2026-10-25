/** Byte map (structure.md: MAP-*). */
import type { FindingList } from './findings.ts';
import type { Region } from './types.ts';

export function byteMap(regions: readonly Region[], size: number, findings: FindingList): Region[] {
  // MAP-1: stable sort keeps record order for regions at one offset.
  const sorted = regions.filter((r) => r.byteLength > 0).toSorted((a, b) => a.offset - b.offset);
  const out: Region[] = [];
  let furthest: Region | null = null;
  let covered = 0;
  for (const region of sorted) {
    // MAP-2
    if (region.offset > covered) {
      const kind = covered === 0 ? 'prepended' : 'gap';
      out.push({ kind, offset: covered, byteLength: region.offset - covered });
      if (kind === 'gap') gap(findings, covered, region.offset - covered);
    }
    // MAP-3
    if (furthest && region.offset < furthest.offset + furthest.byteLength) {
      findings.add(
        'zip.overlap',
        `${describe(region)} overlaps ${describe(furthest)}.`,
        region.entry === undefined
          ? { offset: region.offset }
          : { offset: region.offset, entry: region.entry },
      );
    }
    out.push(region);
    const end = region.offset + region.byteLength;
    if (!furthest || end > furthest.offset + furthest.byteLength) furthest = region;
    covered = Math.max(covered, end);
  }
  if (covered < size && sorted.length > 0) {
    out.push({ kind: 'gap', offset: covered, byteLength: size - covered });
    gap(findings, covered, size - covered);
  }
  return out;
}

function gap(findings: FindingList, offset: number, byteLength: number) {
  findings.add('zip.gap', `${byteLength} bytes at offset ${offset} belong to no record.`, {
    offset,
  });
}

function describe(r: Region): string {
  const entry = r.entry === undefined ? '' : ` of entry ${r.entry}`;
  return `The ${r.kind}${entry} at offset ${r.offset}`;
}

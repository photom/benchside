/** Analyzes one archive (structure.md, fields.md). */
import { byteMap } from './byte-map.ts';
import { readCentral } from './central.ts';
import { readEnd } from './end-records.ts';
import { FindingList } from './findings.ts';
import { readLocal } from './local.ts';
import { type ByteSource, Reader } from './source.ts';
import type { Entry, Finding, Region, ZipReport } from './types.ts';

export interface AnalyzeOptions {
  /** REP-1: entry indexes from the top-level archive. */
  readonly path?: readonly number[];
  /** Findings found before analysis (NEST-4). */
  readonly findings?: readonly Finding[];
  readonly limits?: Partial<Limits>;
}

export interface Limits {
  readonly maxEntries: number;
  readonly maxFindings: number;
}

/** README.md#limits */
export const LIMITS: Limits = { maxEntries: 100_000, maxFindings: 1000 };

const LOCAL_WINDOW = 64 * 1024;

// NEST-1
const ARCHIVE_NAME =
  /\.(zip|jar|war|ear|aar|apk|xpi|epub|docx|xlsx|pptx|odt|ods|odp|whl|nupkg|vsix)$/i;

export async function analyzeZip(
  source: ByteSource,
  options: AnalyzeOptions = {},
): Promise<ZipReport> {
  const limits = { ...LIMITS, ...options.limits };
  const findings = new FindingList(limits.maxFindings);
  findings.list.push(...(options.findings ?? []));
  const reader = new Reader(source);
  // Local headers sit far apart; a small window keeps each one a small read.
  const localReader = new Reader(source, LOCAL_WINDOW);
  const size = source.byteLength;
  const base = { byteLength: size, path: options.path ?? [] };

  const end = await readEnd(reader, findings);
  if (!end) {
    // EOCD-3
    const regions: Region[] = size > 0 ? [{ kind: 'unknown', offset: 0, byteLength: size }] : [];
    return { ...base, end: null, entries: [], regions, findings: findings.list };
  }

  const central = await readCentral(reader, end, findings, limits.maxEntries);
  const regions: Region[] = [...end.regions, ...central.regions];
  const entries: Entry[] = [];
  for (const [index, c] of central.entries.entries()) {
    const localHeaderOffset = c.localHeaderOffset + central.shift;
    const local = await readLocal(localReader, c, index, localHeaderOffset, findings);
    regions.push(...local.regions);
    const kind = c.name.text.endsWith('/') ? 'directory' : 'file';
    entries.push({
      index,
      kind,
      name: c.name,
      comment: c.comment,
      central: c.central,
      local: local.local,
      compressedSize: c.compressedSize,
      uncompressedSize: c.uncompressedSize,
      crc32: c.central.crc32,
      localHeaderOffset,
      zip64: c.hasZip64Extra || local.hasZip64Extra,
      data: local.data,
      descriptor: local.descriptor,
      mismatches: local.mismatches,
      archiveHint: kind === 'file' && ARCHIVE_NAME.test(c.name.text),
    });
  }

  return {
    ...base,
    end: {
      eocd: end.eocd,
      zip64: end.zip64,
      shift: central.shift,
      entryCount: end.entryCount,
      cdOffset: end.cdOffset,
      cdByteLength: end.cdByteLength,
      comment: end.comment,
    },
    entries,
    regions: byteMap(regions, size, findings),
    findings: findings.list,
  };
}

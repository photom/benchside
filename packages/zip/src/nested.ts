/** Opening an entry as an archive (nested.md). */
import { analyzeZip } from './analyze.ts';
import { crc32 } from './crc32.ts';
import { FindingList } from './findings.ts';
import { inflateRaw } from './inflate.ts';
import { type ByteSource, bytesSource } from './source.ts';
import type { Entry, RefusalReason, ZipReport } from './types.ts';

export interface NestedLimits {
  readonly maxDepth: number;
  readonly maxBytes: number;
}

/** README.md#limits */
export const NESTED_LIMITS: NestedLimits = { maxDepth: 8, maxBytes: 256 * 1024 * 1024 };

export type Opened =
  | { readonly kind: 'report'; readonly report: ZipReport; readonly source: ByteSource }
  | { readonly kind: 'refused'; readonly reason: RefusalReason };

const ENCRYPTED = 0x0001; // 4.4.4 bit 0

export async function openNested(
  source: ByteSource,
  report: ZipReport,
  index: number,
  limits: Partial<NestedLimits> = {},
): Promise<Opened> {
  const { maxDepth, maxBytes } = { ...NESTED_LIMITS, ...limits };
  const entry = report.entries[index];
  if (!entry) return refused('unreadable');
  const reason = refusal(entry, report.path.length + 1, maxDepth, maxBytes);
  if (reason) return refused(reason);
  const data = entry.data as NonNullable<Entry['data']>;

  // NEST-3
  const stored = await source.read(data.offset, data.byteLength);
  let content = stored;
  if (entry.central.method.code === 8) {
    const inflated = await inflateRaw(stored, entry.uncompressedSize);
    if (inflated.kind === 'exceeded') return refused('size-exceeded');
    if (inflated.kind === 'error') return refused('inflate-failed');
    content = inflated.bytes;
  }

  // NEST-4: no entry index; it would point into the nested archive.
  const findings = new FindingList();
  if (content.length !== entry.uncompressedSize) {
    findings.add(
      'nested.size-mismatch',
      `The content is ${content.length} bytes; the outer archive's central directory says ${entry.uncompressedSize}.`,
    );
  }
  if (crc32(content) !== entry.crc32) {
    findings.add(
      'nested.crc-mismatch',
      "The CRC-32 of the content differs from the outer archive's central directory.",
    );
  }

  // NEST-5
  const nested = bytesSource(content);
  const nestedReport = await analyzeZip(nested, {
    path: [...report.path, index],
    findings: findings.list,
  });
  return { kind: 'report', report: nestedReport, source: nested };
}

/** NEST-2: the first reason that applies. */
function refusal(
  entry: Entry,
  depth: number,
  maxDepth: number,
  maxBytes: number,
): RefusalReason | null {
  const methodCode = entry.central.method.code;
  if (entry.kind === 'directory') return 'directory';
  if (depth > maxDepth) return 'too-deep';
  if (entry.central.flags.raw & ENCRYPTED) return 'encrypted';
  if (methodCode !== 0 && methodCode !== 8) return 'unsupported-method';
  if (!entry.local || !entry.data || entry.data.byteLength < entry.compressedSize) {
    return 'unreadable';
  }
  if (entry.uncompressedSize > maxBytes || entry.compressedSize > maxBytes) {
    return 'too-large';
  }
  return null;
}

function refused(reason: RefusalReason): Opened {
  return { kind: 'refused', reason };
}

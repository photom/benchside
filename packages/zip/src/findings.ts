/** Findings and their fixed severity and APPNOTE section (report.md). */
import type { Category, Finding, FindingId, Severity } from './types.ts';

export const FINDINGS: Record<
  FindingId,
  { severity: Severity; category: Category; section?: string }
> = {
  'zip.eocd.missing': { severity: 'error', category: 'structure', section: '4.3.1' },
  'zip.eocd.trailing-data': { severity: 'warning', category: 'structure', section: '4.3.16' },
  'zip.multi-disk': { severity: 'warning', category: 'structure', section: '4.3.3' },
  'zip.value-too-large': { severity: 'error', category: 'structure' },
  'zip64.record-missing': { severity: 'error', category: 'structure', section: '4.3.15' },
  'zip64.record-size': { severity: 'warning', category: 'structure', section: '4.3.14.1' },
  'zip64.mismatch': { severity: 'warning', category: 'disagreement', section: '4.4.19–4.4.24' },
  'zip64.missing': { severity: 'warning', category: 'structure', section: '4.4.1.4' },
  'zip64.extra-missing': { severity: 'error', category: 'structure', section: '4.5.3' },
  'zip64.extra-short': { severity: 'error', category: 'structure', section: '4.5.3' },
  'zip.offsets-shifted': { severity: 'info', category: 'disagreement', section: '4.4.24' },
  'zip.cd.out-of-range': { severity: 'error', category: 'structure', section: '4.4.23' },
  'zip.cd.bad-signature': { severity: 'error', category: 'structure', section: '4.3.12' },
  'zip.cd.truncated': { severity: 'error', category: 'structure', section: '4.3.12' },
  'zip.cd.size-mismatch': { severity: 'warning', category: 'disagreement', section: '4.4.23' },
  'zip.cd.count-mismatch': { severity: 'warning', category: 'disagreement', section: '4.4.22' },
  'zip.too-many-entries': { severity: 'warning', category: 'structure' },
  'zip.local.out-of-range': { severity: 'error', category: 'structure', section: '4.4.16' },
  'zip.local.bad-signature': { severity: 'error', category: 'structure', section: '4.3.7' },
  'zip.local.mismatch': { severity: 'warning', category: 'disagreement', section: '4.3.2' },
  'zip.data.truncated': { severity: 'error', category: 'structure', section: '4.4.8' },
  'zip.descriptor.truncated': { severity: 'error', category: 'structure', section: '4.3.9.1' },
  'zip.descriptor.mismatch': { severity: 'warning', category: 'disagreement', section: '4.3.9' },
  'zip.gap': { severity: 'info', category: 'structure', section: '4.3.6' },
  'zip.overlap': { severity: 'error', category: 'structure', section: '4.3.6' },
  'zip.name.invalid-utf8': { severity: 'warning', category: 'structure', section: 'D.2' },
  'zip.unicode-path.stale': { severity: 'info', category: 'disagreement', section: '4.6.9' },
  'zip.extra.malformed': { severity: 'warning', category: 'structure', section: '4.5.1' },
  'zip.too-many-findings': { severity: 'info', category: 'structure' },
  'nested.size-mismatch': { severity: 'warning', category: 'structure', section: '4.4.9' },
  'nested.crc-mismatch': { severity: 'warning', category: 'structure', section: '4.4.7' },
  'sec.path-traversal': { severity: 'error', category: 'security', section: '4.4.17.1' },
  'sec.absolute-path': { severity: 'error', category: 'security', section: '4.4.17.1' },
  'sec.backslash': { severity: 'warning', category: 'security', section: '4.4.17.1' },
  'sec.duplicate-name': { severity: 'warning', category: 'security' },
  'sec.name-collision': { severity: 'warning', category: 'security' },
  'sec.reserved-name': { severity: 'warning', category: 'security' },
  'sec.symlink': { severity: 'warning', category: 'security', section: '4.4.15' },
  'sec.control-character': { severity: 'warning', category: 'security' },
  'sec.bidi-character': { severity: 'warning', category: 'security' },
  'sec.long-path': { severity: 'warning', category: 'security' },
  'sec.compression-ratio': { severity: 'warning', category: 'security' },
  'sec.archive-ratio': { severity: 'warning', category: 'security' },
  'sec.total-size': { severity: 'warning', category: 'security' },
  'sec.file-count': { severity: 'warning', category: 'security' },
  'sec.overlapping-entries': { severity: 'error', category: 'security', section: '4.3.6' },
  'rd.eocd-candidates': { severity: 'warning', category: 'disagreement', section: '4.3.1' },
  'rd.name-encoding': { severity: 'info', category: 'disagreement', section: 'D.2' },
  'rd.hidden-header': { severity: 'warning', category: 'disagreement', section: '4.3.2' },
  'rd.scan-limit': { severity: 'info', category: 'disagreement' },
};

/** Collects findings in the order found, up to a limit (REP-8). */
export class FindingList {
  readonly list: Finding[] = [];
  readonly limit: number;

  constructor(limit = 1000) {
    this.limit = limit;
  }

  add(id: FindingId, message: string, at: { offset?: number; entry?: number } = {}) {
    if (this.list.length > this.limit) return;
    if (this.list.length === this.limit) {
      this.list.push(
        make(
          'zip.too-many-findings',
          `More than ${this.limit} findings; the rest are not shown.`,
          {},
        ),
      );
      return;
    }
    this.list.push(make(id, message, at));
  }
}

function make(id: FindingId, message: string, at: { offset?: number; entry?: number }): Finding {
  const { severity, category, section } = FINDINGS[id];
  return {
    id,
    severity,
    category,
    message,
    ...(section === undefined ? {} : { section }),
    ...(at.offset === undefined ? {} : { offset: at.offset }),
    ...(at.entry === undefined ? {} : { entry: at.entry }),
  };
}

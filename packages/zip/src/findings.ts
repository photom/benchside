/** Findings and their fixed severity and APPNOTE section (report.md). */
import type { Finding, FindingId, Severity } from './types.ts';

export const FINDINGS: Record<FindingId, { severity: Severity; section?: string }> = {
  'zip.eocd.missing': { severity: 'error', section: '4.3.1' },
  'zip.eocd.trailing-data': { severity: 'warning', section: '4.3.16' },
  'zip.multi-disk': { severity: 'warning', section: '4.3.3' },
  'zip.value-too-large': { severity: 'error' },
  'zip64.record-missing': { severity: 'error', section: '4.3.15' },
  'zip64.record-size': { severity: 'warning', section: '4.3.14.1' },
  'zip64.mismatch': { severity: 'warning', section: '4.4.19–4.4.24' },
  'zip64.missing': { severity: 'warning', section: '4.4.1.4' },
  'zip64.extra-missing': { severity: 'error', section: '4.5.3' },
  'zip64.extra-short': { severity: 'error', section: '4.5.3' },
  'zip.offsets-shifted': { severity: 'info', section: '4.4.24' },
  'zip.cd.out-of-range': { severity: 'error', section: '4.4.23' },
  'zip.cd.bad-signature': { severity: 'error', section: '4.3.12' },
  'zip.cd.truncated': { severity: 'error', section: '4.3.12' },
  'zip.cd.size-mismatch': { severity: 'warning', section: '4.4.23' },
  'zip.cd.count-mismatch': { severity: 'warning', section: '4.4.22' },
  'zip.too-many-entries': { severity: 'warning' },
  'zip.local.out-of-range': { severity: 'error', section: '4.4.16' },
  'zip.local.bad-signature': { severity: 'error', section: '4.3.7' },
  'zip.local.mismatch': { severity: 'warning', section: '4.3.2' },
  'zip.data.truncated': { severity: 'error', section: '4.4.8' },
  'zip.descriptor.truncated': { severity: 'error', section: '4.3.9.1' },
  'zip.descriptor.mismatch': { severity: 'warning', section: '4.3.9' },
  'zip.gap': { severity: 'info', section: '4.3.6' },
  'zip.overlap': { severity: 'error', section: '4.3.6' },
  'zip.name.invalid-utf8': { severity: 'warning', section: 'D.2' },
  'zip.unicode-path.stale': { severity: 'info', section: '4.6.9' },
  'zip.extra.malformed': { severity: 'warning', section: '4.5.1' },
  'zip.too-many-findings': { severity: 'info' },
  'nested.size-mismatch': { severity: 'warning', section: '4.4.9' },
  'nested.crc-mismatch': { severity: 'warning', section: '4.4.7' },
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
  const { severity, section } = FINDINGS[id];
  return {
    id,
    severity,
    message,
    ...(section === undefined ? {} : { section }),
    ...(at.offset === undefined ? {} : { offset: at.offset }),
    ...(at.entry === undefined ? {} : { entry: at.entry }),
  };
}

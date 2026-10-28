/** Findings and their fixed severity and ISO 32000-1 clause (report.md). */
import type { Finding, FindingId, Severity } from './types.ts';

export const FINDINGS: Record<FindingId, { severity: Severity; clause?: string }> = {
  'pdf.header.missing': { severity: 'error', clause: '7.5.2' },
  'pdf.header.offset': { severity: 'warning', clause: '7.5.2' },
  'pdf.header.version': { severity: 'info', clause: '7.5.2' },
  'pdf.startxref.missing': { severity: 'error', clause: '7.5.5' },
  'pdf.eof.missing': { severity: 'warning', clause: '7.5.5' },
  'pdf.eof.trailing': { severity: 'warning', clause: '7.5.5' },
  'pdf.xref.out-of-range': { severity: 'error', clause: '7.5.5' },
  'pdf.xref.not-found': { severity: 'error', clause: '7.5.4' },
  'pdf.xref.entry-format': { severity: 'warning', clause: '7.5.4' },
  'pdf.xref.duplicate-entry': { severity: 'warning', clause: '7.5.4' },
  'pdf.xref.first-entry': { severity: 'info', clause: '7.5.4' },
  'pdf.trailer.missing': { severity: 'error', clause: '7.5.5' },
  'pdf.trailer.root': { severity: 'error', clause: '7.5.5' },
  'pdf.trailer.size': { severity: 'warning', clause: '7.5.5' },
  'pdf.xref-stream.dict': { severity: 'error', clause: '7.5.8.2' },
  'pdf.xref-stream.filter': { severity: 'error', clause: '7.4.4.3' },
  'pdf.xref-stream.decode': { severity: 'error', clause: '7.4.4.4' },
  'pdf.xref-stream.short': { severity: 'warning', clause: '7.5.8.3' },
  'pdf.xref.loop': { severity: 'error', clause: '7.5.6' },
  'pdf.xref.too-many-sections': { severity: 'warning' },
  'pdf.object.out-of-range': { severity: 'error', clause: '7.5.4' },
  'pdf.object.header-mismatch': { severity: 'error', clause: '7.3.10' },
  'pdf.object.endobj-missing': { severity: 'warning', clause: '7.3.10' },
  'pdf.object.too-large': { severity: 'warning' },
  'pdf.stream.eol': { severity: 'warning', clause: '7.3.8.1' },
  'pdf.stream.length': { severity: 'warning', clause: '7.3.8.2' },
  'pdf.syntax.error': { severity: 'warning', clause: '7.2' },
  'pdf.syntax.depth': { severity: 'error' },
  'pdf.dict.key': { severity: 'warning', clause: '7.3.7' },
  'pdf.dict.duplicate-key': { severity: 'warning', clause: '7.3.7' },
  'pdf.value-too-large': { severity: 'error' },
  'pdf.encrypted': { severity: 'info', clause: '7.6.1' },
  'pdf.gap': { severity: 'info', clause: '7.5.3' },
  'pdf.overlap': { severity: 'error', clause: '7.5.4' },
  'pdf.too-many-objects': { severity: 'warning' },
  'pdf.too-many-findings': { severity: 'info' },
  'pdf.filter.error': { severity: 'warning', clause: '7.4' },
  'pdf.filter.unsupported': { severity: 'info', clause: '7.4.1' },
  'pdf.filter.limit': { severity: 'warning' },
  'pdf.objstm.invalid': { severity: 'error', clause: '7.5.7' },
  'pdf.objstm.missing': { severity: 'error', clause: '7.5.7' },
  'pdf.catalog.missing': { severity: 'error', clause: '7.7.2' },
  'pdf.catalog.type': { severity: 'warning', clause: '7.7.2' },
  'pdf.info.invalid': { severity: 'warning', clause: '14.3.3' },
  'pdf.pages.missing': { severity: 'error', clause: '7.7.2' },
  'pdf.pages.kid': { severity: 'warning', clause: '7.7.3.2' },
  'pdf.pages.loop': { severity: 'error', clause: '7.7.3.1' },
  'pdf.pages.count': { severity: 'warning', clause: '7.7.3.2' },
  'pdf.page.mediabox': { severity: 'warning', clause: '7.7.3.3' },
  'pdf.tree.loop': { severity: 'warning' },
  'pdf.tree.limit': { severity: 'warning' },
  'pdf.action.unknown': { severity: 'info', clause: '12.6.4.1' },
  'pdf.action.loop': { severity: 'warning', clause: '12.6.2' },
  'pdf.action.javascript': { severity: 'warning', clause: '12.6.4.16' },
  'pdf.action.launch': { severity: 'warning', clause: '12.6.4.5' },
  'pdf.action.submit-form': { severity: 'warning', clause: '12.7.5.2' },
  'pdf.action.import-data': { severity: 'warning', clause: '12.7.5.4' },
  'pdf.action.remote': { severity: 'info', clause: '12.6.4.3' },
  'pdf.action.automatic': { severity: 'warning', clause: '12.6.3' },
  'pdf.too-many-actions': { severity: 'warning' },
  'pdf.script.3d': { severity: 'warning', clause: '13.6.3' },
  'pdf.xfa': { severity: 'info', clause: '12.7.8' },
  'pdf.script.xfa': { severity: 'warning', clause: '12.7.8' },
  'pdf.script.postscript': { severity: 'info', clause: '8.8.2' },
  'pdf.xfa.incomplete': { severity: 'warning' },
  'pdf.script.unreached': { severity: 'warning' },
  'pdf.script.unchecked': { severity: 'warning' },
  'pdf.script.removed': { severity: 'warning', clause: '7.5.6' },
  'pdf.too-many-scripts': { severity: 'warning' },
};

/** Collects findings in the order found, up to a limit (REP-7). */
export class FindingList {
  readonly list: Finding[] = [];
  readonly limit: number;

  constructor(limit = 1000) {
    this.limit = limit;
  }

  add(id: FindingId, message: string, at: { offset?: number; object?: number } = {}) {
    if (this.list.length > this.limit) return;
    if (this.list.length === this.limit) {
      this.list.push(
        make(
          'pdf.too-many-findings',
          `More than ${this.limit} findings; the rest are not shown.`,
          {},
        ),
      );
      return;
    }
    this.list.push(make(id, message, at));
  }
}

function make(id: FindingId, message: string, at: { offset?: number; object?: number }): Finding {
  const { severity, clause } = FINDINGS[id];
  return {
    id,
    severity,
    message,
    ...(clause === undefined ? {} : { clause }),
    ...(at.offset === undefined ? {} : { offset: at.offset }),
    ...(at.object === undefined ? {} : { object: at.object }),
  };
}

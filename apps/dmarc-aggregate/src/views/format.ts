/** Text for numbers and labels (ui.md, Text in the UI). */
import type { ReportSummary } from '@benchside/dmarc-aggregate';

/** Thousands separated by the browser locale (ui.md, Marks). */
export const count = (n: number) => n.toLocaleString();

export const mib = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;

export const percent = (rate: number | null) =>
  rate === null ? '—' : `${Math.round(rate * 1000) / 10}%`;

export const day = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** The format badge of ui.md. */
export function formatBadge(r: Pick<ReportSummary, 'format' | 'namespace'>): string {
  if (r.format === 'rfc9990') return 'RFC 9990 (DMARCbis)';
  if (r.format === 'rfc7489') return r.namespace === null ? 'RFC 7489, no namespace' : 'RFC 7489';
  return 'Unknown namespace';
}

/** A policy value as published, or "not stated" (CMB-8, ENF-1). */
export const stated = (v: string | number | null) => (v === null ? 'not stated' : String(v));

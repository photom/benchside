/** Source rows and detail rows of the filtered set (SRC-1..5; design: view.md). */
import { parseIp } from '@benchside/dns';
import type { CountedReport } from './batch.ts';
import type { Cause, Classification, Path } from './classify.ts';
import type { DkimAuth, ReadRecord, SpfAuth } from './format/read.ts';

/** One record of the filtered set with what it needs from its report. */
export interface Item {
  readonly record: ReadRecord;
  readonly cls: Classification;
  readonly report: CountedReport;
  /** The first spelling of its reporter (CMB-5). */
  readonly reporter: string;
}

/** SRC-5 */
export type Focus = { readonly path: Path } | { readonly cause: Cause };

export interface ResultCount {
  readonly domain: string;
  /** DKIM only; null for SPF. */
  readonly selector: string | null;
  readonly result: string;
  readonly messages: number;
}

export interface DispositionCount {
  readonly disposition: string | null;
  readonly messages: number;
}

export interface DetailRow {
  readonly headerFrom: string | null;
  readonly envelopeFrom: string | null;
  /** The SPF result FMT-9 chose. */
  readonly spf: SpfAuth | null;
  readonly dkim: readonly DkimAuth[];
  readonly alignedSpf: 'pass' | 'fail';
  readonly alignedDkim: 'pass' | 'fail';
  readonly disposition: string | null;
  readonly reasons: readonly string[];
  readonly classification: Classification;
  readonly messages: number;
  readonly reporters: readonly string[];
}

export interface SourceRow {
  readonly sourceIp: string;
  readonly validIp: boolean;
  readonly messages: number;
  readonly failing: number;
  readonly byPath: Record<Path, number>;
  readonly mainCause: Cause | null;
  readonly spf: readonly ResultCount[];
  readonly dkim: readonly ResultCount[];
  readonly alignedSpf: number;
  readonly alignedDkim: number;
  readonly byDisposition: readonly DispositionCount[];
  readonly authorDomains: readonly string[];
  readonly reporters: readonly string[];
  readonly details: readonly DetailRow[];
}

export const CAUSE_ORDER: readonly Cause[] = [
  'reported-forwarding',
  'dkim-broken',
  'spf-broken-by-forwarding',
  'spf-not-aligned',
  'dkim-not-aligned',
  'temporary-error',
  'permanent-error',
  'no-dkim',
  'unauthenticated',
];

/** The cause with the most messages; ties go to the cause listed first (SRC-2, ENF-4). */
export function mainCause(byCause: ReadonlyMap<Cause, number>): Cause | null {
  let best: Cause | null = null;
  for (const c of CAUSE_ORDER) {
    const n = byCause.get(c) ?? 0;
    if (n > 0 && (best === null || n > (byCause.get(best) as number))) best = c;
  }
  return best;
}

/** Adds `n` to the count under `key`, keeping the order first seen. */
export function bump<K>(m: Map<K, number>, key: K, n: number): void {
  m.set(key, (m.get(key) ?? 0) + n);
}

export function inFocus(cls: Classification, focus: Focus | null): boolean {
  if (!focus) return true;
  return 'path' in focus ? cls.path === focus.path : cls.cause === focus.cause;
}

interface RowAcc {
  readonly validIp: boolean;
  messages: number;
  failing: number;
  readonly byPath: Record<Path, number>;
  readonly byCause: Map<Cause, number>;
  readonly spf: Map<string, ResultCount & { messages: number }>;
  readonly dkim: Map<string, ResultCount & { messages: number }>;
  alignedSpf: number;
  alignedDkim: number;
  readonly byDisposition: Map<string | null, number>;
  readonly authors: Set<string>;
  readonly reporters: Set<string>;
  readonly details: Map<string, DetailRow & { messages: number; reporters: string[] }>;
}

const byMessages = <T extends { messages: number }>(list: T[]) =>
  list.sort((a, b) => b.messages - a.messages);

/** SRC-1..5 */
export function sourceRows(items: Iterable<Item>, focus: Focus | null): SourceRow[] {
  const rows = new Map<string, RowAcc>();
  for (const { record: r, cls, reporter } of items) {
    if (!inFocus(cls, focus)) continue;
    let row = rows.get(r.sourceIp);
    if (!row) {
      row = {
        validIp: r.validIp,
        messages: 0,
        failing: 0,
        byPath: { direct: 0, forwarded: 0, other: 0 },
        byCause: new Map(),
        spf: new Map(),
        dkim: new Map(),
        alignedSpf: 0,
        alignedDkim: 0,
        byDisposition: new Map(),
        authors: new Set(),
        reporters: new Set(),
        details: new Map(),
      };
      rows.set(r.sourceIp, row);
    }
    const n = r.count;
    row.messages += n;
    if (cls.dmarc === 'fail') row.failing += n;
    row.byPath[cls.path] += n;
    if (cls.cause) bump(row.byCause, cls.cause, n);
    for (const s of r.spfResults) count(row.spf, s.domain, null, s.result, n);
    for (const d of r.dkimResults) count(row.dkim, d.domain, d.selector, d.result, n);
    if (r.spf === 'pass') row.alignedSpf += n;
    if (r.dkim === 'pass') row.alignedDkim += n;
    bump(row.byDisposition, r.disposition, n);
    if (r.headerFrom) row.authors.add(r.headerFrom);
    row.reporters.add(reporter);
    detail(row, r, cls, reporter);
  }
  return [...rows]
    .map(
      ([sourceIp, a]): SourceRow => ({
        sourceIp,
        validIp: a.validIp,
        messages: a.messages,
        failing: a.failing,
        byPath: a.byPath,
        mainCause: mainCause(a.byCause),
        spf: byMessages([...a.spf.values()]),
        dkim: byMessages([...a.dkim.values()]),
        alignedSpf: a.alignedSpf,
        alignedDkim: a.alignedDkim,
        byDisposition: [...a.byDisposition].map(([disposition, messages]) => ({
          disposition,
          messages,
        })),
        authorDomains: [...a.authors],
        reporters: [...a.reporters],
        details: byMessages([...a.details.values()]),
      }),
    )
    .sort(
      (a, b) =>
        b.failing - a.failing || b.messages - a.messages || compareIp(a.sourceIp, b.sourceIp),
    );
}

function count(
  m: Map<string, ResultCount & { messages: number }>,
  domain: string,
  selector: string | null,
  result: string,
  n: number,
): void {
  const key = JSON.stringify([domain, selector, result]);
  const c = m.get(key);
  if (c) c.messages += n;
  else m.set(key, { domain, selector, result, messages: n });
}

/** SRC-4: one detail row per distinct combination. */
function detail(row: RowAcc, r: ReadRecord, cls: Classification, reporter: string): void {
  const spf = r.spfResults.find((s) => s.used) ?? null;
  const dkim = [...r.dkimResults].sort((a, b) =>
    `${a.domain} ${a.selector} ${a.result}`.localeCompare(`${b.domain} ${b.selector} ${b.result}`),
  );
  const reasons = [...new Set(r.reasons.map((x) => x.type))].sort();
  const key = JSON.stringify([
    r.headerFrom,
    r.envelopeFrom,
    spf && [spf.domain, spf.result],
    dkim.map((d) => [d.domain, d.selector, d.result]),
    r.spf === 'pass',
    r.dkim === 'pass',
    r.disposition,
    reasons,
    cls.path,
    cls.cause,
  ]);
  const d = row.details.get(key);
  if (d) {
    d.messages += r.count;
    if (!d.reporters.includes(reporter)) d.reporters.push(reporter);
    return;
  }
  row.details.set(key, {
    headerFrom: r.headerFrom,
    envelopeFrom: r.envelopeFrom,
    spf,
    dkim,
    alignedSpf: r.spf === 'pass' ? 'pass' : 'fail',
    alignedDkim: r.dkim === 'pass' ? 'pass' : 'fail',
    disposition: r.disposition,
    reasons,
    classification: cls,
    messages: r.count,
    reporters: [reporter],
  });
}

/** SRC-3: IPv4, then IPv6, each in numeric order, then invalid text. */
function compareIp(a: string, b: string): number {
  const x = parseIp(a);
  const y = parseIp(b);
  if (!x || !y) return x ? -1 : y ? 1 : a < b ? -1 : a > b ? 1 : 0;
  if (x.version !== y.version) return x.version - y.version;
  for (let i = 0; i < x.bytes.length; i++) {
    const d = (x.bytes[i] as number) - (y.bytes[i] as number);
    if (d !== 0) return d;
  }
  return 0;
}

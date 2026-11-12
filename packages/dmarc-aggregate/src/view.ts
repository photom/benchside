/** The filtered set and what is computed from it (CMB-6, CMB-9..13; design: view.md). */
import type { Batch, CountedReport } from './batch.ts';
import type { Cause, Classification, Path } from './classify.ts';
import { type DomainEnforcement, domainEnforcement } from './enforcement.ts';
import type { Format } from './format/read.ts';
import { CAUSE_ORDER, type Focus, type Item, type SourceRow, sourceRows } from './sources.ts';

export interface Filters {
  /** One policy domain, or null for all. */
  readonly domain: string | null;
  /** Reporter names, compared case-insensitively (CMB-5); null for all. */
  readonly reporters: readonly string[] | null;
  /** YYYY-MM-DD, inclusive; null for all. */
  readonly days: { readonly from: string; readonly to: string } | null;
}

export type PathCounts = Record<Path, number>;

export interface Totals {
  readonly messages: number;
  readonly passing: number;
  readonly failing: number;
  /** Null when there are no messages. */
  readonly passRate: number | null;
  /** In the order first seen; only dispositions with messages. */
  readonly byDisposition: readonly {
    readonly disposition: string | null;
    readonly messages: number;
  }[];
  readonly byPath: PathCounts;
  /** Failing messages, in CAUSE rule order; only causes with messages. */
  readonly byCause: readonly { readonly cause: Cause; readonly messages: number }[];
  readonly reports: number;
  readonly reporters: number;
  readonly sourceIps: number;
  readonly authorDomains: number;
  /** Earliest `begin` to latest `end` of the dated reports; null when none is dated. */
  readonly period: { readonly begin: number; readonly end: number } | null;
}

export interface Day {
  readonly date: string;
  /** Null on a day without reports. */
  readonly messages: PathCounts | null;
  readonly passRate: number | null;
}

export interface ReporterRow {
  /** The first spelling (CMB-5). */
  readonly reporter: string;
  readonly reports: number;
  readonly messages: number;
  readonly passing: number;
  readonly passRate: number | null;
  /** Distinct days covered, and the first and last. */
  readonly days: number;
  readonly firstDay: string | null;
  readonly lastDay: string | null;
  /** Declared formats, in the order first seen. */
  readonly formats: readonly Format[];
}

export interface FormatCount {
  readonly format: Format;
  readonly namespace: string | null;
  readonly reports: number;
  /** Reports with `aggregate.format.mixed`. */
  readonly mixed: number;
}

export interface ReporterError {
  readonly report: number;
  readonly reporter: string;
  readonly policyDomain: string;
  readonly day: string | null;
  readonly text: string;
}

export interface View {
  readonly totals: Totals;
  readonly timeline: readonly Day[];
  readonly undatedMessages: number;
  readonly earlierMessages: number;
  readonly reporters: readonly ReporterRow[];
  readonly formats: readonly FormatCount[];
  readonly reporterErrors: readonly ReporterError[];
  /** SRC-1..5, under the focus. */
  readonly sources: readonly SourceRow[];
  /** ENF-1..7, one per policy domain in the filtered set, in the order first seen. */
  readonly domains: readonly DomainEnforcement[];
}

const MAX_DAYS = 1000;

const rate = (passing: number, messages: number) => (messages > 0 ? passing / messages : null);
const paths = (): PathCounts => ({ direct: 0, forwarded: 0, other: 0 });

/** CMB-6: whether a counted report is in the filtered set. */
function passes(c: CountedReport, f: Filters, reporters: Set<string> | null): boolean {
  const s = c.summary;
  if (f.domain !== null && s.policyDomain !== f.domain) return false;
  if (reporters && !reporters.has(s.reporter.toLowerCase())) return false;
  if (f.days !== null && (s.day === null || s.day < f.days.from || s.day > f.days.to)) return false;
  return true;
}

interface DayAcc {
  messages: PathCounts;
  passing: number;
}

interface ReporterAcc {
  reports: number;
  messages: number;
  passing: number;
  days: Set<string>;
  formats: Format[];
}

/** CMB-6, CMB-9..13, SRC-1..5, and ENF-1..7 for one set of filters and focus (REP-6). */
export function view(batch: Batch, filters: Filters, focus: Focus | null = null): View {
  const wanted = filters.reporters ? new Set(filters.reporters.map((r) => r.toLowerCase())) : null;
  let messages = 0;
  let passing = 0;
  const byPath = paths();
  const byDisposition = new Map<string | null, number>();
  const byCause = new Map<Cause, number>();
  const reporterKeys = new Set<string>();
  const ips = new Set<string>();
  const authors = new Set<string>();
  let begin: number | null = null;
  let end: number | null = null;
  let reports = 0;
  const days = new Map<string, DayAcc>();
  let undatedMessages = 0;
  const reporters = new Map<string, ReporterAcc>();
  const formats = new Map<string, FormatCount & { reports: number; mixed: number }>();
  const reporterErrors: ReporterError[] = [];
  const items: Item[] = [];
  const byDomain = new Map<string, Item[]>();

  for (const c of batch.countedReports()) {
    if (!passes(c, filters, wanted)) continue;
    const s = c.summary;
    reports++;
    let domainItems = byDomain.get(s.policyDomain);
    if (!domainItems) {
      domainItems = [];
      byDomain.set(s.policyDomain, domainItems);
    }
    const reporterName = batch.reporterName(s.reporter);
    const key = s.reporter.toLowerCase();
    reporterKeys.add(key);
    if (s.day !== null && s.begin !== null && s.end !== null) {
      if (begin === null || s.begin < begin) begin = s.begin;
      if (end === null || s.end > end) end = s.end;
    }
    let day: DayAcc | null = null;
    if (s.day !== null) {
      day = days.get(s.day) ?? { messages: paths(), passing: 0 };
      days.set(s.day, day);
    }
    let rep = reporters.get(key);
    if (!rep) {
      rep = { reports: 0, messages: 0, passing: 0, days: new Set(), formats: [] };
      reporters.set(key, rep);
    }
    rep.reports++;
    if (s.day !== null) rep.days.add(s.day);
    if (!rep.formats.includes(s.format)) rep.formats.push(s.format);
    const fKey = `${s.format}\n${s.namespace ?? ''}\n${s.namespace === null}`;
    const fc = formats.get(fKey) ?? {
      format: s.format,
      namespace: s.namespace,
      reports: 0,
      mixed: 0,
    };
    fc.reports++;
    if (c.report.findings.some((f) => f.id === 'aggregate.format.mixed')) fc.mixed++;
    formats.set(fKey, fc);
    for (const text of c.report.errors) {
      reporterErrors.push({
        report: s.index,
        reporter: reporterName,
        policyDomain: s.policyDomain,
        day: s.day,
        text,
      });
    }

    c.report.records.forEach((r, i) => {
      // Every record of a counted report is classified when the report is counted (FCT-7).
      const cl = c.classes[i] as Classification;
      const item: Item = { record: r, cls: cl, report: c, reporter: reporterName };
      items.push(item);
      domainItems.push(item);
      const n = r.count;
      const pass = cl.dmarc === 'pass' ? n : 0;
      messages += n;
      passing += pass;
      byPath[cl.path] += n;
      ips.add(r.sourceIp);
      if (r.headerFrom) authors.add(r.headerFrom);
      if (n > 0) {
        byDisposition.set(r.disposition, (byDisposition.get(r.disposition) ?? 0) + n);
        if (cl.cause) byCause.set(cl.cause, (byCause.get(cl.cause) ?? 0) + n);
      }
      rep.messages += n;
      rep.passing += pass;
      if (day) {
        day.messages[cl.path] += n;
        day.passing += pass;
      } else {
        undatedMessages += n;
      }
    });
  }

  const { timeline, earlierMessages } = makeTimeline(days);
  const policies = batch.policies();
  return {
    totals: {
      messages,
      passing,
      failing: messages - passing,
      passRate: rate(passing, messages),
      byDisposition: [...byDisposition].map(([disposition, m]) => ({ disposition, messages: m })),
      byPath,
      byCause: CAUSE_ORDER.filter((c) => byCause.has(c)).map((cause) => ({
        cause,
        messages: byCause.get(cause) as number,
      })),
      reports,
      reporters: reporterKeys.size,
      sourceIps: ips.size,
      authorDomains: authors.size,
      period: begin === null || end === null ? null : { begin, end },
    },
    timeline,
    undatedMessages,
    earlierMessages,
    reporters: [...reporters]
      .map(([key, a]): ReporterRow => {
        const sorted = [...a.days].sort();
        return {
          reporter: batch.reporterName(key),
          reports: a.reports,
          messages: a.messages,
          passing: a.passing,
          passRate: rate(a.passing, a.messages),
          days: sorted.length,
          firstDay: sorted[0] ?? null,
          lastDay: sorted[sorted.length - 1] ?? null,
          formats: a.formats,
        };
      })
      .sort((x, y) => y.messages - x.messages),
    formats: [...formats.values()],
    reporterErrors,
    sources: sourceRows(items, focus),
    domains: [...byDomain].map(([domain, list]) =>
      domainEnforcement(
        domain,
        list,
        policies.find((p) => p.domain === domain && p.inEffect),
      ),
    ),
  };
}

/** CMB-10: every day from the first to the last, cut to the latest 1 000. */
function makeTimeline(days: Map<string, DayAcc>): { timeline: Day[]; earlierMessages: number } {
  if (days.size === 0) return { timeline: [], earlierMessages: 0 };
  const keys = [...days.keys()].sort();
  const last = Date.parse(`${keys[keys.length - 1]}T00:00:00Z`);
  let first = Date.parse(`${keys[0]}T00:00:00Z`);
  const earliestShown = last - (MAX_DAYS - 1) * 86_400_000;
  let earlierMessages = 0;
  if (first < earliestShown) {
    const cut = new Date(earliestShown).toISOString().slice(0, 10);
    for (const k of keys) {
      if (k >= cut) break;
      const m = (days.get(k) as DayAcc).messages;
      earlierMessages += m.direct + m.forwarded + m.other;
    }
    first = earliestShown;
  }
  const timeline: Day[] = [];
  for (let t = first; t <= last; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const d = days.get(date);
    if (!d) {
      timeline.push({ date, messages: null, passRate: null });
      continue;
    }
    const total = d.messages.direct + d.messages.forwarded + d.messages.other;
    timeline.push({ date, messages: d.messages, passRate: rate(d.passing, total) });
  }
  return { timeline, earlierMessages };
}

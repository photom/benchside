/**
 * The reports of a batch: identity, duplicates, conflicts, overlaps, file names, days, policies,
 * reporter errors, classification (CMB-1..5, CMB-7, CMB-8, CMB-13, INP-9, INP-10, FCT-6, FCT-7).
 */
import { type Classification, classify, inconsistent, recordFacts } from './classify.ts';
import { compareFilename, type ParsedFilename, parseFilename } from './filename.ts';
import type { Finding, Findings } from './findings.ts';
import {
  type ContentHint,
  type ExtensionCount,
  type Format,
  type Policy,
  type ReadRecord,
  type ReadReport,
  readReport,
} from './format/read.ts';
import type { XmlDocument } from './xml/reader.ts';

export interface ReportSummary {
  readonly index: number;
  /** The top-level file it came from (REP-1). */
  readonly file: number;
  readonly label: string;
  readonly format: Format;
  readonly namespace: string | null;
  readonly prefix: string | null;
  readonly version: string | null;
  readonly reporter: string;
  readonly reportId: string | null;
  readonly policyDomain: string;
  readonly begin: number | null;
  readonly end: number | null;
  /** CMB-7: the UTC day of the midpoint as YYYY-MM-DD, or null when undated (REP-4). */
  readonly day: string | null;
  readonly status: 'counted' | 'duplicate' | 'conflict';
  readonly hints: readonly ContentHint[];
  readonly extensions: readonly ExtensionCount[];
  readonly filename: ParsedFilename | null;
  readonly records: number;
  readonly messages: number;
}

/** A document event of `readInput`. */
export interface DocumentInput {
  readonly label: string;
  readonly filename: string | null;
  readonly document: XmlDocument;
}

/** A counted report with the classification of each record. */
export interface CountedReport {
  readonly summary: ReportSummary;
  readonly report: ReadReport;
  /** One per record, in order. */
  readonly classes: readonly Classification[];
}

interface Counted extends CountedReport {
  readonly classes: Classification[];
}

/** A DMARC-failing record, revisited when its source IP turns out to be a forwarder (FCT-7). */
interface Failing {
  readonly counted: Counted;
  readonly record: number;
}

/** CMB-8: one `policy_published` configuration of a policy domain. */
export interface PolicyConfig {
  readonly domain: string;
  readonly p: string | null;
  readonly sp: string | null;
  readonly np: string | null;
  readonly adkim: string | null;
  readonly aspf: string | null;
  readonly pct: number | null;
  readonly fo: string | null;
  readonly testing: string | null;
  readonly discoveryMethod: string | null;
  /** First spellings (CMB-5), in the order seen. */
  readonly reporters: readonly string[];
  readonly reports: number;
  readonly firstDay: string | null;
  readonly lastDay: string | null;
  readonly inEffect: boolean;
}

interface PolicyEntry {
  readonly policy: Policy;
  readonly reporters: Map<string, string>;
  reports: number;
  firstDay: string | null;
  lastDay: string | null;
}

const DAY = 86_400;
const POLICY_KEYS = [
  'p',
  'sp',
  'np',
  'adkim',
  'aspf',
  'pct',
  'fo',
  'testing',
  'discoveryMethod',
] as const;

type DayIssue = 'invalid' | 'future' | 'long-range' | null;

/** CMB-7: the day and what was wrong with the period, in the order the checks run. */
function reportDay(
  begin: number | null,
  end: number | null,
  now: number,
): { day: string | null; issue: DayIssue } {
  if (begin === null || end === null) return { day: null, issue: null };
  if (end < begin) return { day: null, issue: 'invalid' };
  if (end > now + 2 * DAY) return { day: null, issue: 'future' };
  const day = new Date(Math.floor((begin + end) / 2) * 1000).toISOString().slice(0, 10);
  return { day, issue: end - begin > 2 * DAY ? 'long-range' : null };
}

const DAY_FINDINGS = {
  invalid: {
    id: 'aggregate.value.invalid',
    severity: 'warning',
    path: 'report_metadata/date_range',
    message: 'The period ends before it begins; the report is undated.',
  },
  future: {
    id: 'aggregate.report.future',
    severity: 'warning',
    path: 'report_metadata/date_range/end',
    message: 'The period ends more than 2 days after now; the report is undated.',
  },
  'long-range': {
    id: 'aggregate.report.long-range',
    severity: 'info',
    path: 'report_metadata/date_range',
    message: 'The period is longer than 48 hours; its midpoint gives the day.',
  },
} as const;

const PART_NAMES = { 'policy-domain': 'policy domain', begin: 'begin', end: 'end' } as const;

/** Holds the reports of one batch; every finding goes to the shared `Findings` (design: batch.md). */
export class Batch {
  private readonly all: ReportSummary[] = [];
  /** Counted reports by report index. */
  private readonly counted = new Map<number, Counted>();
  /** FCT-7 */
  private readonly forwarders = new Set<string>();
  private readonly failingByIp = new Map<string, Failing[]>();
  private readonly byDigest = new Map<string, ReportSummary>();
  private readonly byIdentity = new Map<string, ReportSummary>();
  /** Counted reports with a range, by reporter and policy domain (CMB-4). */
  private readonly ranges = new Map<string, ReportSummary[]>();
  /** The first spelling of each reporter (CMB-5). */
  private readonly names = new Map<string, string>();

  /** CMB-8: configurations by policy domain, each in the order first seen. */
  private readonly policyMap = new Map<string, Map<string, PolicyEntry>>();
  private revision = 0;
  private readonly now: () => number;

  /** `now`: seconds since the epoch, read once per report (CMB-7). */
  constructor(
    private readonly findings: Findings,
    o: { readonly now?: () => number } = {},
  ) {
    this.now = o.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Moves whenever the list of `policies()` changes (REP-11). */
  get policyRevision(): number {
    return this.revision;
  }

  /** CMB-8: every configuration, domains and configurations in the order first seen. */
  policies(): PolicyConfig[] {
    const out: PolicyConfig[] = [];
    for (const [domain, configs] of this.policyMap) {
      const list = [...configs.values()];
      let best = list[0] as PolicyEntry;
      for (const e of list) {
        const a = e.lastDay ?? '';
        const b = best.lastDay ?? '';
        if (a > b || (a === b && e.reports > best.reports)) best = e;
      }
      for (const e of list) {
        const p = e.policy;
        out.push({
          domain,
          p: p.p,
          sp: p.sp,
          np: p.np,
          adkim: p.adkim,
          aspf: p.aspf,
          pct: p.pct,
          fo: p.fo,
          testing: p.testing,
          discoveryMethod: p.discoveryMethod,
          reporters: [...e.reporters.values()],
          reports: e.reports,
          firstDay: e.firstDay,
          lastDay: e.lastDay,
          inEffect: e === best,
        });
      }
    }
    return out;
  }

  /** Every report read, in order, whatever its status (REP-1, REP-3). */
  get reports(): readonly ReportSummary[] {
    return this.all;
  }

  /** CMB-5: the first spelling loaded of a reporter, given any spelling. */
  reporterName(org: string): string {
    return this.names.get(org.toLowerCase()) ?? org;
  }

  /** Counted reports in the order read (REP-3). */
  countedReports(): IterableIterator<CountedReport> {
    return this.counted.values();
  }

  /** The classification of each record of a counted report, or null when the report is not counted. */
  classifications(report: number): readonly Classification[] | null {
    return this.counted.get(report)?.classes ?? null;
  }

  /** Reads one document as a report and adds it; null when it is not a report (FMT-1). */
  addDocument(input: DocumentInput, file: number): ReportSummary | null {
    const { label, document } = input;
    const at = (f: Omit<Finding, 'file' | 'label'>): Finding => ({ ...f, file, label });
    const read = readReport(document);
    const index = this.all.length;
    const report = read.report;
    for (const f of document.findings) {
      this.findings.add(at({ ...f, ...(report ? { report: index } : {}) }));
    }
    if (!report) {
      this.findings.add(at(read.finding));
      return null;
    }
    for (const f of report.findings) this.findings.add(at({ ...f, report: index }));

    // INP-8..10: the name is parsed, compared, and reported; never used for identity.
    const filename = input.filename === null ? null : parseFilename(input.filename);
    if (filename) {
      const parts = compareFilename(filename, {
        policyDomain: report.policy.domain,
        begin: report.begin,
        end: report.end,
      });
      if (parts.length > 0) {
        this.findings.add(
          at({
            id: 'aggregate.filename.mismatch',
            severity: 'info',
            report: index,
            message: `The file name differs from the report in: ${parts.map((p) => PART_NAMES[p]).join(', ')}.`,
          }),
        );
      }
    }

    // The policy domain is already lowercased and without a trailing dot (FMT-14).
    const reporterKey = report.reporter.toLowerCase();
    const identity =
      report.reportId === null
        ? null
        : [reporterKey, report.reportId, report.policy.domain].join('\n');
    const first = this.byDigest.get(document.digest);
    const same = !first && identity !== null ? this.byIdentity.get(identity) : undefined;
    const status = first ? 'duplicate' : same ? 'conflict' : 'counted';
    const { day, issue } = reportDay(report.begin, report.end, this.now());
    const summary: ReportSummary = {
      index,
      file,
      label,
      format: report.format,
      namespace: report.namespace,
      prefix: report.prefix,
      version: report.version,
      reporter: report.reporter,
      reportId: report.reportId,
      policyDomain: report.policy.domain,
      begin: report.begin,
      end: report.end,
      day,
      status,
      hints: report.hints,
      extensions: report.extensions,
      filename,
      records: report.records.length,
      messages: report.records.reduce((n, r) => n + r.count, 0),
    };
    this.all.push(summary);

    if (first) {
      this.findings.add(
        at({
          id: 'aggregate.report.duplicate',
          severity: 'info',
          report: index,
          message: `The same bytes as ${first.label}; not counted.`,
        }),
      );
      return summary;
    }
    if (same) {
      this.findings.add(
        at({
          id: 'aggregate.report.conflict',
          severity: 'warning',
          report: index,
          message: `The same reporter, Report-ID, and policy domain as ${same.label}, but different content; not counted. The report loaded first stays.`,
        }),
      );
      return summary;
    }

    if (issue) this.findings.add(at({ ...DAY_FINDINGS[issue], report: index }));
    this.classifyReport(summary, report, at);
    this.byDigest.set(document.digest, summary);
    if (identity !== null) this.byIdentity.set(identity, summary);
    if (!this.names.has(reporterKey)) this.names.set(reporterKey, report.reporter);
    for (const text of report.errors) {
      this.findings.add(
        at({
          id: 'aggregate.report.error',
          severity: 'info',
          report: index,
          path: 'report_metadata/error',
          message: `The reporter states an error: ${text}`,
        }),
      );
    }
    this.addPolicy(summary, report, reporterKey, at);
    this.overlaps(summary, `${reporterKey}\n${report.policy.domain}`, at);
    return summary;
  }

  /**
   * FCT-6, FCT-7 (design: classify.md). Passing records first: they may reveal forwarder IPs, which
   * the failing records of this and earlier reports then use.
   */
  private classifyReport(
    summary: ReportSummary,
    report: ReadReport,
    at: (f: Omit<Finding, 'file' | 'label'>) => Finding,
  ): void {
    const counted: Counted = { summary, report, classes: [] };
    this.counted.set(summary.index, counted);
    const domain = report.policy.domain;
    const isForwarder = (ip: string) => this.forwarders.has(ip);
    const facts = report.records.map((r) => recordFacts(r, domain, isForwarder));
    const revealed: string[] = [];
    report.records.forEach((r, i) => {
      const f = facts[i] as (typeof facts)[number];
      if (f.dmarc === 'fail') return;
      const c = classify(f);
      counted.classes[i] = c;
      if (c.path === 'forwarded' && !this.forwarders.has(r.sourceIp)) {
        this.forwarders.add(r.sourceIp);
        revealed.push(r.sourceIp);
      }
    });
    for (const ip of revealed) {
      for (const { counted: o, record } of this.failingByIp.get(ip) ?? []) {
        const r = o.report.records[record] as ReadRecord;
        o.classes[record] = classify(recordFacts(r, o.report.policy.domain, isForwarder));
      }
    }
    report.records.forEach((r, i) => {
      if (counted.classes[i]) return;
      counted.classes[i] = classify(recordFacts(r, domain, isForwarder));
      let list = this.failingByIp.get(r.sourceIp);
      if (!list) {
        list = [];
        this.failingByIp.set(r.sourceIp, list);
      }
      list.push({ counted, record: i });
    });
    for (const r of report.records) {
      const methods = inconsistent(r);
      if (methods.length === 0) continue;
      this.findings.add(
        at({
          id: 'aggregate.record.inconsistent',
          severity: 'info',
          report: summary.index,
          record: r.index,
          line: r.line,
          message: `Aligned as pass with no raw pass result: ${methods.map((m) => m.toUpperCase()).join(', ')}. The aligned result is used.`,
        }),
      );
    }
  }

  /** CMB-8: adds the counted report to its configuration; `policy.changed` at a domain's second. */
  private addPolicy(
    s: ReportSummary,
    report: ReadReport,
    reporterKey: string,
    at: (f: Omit<Finding, 'file' | 'label'>) => Finding,
  ): void {
    const policy = report.policy;
    let configs = this.policyMap.get(policy.domain);
    if (!configs) {
      configs = new Map();
      this.policyMap.set(policy.domain, configs);
    }
    const key = JSON.stringify(POLICY_KEYS.map((k) => policy[k]));
    let e = configs.get(key);
    if (!e) {
      e = { policy, reporters: new Map(), reports: 0, firstDay: null, lastDay: null };
      configs.set(key, e);
      if (configs.size === 2) {
        this.findings.add(
          at({
            id: 'aggregate.policy.changed',
            severity: 'info',
            report: s.index,
            path: 'policy_published',
            message: `The published policy of ${policy.domain} differs between reports.`,
          }),
        );
      }
    }
    e.reports++;
    if (!e.reporters.has(reporterKey)) e.reporters.set(reporterKey, this.reporterName(reporterKey));
    if (s.day !== null) {
      if (e.firstDay === null || s.day < e.firstDay) e.firstDay = s.day;
      if (e.lastDay === null || s.day > e.lastDay) e.lastDay = s.day;
    }
    this.revision++;
  }

  /** CMB-4: one finding for the later report, naming the first counted report it overlaps. */
  private overlaps(
    s: ReportSummary,
    group: string,
    at: (f: Omit<Finding, 'file' | 'label'>) => Finding,
  ): void {
    const { begin, end } = s;
    if (begin === null || end === null) return;
    let list = this.ranges.get(group);
    if (!list) {
      list = [];
      this.ranges.set(group, list);
    }
    const hits = list.filter((o) => begin < (o.end as number) && (o.begin as number) < end);
    list.push(s);
    const head = hits[0];
    if (!head) return;
    const others = hits.length - 1;
    this.findings.add(
      at({
        id: 'aggregate.report.overlap',
        severity: 'warning',
        report: s.index,
        message: `The period overlaps ${head.label}${others > 0 ? ` and ${others} other report${others > 1 ? 's' : ''}` : ''} from the same reporter for the same domain. Both are counted.`,
      }),
    );
  }
}

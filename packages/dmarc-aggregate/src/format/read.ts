/** An element tree becomes a report (docs/reference/dmarc-aggregate/format.md, FMT-1..18). */
import { parseIp } from '@benchside/dns';
import type { XmlDocument, XmlElement } from '../xml/reader.ts';
import { BY_PATH, ENUMS, type Multiplicity, NAMESPACES } from './schema.ts';

export type Format = 'rfc9990' | 'rfc7489' | 'unknown';

export interface FormatFinding {
  readonly id:
    | 'aggregate.format.not-feedback'
    | 'aggregate.format.unknown-namespace'
    | 'aggregate.format.version'
    | 'aggregate.format.mixed'
    | 'aggregate.schema.unknown-element'
    | 'aggregate.schema.missing'
    | 'aggregate.schema.repeated'
    | 'aggregate.value.unknown'
    | 'aggregate.value.invalid'
    | 'aggregate.value.legacy'
    | 'aggregate.record.skipped';
  readonly severity: 'error' | 'warning' | 'info';
  /** Element path from the root, such as `record/row/count`. */
  readonly path?: string;
  /** 0-based record index, for findings inside a record. */
  readonly record?: number;
  readonly line?: number;
  readonly message: string;
}

export interface ContentHint {
  readonly format: 'rfc9990' | 'rfc7489';
  readonly hint: string;
  readonly paths: readonly string[];
}

export interface ExtensionCount {
  readonly namespace: string;
  readonly position: 'extension' | 'record';
  readonly count: number;
}

export interface DkimAuth {
  readonly domain: string;
  readonly selector: string | null;
  readonly result: string;
  readonly humanResult: string | null;
}

export interface SpfAuth {
  readonly domain: string;
  readonly scope: string | null;
  /** After FMT-15. */
  readonly result: string;
  /** As written. */
  readonly original: string;
  readonly humanResult: string | null;
  /** The one FCT-4 uses (FMT-9). */
  readonly used: boolean;
}

export interface Reason {
  readonly type: string;
  readonly comment: string | null;
}

export interface ReadRecord {
  readonly line: number;
  /** Normalized by FMT-12, or the text as written when not a valid address. */
  readonly sourceIp: string;
  readonly validIp: boolean;
  readonly count: number;
  readonly disposition: string | null;
  readonly dkim: string;
  readonly spf: string;
  readonly reasons: readonly Reason[];
  readonly headerFrom: string | null;
  /** `''` is a null reverse-path (§3.1.1.10). */
  readonly envelopeFrom: string | null;
  readonly envelopeTo: string | null;
  readonly dkimResults: readonly DkimAuth[];
  readonly spfResults: readonly SpfAuth[];
}

export interface Policy {
  readonly domain: string;
  readonly adkim: string | null;
  readonly aspf: string | null;
  readonly p: string | null;
  readonly sp: string | null;
  readonly np: string | null;
  readonly pct: number | null;
  readonly fo: string | null;
  readonly discoveryMethod: string | null;
  readonly testing: string | null;
}

export interface ReadReport {
  readonly format: Format;
  readonly namespace: string | null;
  readonly prefix: string | null;
  readonly version: string | null;
  readonly reporter: string;
  readonly email: string | null;
  readonly extraContactInfo: string | null;
  readonly reportId: string | null;
  readonly begin: number | null;
  readonly end: number | null;
  readonly errors: readonly string[];
  readonly generator: string | null;
  readonly policy: Policy;
  readonly records: readonly ReadRecord[];
  readonly hints: readonly ContentHint[];
  readonly extensions: readonly ExtensionCount[];
  /** Paths of text values cut at 4 096 characters (FMT-11). */
  readonly truncated: readonly { readonly path: string; readonly record?: number }[];
  readonly findings: readonly FormatFinding[];
}

const MAX_TEXT = 4096;
const MAX_TIME = 253_402_300_799;

/** FMT-1..18: reads one XML document as a report, or gives `not-feedback` (FMT-1). */
export function readReport(
  doc: XmlDocument,
): { report: ReadReport; finding: null } | { report: null; finding: FormatFinding } {
  const root = doc.root;
  if (root.local !== 'feedback') {
    const finding: FormatFinding = {
      id: 'aggregate.format.not-feedback',
      severity: 'error',
      line: root.line,
      message: `The root element is ${root.local}, not feedback`,
    };
    return { report: null, finding };
  }
  return { report: new Reader(root).read(), finding: null };
}

class Reader {
  private readonly format: Format;
  private readonly column: 'rfc7489' | 'rfc9990';
  private readonly findings: FormatFinding[] = [];
  private readonly hints = new Map<string, { format: 'rfc9990' | 'rfc7489'; paths: string[] }>();
  private readonly extensions = new Map<'extension' | 'record', Map<string, number>>();
  private readonly truncated: { path: string; record?: number }[] = [];
  /** The current record index, for findings. */
  private record: number | undefined;

  constructor(private readonly root: XmlElement) {
    const ns = root.ns;
    this.format =
      ns === NAMESPACES.rfc9990
        ? 'rfc9990'
        : ns === NAMESPACES.rfc7489 || ns === null
          ? 'rfc7489'
          : 'unknown';
    // FMT-3: an unknown report is read with the RFC 9990 rules.
    this.column = this.format === 'rfc7489' ? 'rfc7489' : 'rfc9990';
  }

  read(): ReadReport {
    const root = this.root;
    if (root.lang !== null) this.hint('rfc9990', 'lang attribute', root.local);
    if (this.format === 'unknown') {
      this.add(
        'aggregate.format.unknown-namespace',
        'warning',
        `Unknown namespace ${root.ns}`,
        '',
        root.line,
      );
    }
    const top = this.children(root, '');
    const versionText = this.text(top, '', 'version');
    if (
      versionText !== null &&
      !(/^[+-]?\d+(\.\d+)?$/.test(versionText) && Number(versionText) === 1)
    ) {
      this.add('aggregate.format.version', 'info', `Version ${versionText} is not 1.0`, 'version');
    }
    const meta = this.one(top, '', 'report_metadata');
    const m = meta ? this.children(meta, 'report_metadata') : new Map<string, XmlElement[]>();
    const range = this.one(m, 'report_metadata', 'date_range');
    const d = range
      ? this.children(range, 'report_metadata/date_range')
      : new Map<string, XmlElement[]>();
    const errors = this.all(m, 'report_metadata', 'error').map((e) =>
      this.cut(e.text, 'report_metadata/error'),
    );
    if (errors.length > 1) this.hint('rfc7489', 'more than one error', 'report_metadata/error');
    const generator = this.text(m, 'report_metadata', 'generator');
    if (generator !== null) this.hint('rfc9990', 'generator', 'report_metadata/generator');

    const pub = this.one(top, '', 'policy_published');
    const pp = pub ? this.children(pub, 'policy_published') : new Map<string, XmlElement[]>();
    const policy = this.policy(pp);

    const extension = this.one(top, '', 'extension');
    if (extension) {
      this.hint('rfc9990', 'extension', 'extension');
      for (const child of extension.children) this.countExtension(child.ns ?? '', 'extension');
    }

    const records = this.all(top, '', 'record').flatMap((el, i) => {
      this.record = i;
      const rec = this.readRecord(el);
      this.record = undefined;
      return rec ? [rec] : [];
    });

    const hints: ContentHint[] = [...this.hints].map(([hint, h]) => ({
      format: h.format,
      hint,
      paths: h.paths,
    }));
    if (this.format !== 'unknown') {
      const other = hints.filter((h) => h.format !== this.format);
      if (other.length > 0) {
        this.add(
          'aggregate.format.mixed',
          'info',
          `Declared ${this.format} but holds ${other.map((h) => h.hint).join(', ')}`,
          '',
        );
      }
    }
    return {
      format: this.format,
      namespace: root.ns,
      prefix: root.prefix,
      version: versionText,
      reporter: this.text(m, 'report_metadata', 'org_name') ?? '(unknown)',
      email: this.text(m, 'report_metadata', 'email'),
      extraContactInfo: this.text(m, 'report_metadata', 'extra_contact_info'),
      reportId: this.text(m, 'report_metadata', 'report_id'),
      begin: this.integer(d, 'report_metadata/date_range', 'begin', 0, MAX_TIME),
      end: this.integer(d, 'report_metadata/date_range', 'end', 0, MAX_TIME),
      errors,
      generator,
      policy,
      records,
      hints,
      extensions: [...this.extensions].flatMap(([position, counts]) =>
        [...counts].map(([namespace, count]) => ({ namespace, position, count })),
      ),
      truncated: this.truncated,
      findings: this.findings,
    };
  }

  private policy(pp: Map<string, XmlElement[]>): Policy {
    const at = 'policy_published';
    const np = this.enumerated(pp, at, 'np');
    if (np !== null) this.hint('rfc9990', 'np', `${at}/np`);
    const discoveryMethod = this.enumerated(pp, at, 'discovery_method');
    if (discoveryMethod !== null)
      this.hint('rfc9990', 'discovery_method', `${at}/discovery_method`);
    const testing = this.enumerated(pp, at, 'testing');
    if (testing !== null) this.hint('rfc9990', 'testing', `${at}/testing`);
    const pct = this.integer(pp, at, 'pct', 0, 100);
    if (pp.has('pct')) this.hint('rfc7489', 'pct', `${at}/pct`);
    return {
      domain: this.domain(pp, at, 'domain') ?? '(unknown)',
      adkim: this.enumerated(pp, at, 'adkim'),
      aspf: this.enumerated(pp, at, 'aspf'),
      p: this.enumerated(pp, at, 'p'),
      sp: this.enumerated(pp, at, 'sp'),
      np,
      pct,
      fo: this.text(pp, at, 'fo'),
      discoveryMethod,
      testing,
    };
  }

  private readRecord(el: XmlElement): ReadRecord | null {
    const base = 'record';
    const rec = this.children(el, base, true);
    const rowEl = this.one(rec, base, 'row');
    const row = rowEl ? this.children(rowEl, `${base}/row`) : new Map<string, XmlElement[]>();
    const peEl = this.one(row, `${base}/row`, 'policy_evaluated', true);
    const pe = peEl
      ? this.children(peEl, `${base}/row/policy_evaluated`)
      : new Map<string, XmlElement[]>();

    // FMT-18: the elements whose absence skips the record.
    const skip: string[] = [];
    const ipEl = this.one(row, `${base}/row`, 'source_ip', true);
    if (!ipEl) skip.push('source_ip');
    const countRaw = this.one(row, `${base}/row`, 'count', true)?.text ?? null;
    const countValue =
      countRaw !== null && /^[+-]?\d+$/.test(countRaw) ? Number(countRaw) : Number.NaN;
    if (countRaw === null || !(countValue >= 0 && countValue <= Number.MAX_SAFE_INTEGER))
      skip.push('count');
    if (!pe.has('dkim')) skip.push('policy_evaluated/dkim');
    if (!pe.has('spf')) skip.push('policy_evaluated/spf');
    if (skip.length > 0) {
      this.add(
        'aggregate.record.skipped',
        'warning',
        `Record skipped: ${skip.join(', ')} missing or invalid`,
        base,
        el.line,
      );
      return null;
    }

    const ipText = this.cut((ipEl as XmlElement).text, `${base}/row/source_ip`);
    const ip = /[[\]]|^ipv6:/i.test(ipText) ? null : parseIp(ipText);
    if (ip === null) {
      this.add(
        'aggregate.value.invalid',
        'warning',
        `source_ip ${brief(ipText)} is not an IP address`,
        `${base}/row/source_ip`,
      );
    }

    const reasons: Reason[] = this.all(pe, `${base}/row/policy_evaluated`, 'reason').flatMap(
      (r) => {
        const at = `${base}/row/policy_evaluated/reason`;
        const c = this.children(r, at);
        const type = this.enumerated(c, at, 'type');
        if (type === null) return [];
        if (type === 'forwarded' || type === 'sampled_out')
          this.hint('rfc7489', type, `${at}/type`);
        if (type === 'policy_test_mode') this.hint('rfc9990', type, `${at}/type`);
        return [{ type, comment: this.text(c, at, 'comment') }];
      },
    );
    const disposition = this.enumerated(pe, `${base}/row/policy_evaluated`, 'disposition');
    if (disposition === 'pass')
      this.hint('rfc9990', 'disposition pass', `${base}/row/policy_evaluated/disposition`);

    const idsEl = this.one(rec, base, 'identifiers');
    const ids = idsEl
      ? this.children(idsEl, `${base}/identifiers`)
      : new Map<string, XmlElement[]>();
    const arEl = this.one(rec, base, 'auth_results');
    const ar = arEl ? this.children(arEl, `${base}/auth_results`) : new Map<string, XmlElement[]>();

    const dkimResults = this.all(ar, `${base}/auth_results`, 'dkim').flatMap((dk): DkimAuth[] => {
      const at = `${base}/auth_results/dkim`;
      const c = this.children(dk, at);
      const domain = this.domain(c, at, 'domain');
      const result = this.enumerated(c, at, 'result');
      if (domain === null || result === null) return [];
      return [
        {
          domain,
          selector: this.text(c, at, 'selector'),
          result,
          humanResult: this.text(c, at, 'human_result'),
        },
      ];
    });

    const spfEls = this.all(ar, `${base}/auth_results`, 'spf');
    if (spfEls.length > 1) this.hint('rfc7489', 'more than one spf', `${base}/auth_results/spf`);
    const spfRead = spfEls.flatMap((sp) => {
      const at = `${base}/auth_results/spf`;
      const c = this.children(sp, at);
      const domain = this.domain(c, at, 'domain');
      const original = this.text(c, at, 'result');
      const scope = this.enumerated(c, at, 'scope');
      if (scope === 'helo') this.hint('rfc7489', 'spf scope helo', `${at}/scope`);
      const humanResult = this.text(c, at, 'human_result');
      if (humanResult !== null) this.hint('rfc9990', 'spf/human_result', `${at}/human_result`);
      if (domain === null || original === null) return [];
      const result = this.spfResult(original, `${at}/result`);
      return [{ domain, scope, result, original, humanResult }];
    });
    // FMT-9: RFC 7489 allows several (the first mfrom is used, else the first); RFC 9990 allows one.
    if (this.column === 'rfc9990' && spfEls.length > 1) {
      this.add(
        'aggregate.schema.repeated',
        'info',
        `${base}/auth_results/spf appears ${spfEls.length} times`,
        `${base}/auth_results/spf`,
      );
    }
    const usedAt =
      this.column === 'rfc7489'
        ? Math.max(
            0,
            spfRead.findIndex((s) => s.scope === 'mfrom'),
          )
        : 0;
    const spfResults: SpfAuth[] = spfRead.map((s, i) => ({ ...s, used: i === usedAt }));

    return {
      line: el.line,
      sourceIp: ip ? ip.text : ipText,
      validIp: ip !== null,
      count: countValue,
      disposition,
      dkim: this.enumerated(pe, `${base}/row/policy_evaluated`, 'dkim') as string,
      spf: this.enumerated(pe, `${base}/row/policy_evaluated`, 'spf') as string,
      reasons,
      headerFrom: this.domain(ids, `${base}/identifiers`, 'header_from'),
      envelopeFrom: this.domain(ids, `${base}/identifiers`, 'envelope_from'),
      envelopeTo: this.domain(ids, `${base}/identifiers`, 'envelope_to'),
      dkimResults,
      spfResults,
    };
  }

  /** FMT-15: older SPF spellings. */
  private spfResult(original: string, path: string): string {
    const v = original.toLowerCase();
    const legacy = v === 'unknown' ? 'temperror' : v === 'error' ? 'permerror' : null;
    if (legacy !== null) {
      this.add(
        'aggregate.value.legacy',
        'info',
        `SPF result ${original} is read as ${legacy}`,
        path,
      );
      return legacy;
    }
    if (v === 'policy') this.hint('rfc9990', 'spf result policy', path);
    return this.checkEnum(path, original);
  }

  /**
   * FMT-4..6: the report elements of `el` by local name. Extension elements are counted (FMT-5);
   * unknown report elements are reported and dropped (FMT-6).
   */
  private children(el: XmlElement, path: string, recordLevel = false): Map<string, XmlElement[]> {
    const out = new Map<string, XmlElement[]>();
    for (const child of el.children) {
      const childPath = path ? `${path}/${child.local}` : child.local;
      if (child.ns !== this.root.ns && child.ns !== null) {
        this.countExtension(child.ns, recordLevel ? 'record' : 'extension');
        if (recordLevel) this.hint('rfc9990', 'record-level extension', childPath);
        continue;
      }
      if (!BY_PATH.has(childPath)) {
        this.add(
          'aggregate.schema.unknown-element',
          'info',
          `Unknown element ${childPath}`,
          childPath,
          child.line,
        );
        continue;
      }
      if (child.lang !== null) this.hint('rfc9990', 'lang attribute', childPath);
      const list = out.get(child.local);
      if (list) list.push(child);
      else out.set(child.local, [child]);
    }
    return out;
  }

  private countExtension(namespace: string, position: 'extension' | 'record'): void {
    let counts = this.extensions.get(position);
    if (!counts) {
      counts = new Map();
      this.extensions.set(position, counts);
    }
    counts.set(namespace, (counts.get(namespace) ?? 0) + 1);
  }

  private multiplicity(path: string): Multiplicity {
    return BY_PATH.get(path)?.[this.column] ?? 'O';
  }

  /** All elements of `name`; FMT-8 for a required one that is missing. */
  private all(
    map: Map<string, XmlElement[]>,
    at: string,
    name: string,
    quiet = false,
  ): XmlElement[] {
    const path = at ? `${at}/${name}` : name;
    const list = map.get(name) ?? [];
    const rule = BY_PATH.get(path);
    const mult = this.multiplicity(path);
    if (list.length === 0 && (mult === 'R' || mult === '+') && !rule?.container && !quiet) {
      this.add('aggregate.schema.missing', 'warning', `Missing ${path}`, path);
    }
    return list;
  }

  /** The first element of `name`; FMT-9 when one that may appear once repeats. */
  private one(
    map: Map<string, XmlElement[]>,
    at: string,
    name: string,
    quiet = false,
  ): XmlElement | null {
    const list = this.all(map, at, name, quiet);
    const path = at ? `${at}/${name}` : name;
    const mult = this.multiplicity(path);
    if (list.length > 1 && mult !== '*' && mult !== '+') {
      this.add('aggregate.schema.repeated', 'info', `${path} appears ${list.length} times`, path);
    }
    return list[0] ?? null;
  }

  private text(map: Map<string, XmlElement[]>, at: string, name: string): string | null {
    const el = this.one(map, at, name);
    return el ? this.cut(el.text, at ? `${at}/${name}` : name) : null;
  }

  /** FMT-11 */
  private cut(text: string, path: string): string {
    if (text.length <= MAX_TEXT) return text;
    this.truncated.push(this.record === undefined ? { path } : { path, record: this.record });
    return text.slice(0, MAX_TEXT);
  }

  /** FMT-14 */
  private domain(map: Map<string, XmlElement[]>, at: string, name: string): string | null {
    const el = this.one(map, at, name);
    if (!el) return null;
    const path = at ? `${at}/${name}` : name;
    return this.cut(el.text, path)
      .replace(/\.$/, '')
      .replace(/[A-Z]/g, (c) => c.toLowerCase());
  }

  /** FMT-10 */
  private enumerated(map: Map<string, XmlElement[]>, at: string, name: string): string | null {
    const el = this.one(map, at, name);
    if (!el) return null;
    return this.checkEnum(`${at}/${name}`, el.text);
  }

  private checkEnum(path: string, raw: string): string {
    const values = ENUMS[path];
    const v = raw.toLowerCase();
    if (!values) return v;
    if (values.rfc7489.includes(v) || values.rfc9990.includes(v)) return v;
    this.add(
      'aggregate.value.unknown',
      'warning',
      `${path} has the unknown value ${brief(raw)}`,
      path,
    );
    return this.cut(raw, path);
  }

  /** FMT-13: an integer in range, else value.invalid and treated as missing. */
  private integer(
    map: Map<string, XmlElement[]>,
    at: string,
    name: string,
    min: number,
    max: number,
  ): number | null {
    const el = this.one(map, at, name);
    if (!el) return null;
    const n = /^[+-]?\d+$/.test(el.text) ? Number(el.text) : Number.NaN;
    if (n >= min && n <= max) return n;
    const path = `${at}/${name}`;
    this.add(
      'aggregate.value.invalid',
      'warning',
      `${path} ${brief(el.text)} is not an integer from ${min} to ${max}`,
      path,
    );
    return null;
  }

  private hint(format: 'rfc9990' | 'rfc7489', hint: string, path: string): void {
    const h = this.hints.get(hint);
    if (h) {
      if (!h.paths.includes(path)) h.paths.push(path);
    } else {
      this.hints.set(hint, { format, paths: [path] });
    }
  }

  private add(
    id: FormatFinding['id'],
    severity: FormatFinding['severity'],
    message: string,
    path: string,
    line?: number,
  ): void {
    this.findings.push({
      id,
      severity,
      message,
      ...(path ? { path } : {}),
      ...(this.record !== undefined ? { record: this.record } : {}),
      ...(line !== undefined ? { line } : {}),
    });
  }
}

/** A value shortened for a finding message. */
function brief(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

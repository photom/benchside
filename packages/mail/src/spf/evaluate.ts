/**
 * SPF evaluation (docs/reference/mail/spf.md; design: mail-design/spf.md).
 * One result per identity (MAIL FROM, HELO). Never throws on input.
 */
import type { DnsAnswer, DnsQuery, DnsType } from '../dns/types.ts';
import type { Envelope, EnvelopeValue } from '../envelope/values.ts';
import { guard } from '../shared/abort.ts';
import type { Evidence, Finding, Severity } from '../shared/findings.ts';
import { type Ip, inCidr, parseIp } from '../shared/ip.ts';
import {
  expandMacro,
  type MacroEnv,
  type MacroString,
  nibbles,
  parseMacroString,
} from './macro.ts';
import { isSpfDomain, parseRecord, type Qualifier, type Term } from './record.ts';

export type SpfResult =
  | 'none'
  | 'neutral'
  | 'pass'
  | 'fail'
  | 'softfail'
  | 'temperror'
  | 'permerror'
  | 'not-evaluated';
export type SpfNotEvaluatedReason =
  | 'missing-delivery-detail'
  | 'offline'
  | 'sensitive-query-blocked'
  | 'timeout'
  | 'internal-error'
  | 'invalid-input';

export interface SpfTermTrace {
  readonly term: string;
  readonly outcome: 'match' | 'no-match' | 'error' | 'not-reached';
  readonly queryIds: readonly string[];
  readonly child?: SpfNode;
}

export interface SpfNode {
  readonly domain: string;
  readonly record?: string;
  readonly queryId?: string;
  readonly result: SpfResult;
  readonly terms: readonly SpfTermTrace[];
}

export interface SpfIdentityResult {
  readonly result: SpfResult;
  readonly reason?: SpfNotEvaluatedReason;
  readonly domain?: string;
  readonly sender?: string;
  /** SPF-19 */
  readonly counters: { readonly dnsTerms: number; readonly voids: number };
  readonly trace?: SpfNode;
  /** SPF-14: the expanded `exp` text, for `fail` only. */
  readonly explanation?: string;
  readonly findings: readonly Finding[];
}

export interface SpfResults {
  readonly mailFrom: SpfIdentityResult;
  readonly helo: SpfIdentityResult;
}

export interface SpfContext {
  readonly envelope: Envelope;
  readonly resolve: (query: DnsQuery, signal: AbortSignal) => Promise<DnsAnswer>;
  readonly signal: AbortSignal;
  /** TIME-1..3; `%{t}`. */
  readonly referenceTime: Date;
  /** The boundary's `by` host, or `unknown` (`%{r}`). */
  readonly receiver: string;
}

const MAX_DNS_TERMS = 10; // SPF-15
const MAX_VOIDS = 2; // SPF-16
const MAX_MX_NAMES = 10; // SPF-17
const MAX_PTR_NAMES = 10; // SPF-25
const QUALIFIER_RESULT: Record<Qualifier, SpfResult> = {
  '+': 'pass',
  '-': 'fail',
  '~': 'softfail',
  '?': 'neutral',
};

/** An outcome that ends evaluation; caught once per identity. */
class Stop extends Error {
  constructor(
    readonly result: SpfResult,
    readonly reason?: SpfNotEvaluatedReason,
    readonly finding?: { readonly id: string; readonly message: string },
  ) {
    super(result);
  }
}

const permerror = (id: string, message: string) =>
  new Stop('permerror', undefined, { id, message });

type MutableTerm = { -readonly [K in keyof SpfTermTrace]: SpfTermTrace[K] } & {
  queryIds: string[];
  child?: MutableNode;
};
type MutableNode = { -readonly [K in keyof SpfNode]: SpfNode[K] } & { terms: MutableTerm[] };

/** One identity's evaluation state. */
interface Run {
  readonly ctx: SpfContext;
  readonly ip: Ip;
  readonly sender: string;
  readonly local: string;
  readonly senderDomain: string;
  readonly helo: string;
  readonly budget: { dnsTerms: number; voids: number };
  readonly findings: Finding[];
  /** The envelope fields this identity comes from (evidence). */
  readonly sources: readonly Evidence[];
  lastQueryId?: string;
  explanation?: string;
  /** SPF-26: the client's validated names, looked up once per identity. */
  ptr?: Promise<PtrNames>;
}

interface PtrNames {
  /** Lowercase, without the trailing dot. */
  readonly names: readonly string[];
  readonly queryIds: readonly string[];
  /** The PTR lookup found nothing (SPF-16). */
  readonly void: boolean;
}

/** A name to check, and whether it carries more than domain names (DNS-9). */
interface Target {
  readonly name: string;
  readonly sensitive: boolean;
}

export async function evaluateSpf(ctx: SpfContext): Promise<SpfResults> {
  const { clientIp, helo, mailFrom } = ctx.envelope;
  const ip = clientIp ? parseIp(clientIp.value) : null;
  const sources = (...values: (EnvelopeValue | undefined)[]): Evidence[] =>
    values.flatMap((v) =>
      v && v.source !== 'user' ? [{ kind: 'header', index: v.source.field } as const] : [],
    );
  const missing = (): SpfIdentityResult => ({
    result: 'not-evaluated',
    reason: 'missing-delivery-detail',
    counters: { dnsTerms: 0, voids: 0 },
    findings: [],
  });

  // SPF-2, SPF-3
  const heloIdentity = async (): Promise<SpfIdentityResult> => {
    if (!ip || !helo) return missing();
    if (helo.value.startsWith('[') || parseIp(helo.value) || !isSpfDomain(helo.value)) {
      return {
        result: 'none',
        domain: helo.value,
        counters: { dnsTerms: 0, voids: 0 },
        findings: [],
      };
    }
    return identity(
      ctx,
      ip,
      `postmaster@${helo.value}`,
      helo.value,
      helo.value,
      sources(clientIp, helo),
    );
  };
  const heloPending = guardIdentity(ctx, heloIdentity, sources(clientIp, helo));

  // SPF-1
  const mailFromIdentity = async (): Promise<SpfIdentityResult> => {
    if (!ip || !mailFrom) return missing();
    if (mailFrom.value === '') {
      if (!helo) return missing();
      // The same check_host(ip, HELO, postmaster@HELO) as the HELO identity:
      // reuse it, so its queries are made and counted once (DNS-13).
      const r = await heloPending;
      const finding: Finding = {
        id: 'spf.helo-only',
        severity: 'info',
        message: 'MAIL FROM was empty (<>), so SPF checked the HELO name instead.',
        evidence: sources(mailFrom),
      };
      return { ...r, sender: `postmaster@${helo.value}`, findings: [finding, ...r.findings] };
    }
    // SPF-20
    const at = mailFrom.value.lastIndexOf('@');
    const local = at < 0 ? '' : mailFrom.value.slice(0, at);
    const domain = mailFrom.value.slice(at + 1);
    const sender = `${local || 'postmaster'}@${domain}`;
    return identity(ctx, ip, sender, domain, helo?.value ?? '', sources(clientIp, mailFrom));
  };

  const [mailFromResult, heloResult] = await Promise.all([
    guardIdentity(ctx, mailFromIdentity, sources(clientIp, mailFrom)),
    heloPending,
  ]);
  return { mailFrom: mailFromResult, helo: heloResult };
}

/** REP-7, REP-8 per identity. */
function guardIdentity(
  ctx: SpfContext,
  run: () => Promise<SpfIdentityResult>,
  evidence: readonly Evidence[],
): Promise<SpfIdentityResult> {
  return guard(ctx.signal, run, (kind, error) => ({
    result: 'not-evaluated',
    reason: kind,
    counters: { dnsTerms: 0, voids: 0 },
    findings: [
      {
        id: `analysis.${kind}`,
        severity: 'error',
        message:
          kind === 'timeout'
            ? 'SPF was not evaluated within the time limit.'
            : `SPF stopped because of an unexpected error: ${String(error)}`,
        // REP-4 needs at least one evidence item, even with no envelope field to point at.
        evidence:
          evidence.length > 0 ? [...evidence] : [{ kind: 'bytes', range: { start: 0, end: 0 } }],
      },
    ],
  }));
}

/** check_host for one identity, with its trace, counters, and findings. */
async function identity(
  ctx: SpfContext,
  ip: Ip,
  sender: string,
  domain: string,
  helo: string,
  sources: readonly Evidence[],
): Promise<SpfIdentityResult> {
  const at = sender.lastIndexOf('@');
  const run: Run = {
    ctx,
    ip,
    sender,
    local: sender.slice(0, at),
    senderDomain: sender.slice(at + 1),
    helo,
    budget: { dnsTerms: 0, voids: 0 },
    findings: [],
    sources,
  };
  const root: MutableNode = { domain, result: 'none', terms: [] };
  let result: SpfResult;
  let reason: SpfNotEvaluatedReason | undefined;
  try {
    result = await checkHost(run, { name: domain, sensitive: false }, root, false);
    // SPF-15: close to the limit.
    if (run.budget.dnsTerms >= 8 && run.budget.dnsTerms <= 9) {
      add(
        run,
        'spf.near-lookup-limit',
        'warning',
        `${run.budget.dnsTerms} of the 10 allowed DNS-querying terms are used.`,
      );
    }
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    result = error.result;
    reason = error.reason;
    if (error.finding) add(run, error.finding.id, 'error', error.finding.message);
  }
  return {
    result,
    ...(reason ? { reason } : {}),
    domain,
    sender,
    counters: { ...run.budget },
    trace: root,
    ...(run.explanation !== undefined ? { explanation: run.explanation } : {}),
    findings: run.findings,
  };
}

function add(run: Run, id: string, severity: Severity, message: string): void {
  const evidence: Evidence[] = [
    ...(run.lastQueryId !== undefined ? [{ kind: 'dns', queryId: run.lastQueryId } as const] : []),
    ...run.sources,
  ];
  run.findings.push({
    id,
    severity,
    message,
    evidence: evidence.length > 0 ? evidence : [{ kind: 'bytes', range: { start: 0, end: 0 } }],
  });
}

async function query(run: Run, target: Target, type: DnsType, purpose: string): Promise<DnsAnswer> {
  const answer = await run.ctx.resolve(
    { name: target.name, type, sensitivity: target.sensitive ? 'sensitive' : 'domain', purpose },
    run.ctx.signal,
  );
  run.lastQueryId = answer.queryId;
  return answer;
}

/** SPF-21, SPF-23: answers that end evaluation. NOERROR and NXDOMAIN pass through. */
function stopOnFailure(answer: DnsAnswer): void {
  switch (answer.rcode) {
    case 'SERVFAIL':
    case 'TIMEOUT':
    case 'BUDGET':
      throw new Stop('temperror');
    case 'OFFLINE':
      throw new Stop('not-evaluated', 'offline');
    case 'BLOCKED':
      throw new Stop('not-evaluated', 'sensitive-query-blocked');
  }
}

const isVoid = (a: DnsAnswer) => a.rcode === 'NXDOMAIN' || a.records.length === 0;

function countTerm(run: Run): void {
  run.budget.dnsTerms++;
  if (run.budget.dnsTerms > MAX_DNS_TERMS) {
    throw permerror('spf.lookup-limit', 'More than 10 DNS-querying terms (RFC 7208 §4.6.4).');
  }
}

function countVoid(run: Run): void {
  run.budget.voids++;
  if (run.budget.voids > MAX_VOIDS) {
    throw permerror('spf.lookup-limit', 'More than 2 lookups found nothing (RFC 7208 §4.6.4).');
  }
}

async function checkHost(
  run: Run,
  target: Target,
  node: MutableNode,
  inInclude: boolean,
): Promise<SpfResult> {
  try {
    node.result = await evaluateRecord(run, target, node, inInclude);
    return node.result;
  } catch (error) {
    if (error instanceof Stop) node.result = error.result;
    throw error;
  }
}

async function evaluateRecord(
  run: Run,
  target: Target,
  node: MutableNode,
  inInclude: boolean,
): Promise<SpfResult> {
  // SPF-7
  if (!isSpfDomain(target.name)) return 'none';
  const answer = await query(run, target, 'TXT', `SPF record for ${target.name}`);
  node.queryId = answer.queryId;
  stopOnFailure(answer);
  if (answer.rcode === 'NXDOMAIN') return 'none';
  // SPF-5, SPF-6
  const records = answer.records.filter((r) => /^v=spf1( |$)/i.test(r));
  if (records.length === 0) return 'none';
  if (records.length > 1) {
    throw permerror('spf.multiple-records', `${target.name} has more than one SPF record.`);
  }
  const record = records[0] as string;
  node.record = record;
  const parsed = parseRecord(record);
  if ('error' in parsed) {
    throw permerror('spf.syntax', `The SPF record of ${target.name} is invalid: ${parsed.error}`);
  }
  recordWarnings(run, parsed.terms);

  const mechanisms = parsed.terms.filter((t) => t.kind !== 'redirect' && t.kind !== 'exp');
  node.terms = mechanisms.map((t) => ({ term: t.text, outcome: 'not-reached', queryIds: [] }));
  for (const [i, term] of mechanisms.entries()) {
    const trace = node.terms[i] as MutableTerm;
    let matched: boolean;
    try {
      matched = await matches(run, term, target, trace);
    } catch (error) {
      if (error instanceof Stop) trace.outcome = 'error';
      throw error;
    }
    trace.outcome = matched ? 'match' : 'no-match';
    if (!matched) continue;
    const result = QUALIFIER_RESULT['q' in term ? term.q : '+'];
    const exp = parsed.terms.find((t) => t.kind === 'exp');
    // SPF-14: only for fail, and not for an included record.
    if (result === 'fail' && !inInclude && exp?.kind === 'exp') {
      await explain(run, exp.spec, target.name);
    }
    return result;
  }

  // SPF-10
  const redirect = parsed.terms.find((t) => t.kind === 'redirect');
  if (redirect?.kind !== 'redirect') return 'neutral';
  const trace: MutableTerm = { term: redirect.text, outcome: 'not-reached', queryIds: [] };
  node.terms.push(trace);
  try {
    countTerm(run);
    const next = await expandName(run, redirect.spec, target.name, trace);
    const child: MutableNode = { domain: next.name, result: 'none', terms: [] };
    trace.child = child;
    const result = await checkHost(run, next, child, inInclude);
    if (result === 'none') {
      throw permerror('spf.syntax', `The redirect target ${next.name} has no SPF record.`);
    }
    trace.outcome = 'match';
    return result;
  } catch (error) {
    if (error instanceof Stop) trace.outcome = 'error';
    throw error;
  }
}

/** spf.plus-all, spf.ptr, spf.wide-range: once each per record. */
function recordWarnings(run: Run, terms: readonly Term[]): void {
  const seen = new Set<string>();
  const warn = (id: string, message: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    add(run, id, 'warning', message);
  };
  for (const t of terms) {
    if (t.kind === 'all' && t.q === '+')
      warn('spf.plus-all', 'The record allows any server to send (+all).');
    if (t.kind === 'ptr')
      warn('spf.ptr', 'The record uses ptr, which RFC 7208 §5.5 says not to use.');
    if ((t.kind === 'ip4' && t.prefix < 16) || (t.kind === 'ip6' && t.prefix < 32)) {
      warn('spf.wide-range', `${t.text} allows a very large network.`);
    }
  }
}

/** SPF-22: whether one mechanism matches the client. */
async function matches(
  run: Run,
  term: Term,
  current: Target,
  trace: MutableTerm,
): Promise<boolean> {
  const family: DnsType = run.ip.version === 4 ? 'A' : 'AAAA';
  const cidr = (t: { cidr4: number; cidr6: number }) => (run.ip.version === 4 ? t.cidr4 : t.cidr6);
  const ask = async (target: Target, type: DnsType, purpose: string) => {
    const a = await query(run, target, type, purpose);
    trace.queryIds.push(a.queryId);
    return a;
  };
  const targetOf = async (spec: MacroString | undefined) =>
    spec ? expandName(run, spec, current.name, trace) : current;

  switch (term.kind) {
    case 'all':
      return true;
    case 'ip4':
    case 'ip6':
      return inCidr(run.ip, term.net, term.prefix);
    case 'a': {
      countTerm(run);
      const target = await targetOf(term.spec);
      const a = await ask(target, family, `SPF a for ${target.name}`);
      stopOnFailure(a);
      if (isVoid(a)) {
        countVoid(run);
        return false;
      }
      return a.records.some((r) => contains(r, run.ip, cidr(term)));
    }
    case 'mx': {
      countTerm(run);
      const target = await targetOf(term.spec);
      const a = await ask(target, 'MX', `SPF mx for ${target.name}`);
      stopOnFailure(a);
      if (isVoid(a)) {
        countVoid(run);
        return false;
      }
      // DNS-19: "preference exchange"; a null MX (".") names no host.
      const names = a.records
        .map((r) => bareName(r.trim().split(/\s+/)[1] ?? ''))
        .filter((n) => n !== '');
      if (names.length > MAX_MX_NAMES) {
        throw permerror(
          'spf.lookup-limit',
          `mx for ${target.name} has more than 10 names (RFC 7208 §4.6.4).`,
        );
      }
      const answers = await Promise.all(
        names.map((n) => ask({ name: n, sensitive: target.sensitive }, family, `SPF mx host ${n}`)),
      );
      for (const host of answers) stopOnFailure(host);
      return answers.some((host) => host.records.some((r) => contains(r, run.ip, cidr(term))));
    }
    case 'exists': {
      countTerm(run);
      const target = await targetOf(term.spec);
      const a = await ask(target, 'A', `SPF exists for ${target.name}`);
      stopOnFailure(a);
      if (isVoid(a)) {
        countVoid(run);
        return false;
      }
      return true;
    }
    case 'ptr': {
      countTerm(run);
      const target = await targetOf(term.spec);
      const ptr = await validatedNames(run);
      trace.queryIds.push(...ptr.queryIds);
      if (ptr.void) countVoid(run);
      const domain = bareName(target.name).toLowerCase();
      return ptr.names.some((n) => n === domain || n.endsWith(`.${domain}`));
    }
    case 'include': {
      countTerm(run);
      const target = await targetOf(term.spec);
      const child: MutableNode = { domain: target.name, result: 'none', terms: [] };
      trace.child = child;
      // SPF-11: temperror and permerror end evaluation inside checkHost.
      const result = await checkHost(run, target, child, true);
      if (result === 'none') {
        throw permerror('spf.syntax', `The include target ${target.name} has no SPF record.`);
      }
      return result === 'pass';
    }
    default:
      return false;
  }
}

/**
 * SPF-22, SPF-25: the client's PTR names (first 10) whose A/AAAA contains the
 * client. Looked up once per identity; `ptr` and `%{p}` share the answer.
 */
function validatedNames(run: Run): Promise<PtrNames> {
  run.ptr ??= lookUpValidatedNames(run);
  return run.ptr;
}

async function lookUpValidatedNames(run: Run): Promise<PtrNames> {
  const queryIds: string[] = [];
  const reverse =
    run.ip.version === 4
      ? `${[...run.ip.bytes].reverse().join('.')}.in-addr.arpa`
      : `${nibbles(run.ip.bytes).split('.').reverse().join('.')}.ip6.arpa`;
  const a = await query(
    run,
    { name: reverse, sensitive: true },
    'PTR',
    'SPF ptr: names of the client',
  );
  queryIds.push(a.queryId);
  // SPF-23: a DNS error on the PTR lookup is no match (RFC 7208 §5.5).
  if (a.rcode === 'SERVFAIL' || a.rcode === 'TIMEOUT') return { names: [], queryIds, void: false };
  stopOnFailure(a);
  if (isVoid(a)) return { names: [], queryIds, void: true };
  const family: DnsType = run.ip.version === 4 ? 'A' : 'AAAA';
  const candidates = a.records.slice(0, MAX_PTR_NAMES).map((r) => bareName(r).toLowerCase());
  const checked = await Promise.all(
    candidates.map(async (name) => {
      const answer = await query(
        run,
        { name, sensitive: true },
        family,
        `SPF ptr: address of ${name}`,
      );
      queryIds.push(answer.queryId);
      // An error on a name's address lookup skips that name.
      if (answer.rcode === 'SERVFAIL' || answer.rcode === 'TIMEOUT') return null;
      stopOnFailure(answer);
      return answer.records.some((r) => contains(r, run.ip, run.ip.version === 4 ? 32 : 128))
        ? name
        : null;
    }),
  );
  return { names: checked.filter((n): n is string => n !== null), queryIds, void: false };
}

/** Whether an A/AAAA record (DNS-19) puts the client inside its network. */
function contains(record: string, ip: Ip, prefix: number): boolean {
  const net = parseIp(record.trim());
  return net !== null && inCidr(ip, net, prefix);
}

const bareName = (name: string) => (name.endsWith('.') ? name.slice(0, -1) : name);

/** `trace` collects the queries made by `%{p}`; null outside a term (explanations). */
function macroEnv(run: Run, domain: string, trace: MutableTerm | null): MacroEnv {
  return {
    sender: run.sender,
    local: run.local,
    senderDomain: run.senderDomain,
    domain,
    ip: run.ip,
    helo: run.helo,
    receiver: run.ctx.receiver,
    time: Math.floor(run.ctx.referenceTime.getTime() / 1000),
    // SPF-26: counts as a DNS-querying term (SPF-15).
    validatedName: async () => {
      countTerm(run);
      const { names, queryIds } = await validatedNames(run);
      trace?.queryIds.push(...queryIds);
      const d = domain.toLowerCase();
      return names.find((n) => n === d || n.endsWith(`.${d}`)) ?? names[0] ?? 'unknown';
    },
  };
}

/** SPF-24: a macro-expanded name, truncated to 253 octets; not a domain name is permerror. */
async function expandName(
  run: Run,
  spec: MacroString,
  domain: string,
  trace: MutableTerm | null,
): Promise<Target> {
  const { text, sensitive } = await expandMacro(spec, macroEnv(run, domain, trace));
  let name = bareName(text);
  while (name.length > 253 && name.includes('.')) name = name.slice(name.indexOf('.') + 1);
  if (!isSpfDomain(name)) {
    throw permerror('spf.syntax', `The expanded name "${name}" is not a domain name.`);
  }
  return { name, sensitive };
}

/** SPF-14: the expanded explanation; any problem just leaves it out. */
async function explain(run: Run, spec: MacroString, domain: string): Promise<void> {
  try {
    const target = await expandName(run, spec, domain, null);
    const answer = await query(run, target, 'TXT', `SPF explanation at ${target.name}`);
    const [text] = answer.records;
    if (answer.rcode !== 'NOERROR' || answer.records.length !== 1 || text === undefined) return;
    const m = parseMacroString(text, { exp: true });
    if (!m) return;
    run.explanation = (await expandMacro(m, macroEnv(run, domain, null))).text;
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
  }
}

/** Opt-in host names for source IPs (RDNS-1..9, PRG-11..13; design: reverse.md). */
import {
  type ComposedResolver,
  composeResolver,
  type DnsAnswer,
  type DnsCache,
  type DnsLogEntry,
  parseIp,
  type Rcode,
  reverseName,
  type Transport,
} from '@benchside/dns';

export type HostState =
  | { readonly state: 'queued' }
  | { readonly state: 'looking-up' }
  | { readonly state: 'removed' }
  | { readonly state: 'confirmed'; readonly names: readonly string[] }
  | { readonly state: 'unconfirmed'; readonly names: readonly string[] }
  | { readonly state: 'none' }
  | { readonly state: 'error'; readonly rcode: Rcode };

export interface BudgetFinding {
  readonly id: 'dns.budget-exhausted';
  readonly severity: 'warning';
  readonly message: string;
}

/** The `names` message (report.md, Names; PRG-11..13). */
export interface Names {
  readonly type: 'names';
  readonly generation: number;
  readonly session: number;
  /** By source IP, only what changed since the previous message. */
  readonly changes: Readonly<Record<string, HostState>>;
  readonly counts: {
    readonly queued: number;
    readonly lookingUp: number;
    readonly done: number;
    readonly targets: number;
  };
  /** New query log entries only (DNS-15). */
  readonly log: readonly DnsLogEntry[];
  readonly findings: readonly BudgetFinding[];
}

/** RDNS-6: queries per session. */
export const LOOKUP_BUDGET = 2000;
/** RDNS-4 */
const MAX_CONFIRM = 3;

const isFinal = (s: HostState | undefined) =>
  s !== undefined &&
  (s.state === 'confirmed' ||
    s.state === 'unconfirmed' ||
    s.state === 'none' ||
    s.state === 'error');
/** RDNS-9: these are not queried again; `error` is. */
const isSettled = (s: HostState | undefined) =>
  s !== undefined && (s.state === 'confirmed' || s.state === 'unconfirmed' || s.state === 'none');
const trimDot = (name: string) => name.replace(/\.$/, '');

/** One session: from turning lookups on until off or Clear (RDNS-2). */
export class LookupSession {
  private readonly o: {
    readonly number: number;
    readonly generation: number;
    readonly finals: Map<string, HostState>;
    readonly send: (n: Names) => void;
    readonly concurrency: number;
    readonly flushMs: number;
    readonly budget: number;
  };
  private readonly resolver: ComposedResolver;
  private readonly controller = new AbortController();
  /** This session's states, by source IP. */
  private readonly states = new Map<string, HostState>();
  private targets: string[] = [];
  private queue: string[] = [];
  private active = 0;
  private stopped = false;
  private pending = new Map<string, HostState>();
  private findings: BudgetFinding[] = [];
  private budgetSent = false;
  private sentLog = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiters: (() => void)[] = [];

  constructor(o: {
    readonly number: number;
    readonly generation: number;
    readonly transport: Transport;
    /** `cloudflare` or `google`: part of the cache key (DNS-14). */
    readonly source: string;
    readonly cache: DnsCache;
    /** Final states across sessions of the generation (RDNS-9). */
    readonly finals: Map<string, HostState>;
    readonly send: (n: Names) => void;
    readonly budget?: number;
    readonly concurrency?: number;
    /** Time between `names` messages (PRG-12); 0 sends each change at once. */
    readonly flushMs?: number;
  }) {
    this.o = {
      number: o.number,
      generation: o.generation,
      finals: o.finals,
      send: o.send,
      concurrency: o.concurrency ?? 4,
      flushMs: o.flushMs ?? 250,
      budget: o.budget ?? LOOKUP_BUDGET,
    };
    // RDNS-6: the queries are sensitive, and turning lookups on is the permission to send them.
    this.resolver = composeResolver({
      transport: o.transport,
      source: o.source,
      cache: o.cache,
      budget: this.o.budget,
      allowSensitive: true,
    });
    // PRG-12: the first message carries the counts even before there are targets.
    this.flush();
  }

  /** Settles when the queue is empty and no lookup runs. */
  get idle(): Promise<void> {
    if (this.active === 0 && (this.queue.length === 0 || this.stopped)) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  /** RDNS-2: the first rows of the table as shown, in order; RDNS-1: valid IPs only. */
  setTargets(ips: readonly string[]): void {
    if (this.stopped) return;
    this.targets = ips.filter((ip) => parseIp(ip) !== null);
    const wanted = new Set(this.targets);
    for (const ip of this.queue) {
      if (wanted.has(ip)) continue;
      this.states.delete(ip);
      this.change(ip, { state: 'removed' });
    }
    for (const ip of this.targets) {
      if (this.states.has(ip) || isSettled(this.o.finals.get(ip))) continue;
      this.states.set(ip, { state: 'queued' });
      this.change(ip, { state: 'queued' });
    }
    this.queue = this.targets.filter((ip) => this.states.get(ip)?.state === 'queued');
    this.pump();
    this.settle();
  }

  /** RDNS-9: queries not yet sent are not sent; nothing more goes out. */
  stop(): void {
    this.stopped = true;
    this.queue = [];
    this.controller.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.settle();
  }

  private pump(): void {
    while (!this.stopped && this.active < this.o.concurrency && this.queue.length > 0) {
      const ip = this.queue.shift() as string;
      this.active++;
      void this.lookup(ip)
        // RDNS-5: a resolver that throws (a broken transport) ends as an error, tried again later.
        .catch(() => {
          if (!this.stopped) this.settleHost(ip, { state: 'error', rcode: 'SERVFAIL' });
        })
        .finally(() => {
          this.active--;
          this.pump();
          this.settle();
        });
    }
  }

  private async lookup(ip: string): Promise<void> {
    const parsed = parseIp(ip);
    if (!parsed) return;
    this.states.set(ip, { state: 'looking-up' });
    this.change(ip, { state: 'looking-up' });
    const signal = this.controller.signal;
    const ask = (name: string, type: 'PTR' | 'A' | 'AAAA', purpose: string): Promise<DnsAnswer> =>
      this.resolver.resolve({ name, type, sensitivity: 'sensitive', purpose }, signal);
    // RDNS-3
    const ptr = await ask(reverseName(parsed), 'PTR', `Host name of ${ip}`);
    if (this.stopped) return;
    let final: HostState;
    if (ptr.rcode === 'NXDOMAIN' || (ptr.rcode === 'NOERROR' && ptr.records.length === 0)) {
      final = { state: 'none' };
    } else if (ptr.rcode !== 'NOERROR') {
      final = { state: 'error', rcode: ptr.rcode };
      if (ptr.rcode === 'BUDGET') this.budgetExhausted();
    } else {
      // RDNS-4: forward confirmation, compared after normalization (FMT-12).
      const confirmed: string[] = [];
      let failed: Rcode | null = null;
      for (const name of ptr.records.slice(0, MAX_CONFIRM)) {
        const fwd = await ask(
          name,
          parsed.version === 4 ? 'A' : 'AAAA',
          `Does ${trimDot(name)} point back to ${ip}?`,
        );
        if (this.stopped) return;
        if (fwd.rcode === 'BUDGET') this.budgetExhausted();
        if (fwd.rcode === 'SERVFAIL' || fwd.rcode === 'TIMEOUT' || fwd.rcode === 'BUDGET')
          failed = fwd.rcode;
        if (fwd.records.some((r) => parseIp(r)?.text === parsed.text))
          confirmed.push(trimDot(name));
      }
      // RDNS-5: with no name confirmed, a failed forward query means "try again", not "unconfirmed".
      final =
        confirmed.length > 0
          ? { state: 'confirmed', names: confirmed }
          : failed
            ? { state: 'error', rcode: failed }
            : { state: 'unconfirmed', names: ptr.records.map(trimDot) };
    }
    this.settleHost(ip, final);
  }

  private settleHost(ip: string, final: HostState): void {
    this.states.set(ip, final);
    this.o.finals.set(ip, final);
    this.change(ip, final);
  }

  private budgetExhausted(): void {
    if (this.budgetSent) return;
    this.budgetSent = true;
    this.findings.push({
      id: 'dns.budget-exhausted',
      severity: 'warning',
      message: `This lookup session used its ${this.o.budget} queries. Turn lookups off and on to start a new session.`,
    });
  }

  private change(ip: string, s: HostState): void {
    this.pending.set(ip, s);
    if (this.o.flushMs === 0) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.o.flushMs);
  }

  /** When the queue empties: one last message, then waiters go (PRG-12). */
  private settle(): void {
    if (this.active > 0 || (this.queue.length > 0 && !this.stopped)) return;
    if (!this.stopped) this.flush();
    for (const w of this.waiters.splice(0)) w();
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    let queued = 0;
    let lookingUp = 0;
    for (const s of this.states.values()) {
      if (s.state === 'queued') queued++;
      else if (s.state === 'looking-up') lookingUp++;
    }
    const log = this.resolver.log;
    this.o.send({
      type: 'names',
      generation: this.o.generation,
      session: this.o.number,
      changes: Object.fromEntries(this.pending),
      counts: {
        queued,
        lookingUp,
        done: this.targets.filter((ip) => isFinal(this.o.finals.get(ip))).length,
        targets: this.targets.length,
      },
      log: log.slice(this.sentLog),
      findings: this.findings,
    });
    this.sentLog = log.length;
    this.pending = new Map();
    this.findings = [];
  }
}

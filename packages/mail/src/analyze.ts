import { type AuthResult, listReceiverResults } from './authres/list.ts';
import { type DkimSignatureResult, verifyDkim } from './dkim/verify.ts';
import type { DnsCache } from './dns/cache.ts';
import { composeResolver, dnsFindings } from './dns/compose.ts';
import type { DnsLogEntry, Transport } from './dns/types.ts';
import { chooseBoundary } from './envelope/boundary.ts';
import { type ParsedReceived, readReceived } from './envelope/received.ts';
import { type ReferenceTimeMode, referenceTime } from './envelope/reference-time.ts';
import { splitHeaders } from './message/headers.ts';
import { normalizeLineEndings } from './message/line-endings.ts';
import { type SummaryLine, summarizeDkim } from './report/summary.ts';
import type { Finding } from './shared/findings.ts';

export interface AnalyzeOptions {
  /** Header field index of a user-chosen trust boundary (ENV-10). */
  readonly boundary?: number;
  /** TIME-1; default `received`. */
  readonly time?: ReferenceTimeMode;
  /** DNS-10; default false. */
  readonly allowSensitive?: boolean;
}

/** What `analyze` needs from its caller (detailed design §4). */
export interface AnalyzeDeps {
  readonly transport: Transport;
  /** `cloudflare`, `google`, or `offline` (DNS-14 cache key). */
  readonly source: string;
  /** Kept by the caller across analyses (DNS-14). */
  readonly cache: DnsCache;
  /** The caller's cancel: aborting it rejects `analyze` with the abort reason. */
  readonly signal: AbortSignal;
  /** Tests only. */
  readonly now?: Date;
  /** Tests only; default 60 s (REP-8). */
  readonly deadlineMs?: number;
}

/**
 * The part of the Report built so far (docs/reference/mail/report.md).
 * Grows into the full Report as the checks arrive.
 */
export interface PartialReport {
  readonly headers: readonly { readonly index: number; readonly name: string }[];
  readonly hasBody: boolean;
  readonly received: readonly ParsedReceived[];
  /** Header field index of the trust-boundary `Received` field, or null without one. */
  readonly boundary: number | null;
  /** ISO 8601 (TIME-1..3). */
  readonly referenceTime: string;
  /** One line per method evaluated so far (SUM-1..5). */
  readonly summary: readonly SummaryLine[];
  readonly receiver: {
    readonly results: readonly AuthResult[];
    /** Empty until our own checks exist (AR-11). */
    readonly comparisons: readonly never[];
  };
  /** One per DKIM-Signature field; each carries its own findings (DKIM-1). */
  readonly dkim: readonly DkimSignatureResult[];
  readonly dnsLog: readonly DnsLogEntry[];
  /** Findings that belong to no single DKIM signature. */
  readonly findings: readonly Finding[];
}

const MAX_INPUT_BYTES = 50 * 1024 * 1024; // IN-3
const DNS_BUDGET = 200; // DNS-13
const DEADLINE_MS = 60_000; // REP-8

export async function analyze(
  input: Uint8Array,
  options: AnalyzeOptions,
  deps: AnalyzeDeps,
): Promise<PartialReport> {
  const now = deps.now ?? new Date();
  if (input.length > MAX_INPUT_BYTES) return tooLarge(input.length, now);
  // IN-7: every check reads the normalized bytes.
  const normalized = normalizeLineEndings(input);
  const block = splitHeaders(normalized.bytes);
  const received = readReceived(block.headers);
  const boundary = chooseBoundary(received.received, options.boundary);
  const receiver = listReceiverResults(block.headers, received.received, boundary.boundary);
  const reference = referenceTime({
    mode: options.time ?? 'received',
    boundary: boundary.boundary,
    headers: block.headers,
    now,
  });

  const deadline = AbortSignal.timeout(deps.deadlineMs ?? DEADLINE_MS);
  const signal = AbortSignal.any([deps.signal, deadline]);
  const resolver = composeResolver({
    transport: deps.transport,
    source: deps.source,
    cache: deps.cache,
    budget: DNS_BUDGET,
    allowSensitive: options.allowSensitive ?? false,
  });

  // Each signature is guarded inside verifyDkim (REP-7, REP-8); this catches the rest.
  let dkim: readonly DkimSignatureResult[] = [];
  const checkFindings: Finding[] = [];
  try {
    dkim = await verifyDkim({
      bytes: normalized.bytes,
      headers: block.headers,
      body: block.body,
      resolve: resolver.resolve,
      referenceTime: reference.time,
      signal,
    });
  } catch (error) {
    if (deps.signal.aborted) throw deps.signal.reason;
    checkFindings.push({
      id: 'analysis.internal-error',
      severity: 'error',
      message: `DKIM stopped because of an unexpected error: ${String(error)}`,
      evidence: [{ kind: 'bytes', range: { start: 0, end: input.length } }],
    });
  }

  const log = resolver.log;
  return {
    headers: block.headers.map(({ index, name }) => ({ index, name })),
    hasBody: block.body !== null,
    received: received.received,
    boundary: boundary.boundary?.field ?? null,
    referenceTime: reference.time.toISOString(),
    summary: [summarizeDkim(dkim, checkFindings.length > 0 ? 'internal-error' : undefined)],
    receiver: { results: receiver.results, comparisons: [] },
    dkim,
    dnsLog: log,
    findings: [
      ...normalized.findings,
      ...block.findings,
      ...received.findings,
      ...boundary.findings,
      ...reference.findings,
      ...receiver.findings,
      ...checkFindings,
      ...dnsFindings(log),
      ...answerFindings(log, dkim, deps.source),
    ],
  };
}

/** dns.answers-are-current and dns.unauthenticated (DNS spec, findings). */
function answerFindings(
  log: readonly DnsLogEntry[],
  dkim: readonly DkimSignatureResult[],
  source: string,
): Finding[] {
  const answered = log.filter((e) => e.rcode === 'NOERROR' || e.rcode === 'NXDOMAIN');
  const findings: Finding[] = [];
  if (source !== 'offline' && answered.length > 0) {
    findings.push({
      id: 'dns.answers-are-current',
      severity: 'info',
      message:
        'DNS answers reflect DNS now, not at delivery. Keys and policies may have changed since.',
      evidence: answered.map((e) => ({ kind: 'dns', queryId: e.queryId })),
    });
  }
  const used = new Set(dkim.map((r) => r.keyQueryId));
  const unauthenticated = answered.filter((e) => used.has(e.queryId) && !e.authenticated);
  if (unauthenticated.length > 0) {
    findings.push({
      id: 'dns.unauthenticated',
      severity: 'info',
      message: 'Some DNS answers used for results were not DNSSEC-authenticated.',
      evidence: unauthenticated.map((e) => ({ kind: 'dns', queryId: e.queryId })),
    });
  }
  return findings;
}

/** IN-3: nothing else runs, so a huge input is never copied. */
function tooLarge(byteLength: number, now: Date): PartialReport {
  return {
    headers: [],
    hasBody: false,
    received: [],
    boundary: null,
    referenceTime: now.toISOString(),
    summary: [summarizeDkim([], 'invalid-input')],
    receiver: { results: [], comparisons: [] },
    dkim: [],
    dnsLog: [],
    findings: [
      {
        id: 'input.too-large',
        severity: 'error',
        message: 'The input is over 50 MiB, so it was not analyzed.',
        evidence: [{ kind: 'bytes', range: { start: 0, end: byteLength } }],
      },
    ],
  };
}

import { type AuthResult, listReceiverResults } from './authres/list.ts';
import { chooseBoundary } from './envelope/boundary.ts';
import { type ParsedReceived, readReceived } from './envelope/received.ts';
import { splitHeaders } from './message/headers.ts';
import type { Finding } from './shared/findings.ts';

export interface AnalyzeOptions {
  /** Header field index of a user-chosen trust boundary (ENV-10). */
  readonly boundary?: number;
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
  readonly receiver: {
    readonly results: readonly AuthResult[];
    /** Empty until our own checks exist (AR-11). */
    readonly comparisons: readonly never[];
  };
  readonly findings: readonly Finding[];
}

export function analyze(input: Uint8Array, options: AnalyzeOptions = {}): PartialReport {
  const block = splitHeaders(input);
  const received = readReceived(block.headers);
  const boundary = chooseBoundary(received.received, options.boundary);
  const receiver = listReceiverResults(block.headers, received.received, boundary.boundary);
  return {
    headers: block.headers.map(({ index, name }) => ({ index, name })),
    hasBody: block.body !== null,
    received: received.received,
    boundary: boundary.boundary?.field ?? null,
    receiver: { results: receiver.results, comparisons: [] },
    findings: [...block.findings, ...received.findings, ...boundary.findings, ...receiver.findings],
  };
}

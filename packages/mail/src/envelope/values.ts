import type { HeaderField } from '../message/headers.ts';
import type { Finding } from '../shared/findings.ts';
import type { ParsedReceived } from './received.ts';

/** Where a value came from (ENV-15). */
export interface FieldSource {
  readonly field: number;
  readonly rule: string;
}

export interface EnvelopeValue {
  readonly value: string;
  readonly source: 'user' | FieldSource;
}

export interface Envelope {
  readonly clientIp?: EnvelopeValue;
  readonly helo?: EnvelopeValue;
  /** The reverse-path address; `''` is the null reverse-path `<>`. */
  readonly mailFrom?: EnvelopeValue;
}

/** ENV-11..13, ENV-15. */
export function envelopeValues(
  headers: readonly HeaderField[],
  boundary: ParsedReceived | null,
): { envelope: Envelope; findings: Finding[] } {
  const from = (field: number, rule: string) => ({ field, rule });
  const findings: Finding[] = [];
  const returnPaths = headers.filter((h) => h.lname === 'return-path');
  const [top] = returnPaths;
  if (returnPaths.length > 1) {
    findings.push({
      id: 'envelope.multiple-return-path',
      severity: 'warning',
      message: 'There is more than one Return-Path field; the topmost is used.',
      evidence: returnPaths.map((h) => ({ kind: 'header', index: h.index })),
    });
  }
  const envelope: Envelope = {
    ...(boundary?.clientIp !== undefined
      ? { clientIp: { value: boundary.clientIp, source: from(boundary.field, 'ENV-11') } }
      : {}),
    ...(boundary?.helo !== undefined
      ? { helo: { value: boundary.helo, source: from(boundary.field, 'ENV-12') } }
      : {}),
    ...(top
      ? { mailFrom: { value: reversePath(top.value), source: from(top.index, 'ENV-13') } }
      : {}),
  };
  return { envelope, findings };
}

/** ENV-13: the address inside `<…>`, or the trimmed value; `''` for `<>`. */
function reversePath(value: string): string {
  const open = value.indexOf('<');
  const close = open < 0 ? -1 : value.indexOf('>', open);
  if (close > open) return value.slice(open + 1, close).trim();
  // Drops simple comments such as "(note) addr"; nested comments are not expected here.
  return value.replace(/\([^()]*\)/g, '').trim();
}

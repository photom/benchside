import type { HeaderField } from '../message/headers.ts';
import type { Finding } from '../shared/findings.ts';
import { parseDateTime } from './date.ts';
import type { ParsedReceived } from './received.ts';

export type ReferenceTimeMode = 'received' | 'date' | 'now';

/** TIME-1, TIME-2: the time DKIM `t=`/`x=` and ARC `t=` are checked against. */
export function referenceTime(o: {
  mode: ReferenceTimeMode;
  boundary: ParsedReceived | null;
  headers: readonly HeaderField[];
  now: Date;
}): { time: Date; findings: Finding[] } {
  if (o.mode === 'now') return { time: o.now, findings: [] };
  if (o.mode === 'received') {
    if (!o.boundary) return { time: o.now, findings: [] };
    if (o.boundary.date) return { time: o.boundary.date, findings: [] };
    return { time: o.now, findings: [fallback(o.boundary.field)] };
  }
  const dateField = o.headers.find((h) => h.lname === 'date');
  const parsed = dateField ? parseDateTime(dateField.value) : null;
  if (parsed) return { time: parsed, findings: [] };
  return { time: o.now, findings: dateField ? [fallback(dateField.index)] : [] };
}

function fallback(field: number): Finding {
  return {
    id: 'envelope.time-fallback',
    severity: 'info',
    message: 'No usable date was found, so signature times are checked against the current time.',
    evidence: [{ kind: 'header', index: field }],
  };
}

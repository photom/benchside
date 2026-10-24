/**
 * ARC-1, ARC-3: groups ARC fields by instance, before any signature is parsed
 * in full (design: mail-design/arc.md, Grouping).
 */
import type { HeaderField } from '../message/headers.ts';

export interface ArcGroup {
  readonly instance: number;
  readonly aar: HeaderField[];
  readonly ams: HeaderField[];
  readonly as: HeaderField[];
}

const KINDS = {
  'arc-authentication-results': 'aar',
  'arc-message-signature': 'ams',
  'arc-seal': 'as',
} as const;

export function isArcField(h: HeaderField): boolean {
  return h.lname in KINDS;
}

/**
 * The instance of an ARC field, or null without a readable `i=` of 1 or more. An AAR has it
 * first (RFC 8617 §4.1.1); an AMS or AS may have it anywhere in its tag list.
 */
export function instanceOf(h: HeaderField): number | null {
  const parts = h.value.split(';');
  const candidates = h.lname === 'arc-authentication-results' ? parts.slice(0, 1) : parts;
  for (const part of candidates) {
    const m = /^[ \t\r\n]*i[ \t\r\n]*=[ \t\r\n]*(\d{1,9})[ \t\r\n]*$/.exec(part);
    // RFC 8617 §4.2.1: instances start at 1; i=0 is as unreadable as no i= (ARC-3).
    if (m) return Number(m[1]) >= 1 ? Number(m[1]) : null;
  }
  return null;
}

/** Groups in instance order; fields without a readable `i=` are returned apart. */
export function groupSets(fields: readonly HeaderField[]): {
  groups: ArcGroup[];
  withoutInstance: HeaderField[];
} {
  const byInstance = new Map<number, ArcGroup>();
  const withoutInstance: HeaderField[] = [];
  for (const h of fields) {
    const kind = KINDS[h.lname as keyof typeof KINDS];
    const instance = instanceOf(h);
    if (instance === null) {
      withoutInstance.push(h);
      continue;
    }
    let group = byInstance.get(instance);
    if (!group) {
      group = { instance, aar: [], ams: [], as: [] };
      byInstance.set(instance, group);
    }
    group[kind].push(h);
  }
  const groups = [...byInstance.values()].sort((a, b) => a.instance - b.instance);
  return { groups, withoutInstance };
}

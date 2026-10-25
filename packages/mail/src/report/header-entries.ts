/** The header field list with what each check reads (report spec, REP-9, REP-10). */

import { SHOULD_SIGN } from '../dkim/verify.ts';
import type { ReferenceTimeMode } from '../envelope/reference-time.ts';
import type { HeaderField } from '../message/headers.ts';
import { selectHeaders, signedHeaderNames } from '../shared/signature-core.ts';
import { parseTagList } from '../shared/tag-list.ts';

/** In REP-9 table order. */
export type FieldUse = 'delivery' | 'dkim' | 'dmarc' | 'arc' | 'receiver';
const ORDER: readonly FieldUse[] = ['delivery', 'dkim', 'dmarc', 'arc', 'receiver'];

export interface HeaderEntry {
  readonly index: number;
  readonly name: string;
  readonly usedBy: readonly FieldUse[];
  /** REP-10: present exactly when `usedBy` is not empty. */
  readonly value?: string;
}

const BY_NAME: Readonly<Record<string, FieldUse>> = {
  received: 'delivery',
  'return-path': 'delivery',
  'dkim-signature': 'dkim',
  from: 'dmarc',
  'arc-seal': 'arc',
  'arc-message-signature': 'arc',
  'arc-authentication-results': 'arc',
  'authentication-results': 'receiver',
};

/** Signatures whose `h=` selections count as read by a check. */
const SIGNATURES: Readonly<Record<string, FieldUse>> = {
  'dkim-signature': 'dkim',
  'arc-message-signature': 'arc',
};

export function headerEntries(
  headers: readonly HeaderField[],
  time: ReferenceTimeMode,
): HeaderEntry[] {
  const uses = headers.map(() => new Set<FieldUse>());
  const add = (field: HeaderField, use: FieldUse) => uses[field.index]?.add(use);
  for (const h of headers) {
    const use = BY_NAME[h.lname];
    if (use) add(h, use);
    const signer = SIGNATURES[h.lname];
    if (!signer) continue;
    // The verifiers' own selection, whether or not verification gets that far.
    const names = signedHeaderNames(parseTagList(h.value).tags.get('h'));
    for (const selected of selectHeaders(headers, names, h)) add(selected, signer);
    if (signer !== 'dkim') continue;
    // dkim.from-not-oversigned counts From fields; dkim.unsigned-header points at the rest.
    for (const other of headers) {
      const unsigned = SHOULD_SIGN.includes(other.lname) && !names.includes(other.lname);
      if (other.lname === 'from' || unsigned) add(other, 'dkim');
    }
  }
  // TIME-1: `date` mode reads the first Date field only.
  const date = time === 'date' ? headers.find((h) => h.lname === 'date') : undefined;
  if (date) add(date, 'delivery');
  return headers.map((h) => {
    const usedBy = ORDER.filter((u) => uses[h.index]?.has(u));
    return {
      index: h.index,
      name: h.name,
      usedBy,
      ...(usedBy.length > 0 ? { value: h.value } : {}),
    };
  });
}

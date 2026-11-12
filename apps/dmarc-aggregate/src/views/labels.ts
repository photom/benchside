/** Words the UI uses for spec values (ui.md, Text in the UI; classify.md; enforcement.md). */
import type { Cause, EnforcementStatus, Path } from '@benchside/dmarc-aggregate';

export const PATHS: readonly Path[] = ['direct', 'forwarded', 'other'];

export const PATH_NAME: Record<Path, string> = {
  direct: 'Direct',
  forwarded: 'Forwarded',
  other: 'Other',
};

/** CAUSE-1..9, in rule order, with the path they belong to and their label. */
export const CAUSES: readonly { cause: Cause; path: Path; label: string }[] = [
  {
    cause: 'reported-forwarding',
    path: 'forwarded',
    label: 'The receiver reports forwarding or a mailing list',
  },
  {
    cause: 'dkim-broken',
    path: 'forwarded',
    label:
      'A DKIM signature of the domain did not verify. The message was likely changed on the way',
  },
  {
    cause: 'spf-broken-by-forwarding',
    path: 'forwarded',
    label: 'Sent through a known forwarder: SPF broke, and no DKIM signature survived',
  },
  {
    cause: 'spf-not-aligned',
    path: 'direct',
    label:
      "SPF passes, but for a domain that does not align, such as a service's own envelope sender",
  },
  {
    cause: 'dkim-not-aligned',
    path: 'direct',
    label: 'DKIM passes, but only for a domain that does not align',
  },
  { cause: 'temporary-error', path: 'other', label: 'Unknown: a temporary DNS error' },
  { cause: 'permanent-error', path: 'other', label: 'Unknown: a broken SPF record or DKIM key' },
  {
    cause: 'no-dkim',
    path: 'other',
    label: 'No DKIM signature, and SPF does not pass: spoofed, or forwarded unsigned mail',
  },
  { cause: 'unauthenticated', path: 'other', label: 'Nothing authenticates: likely spoofed' },
];

export const causeLabel = (c: Cause) => CAUSES.find((x) => x.cause === c)?.label ?? c;

/** ENF-7 statuses with their label and the status color they wear with an icon (ui.md, Color). */
export const STATUS: Record<
  EnforcementStatus,
  { label: string; tone: 'good' | 'warning' | 'critical' | 'none'; icon: string }
> = {
  'no-data': {
    label: 'No messages for this domain in the selected period',
    tone: 'none',
    icon: '○',
  },
  'fix-direct': { label: 'Fix the failing direct sources first', tone: 'critical', icon: '✕' },
  'add-dkim': {
    label: 'Some mail passes through SPF alone. Sign it with DKIM before reject',
    tone: 'warning',
    icon: '!',
  },
  'check-forwarded': {
    label: 'Only forwarded and other mail fails. Check how much forwarded mail you can lose',
    tone: 'warning',
    icon: '!',
  },
  clear: {
    label: 'No failing direct or forwarded mail in the selected period',
    tone: 'good',
    icon: '✓',
  },
};

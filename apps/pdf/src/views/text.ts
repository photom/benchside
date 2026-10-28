import type { Text } from '@benchside/pdf';

/** REP-9: text from the file, or why it is not shown. */
export const shown = (t: Text | undefined | null) =>
  !t ? '' : t.text === null ? '(encrypted)' : t.truncated ? `${t.text} … (cut)` : t.text;

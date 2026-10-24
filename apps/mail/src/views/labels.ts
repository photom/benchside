/** Result words shown to users. Always text, so color is never the only cue. */
const RESULT_WORDS: Record<string, string> = {
  pass: 'Pass',
  fail: 'Fail',
  permerror: 'Permanent error',
  temperror: 'Temporary error',
  neutral: 'Neutral',
  'not-evaluated': 'Not evaluated',
  none: 'None',
};

/** "Not evaluated (offline)": never worded like a failure (REQ-MAIL-002). */
export function resultText(result: string, reason?: string): string {
  const word = RESULT_WORDS[result] ?? result;
  return reason === undefined ? word : `${word} (${reason})`;
}

/** Lowercase form for running text: "1 not evaluated". */
export function resultPhrase(result: string): string {
  return (RESULT_WORDS[result] ?? result).toLowerCase();
}

export const SEVERITY_LABEL = { error: 'Error', warning: 'Warning', info: 'Info' } as const;

import type { SummaryLine } from '@benchside/mail';
import { resultPhrase } from './labels.ts';

const METHOD_NAMES = { dkim: 'DKIM' } as const;

/** One line per method, first on the page (REQ-MAIL-002, SUM-1..5). */
export function Summary({ lines }: { lines: readonly SummaryLine[] }) {
  if (lines.length === 0) return null;
  return (
    <section aria-label="Summary">
      <h2>Summary</h2>
      <ul>
        {lines.map((line) => {
          const counts = Object.entries(line.counts).map(([r, n]) => `${n} ${resultPhrase(r)}`);
          return (
            <li key={line.method} data-result={line.result}>
              {METHOD_NAMES[line.method]}: {resultPhrase(line.result)}
              {counts.length > 0 && ` (${counts.join(', ')})`}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

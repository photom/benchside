import type { SummaryLine } from '@benchside/mail';
import { resultPhrase } from './labels.ts';

const METHOD_NAMES = { dkim: 'DKIM', arc: 'ARC' } as const;

/** One line per method, first on the page (REQ-MAIL-002, SUM-1..5). */
export function Summary({ lines }: { lines: readonly SummaryLine[] }) {
  if (lines.length === 0) return null;
  return (
    <section aria-label="Summary">
      <h2>Summary</h2>
      <ul>
        {lines.map((line) => {
          const counts = Object.entries(line.counts).map(([key, n]) => countText(key, n));
          // "not evaluated (offline; 1 set)": the reason first, then the counts.
          const detail = [line.reason, counts.join(', ')].filter(Boolean).join('; ');
          return (
            <li key={line.method} data-result={line.result}>
              {METHOD_NAMES[line.method]}: {resultPhrase(line.result)}
              {detail && ` (${detail})`}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** `sets` counts ARC instances; every other key is a result. */
function countText(key: string, n: number): string {
  if (key === 'sets') return n === 1 ? '1 set' : `${n} sets`;
  return `${n} ${resultPhrase(key)}`;
}

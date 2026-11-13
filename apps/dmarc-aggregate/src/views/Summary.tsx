import type { View } from '@benchside/dmarc-aggregate';
import type { ComponentChild } from 'preact';
import { count, day, percent } from './format.ts';

/** The headline numbers of CMB-9 (ui.md, Chart forms: stat tiles). */
export function Summary({ view, partial }: { view: View; partial: string | null }) {
  const t = view.totals;
  const tiles: [string, ComponentChild][] = [
    ['Messages', count(t.messages)],
    ['DMARC pass rate', percent(t.passRate)],
    ['Failing', count(t.failing)],
    ['Reports', count(t.reports)],
    ['Reporters', count(t.reporters)],
    [
      'Period',
      t.period ? (
        <>
          <span class="nowrap">{day(t.period.begin)}</span> to{' '}
          <span class="nowrap">{day(t.period.end)}</span>
        </>
      ) : (
        'No dated reports'
      ),
    ],
  ];
  return (
    <section>
      <h2>Summary</h2>
      {partial && <p class="partial">{partial}</p>}
      <dl class="tiles">
        {tiles.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

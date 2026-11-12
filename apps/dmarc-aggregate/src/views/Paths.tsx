import type { Focus, Totals } from '@benchside/dmarc-aggregate';
import { count, percent } from './format.ts';
import { CAUSES, PATH_NAME, PATHS } from './labels.ts';

const share = (n: number, of: number) => (of > 0 ? percent(n / of) : '—');

/** The table views of the path and cause charts; a click sets the focus (CMB-9, SRC-5). */
export function Paths({ totals, onFocus }: { totals: Totals; onFocus: (f: Focus) => void }) {
  const byCause = new Map(totals.byCause.map((c) => [c.cause, c.messages]));
  return (
    <>
      <section>
        <h2>Delivery path</h2>
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th>Messages</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {PATHS.map((p) => (
              <tr key={p} data-path={p}>
                <td>
                  <button type="button" class="link" onClick={() => onFocus({ path: p })}>
                    {PATH_NAME[p]}
                  </button>
                </td>
                <td class="num">{count(totals.byPath[p])}</td>
                <td class="num">{share(totals.byPath[p], totals.messages)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Causes of failure</h2>
        <p class="note">Estimated from report data. Click a cause to see the sources behind it.</p>
        <table>
          <thead>
            <tr>
              <th>Path</th>
              <th>Cause</th>
              <th>Failing messages</th>
            </tr>
          </thead>
          <tbody>
            {CAUSES.filter((c) => byCause.has(c.cause)).map((c) => (
              <tr key={c.cause} data-path={c.path}>
                <td>{PATH_NAME[c.path]}</td>
                <td>
                  <button type="button" class="link" onClick={() => onFocus({ cause: c.cause })}>
                    {c.label}
                  </button>
                </td>
                <td class="num">{count(byCause.get(c.cause) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

import type { Finding } from '@benchside/dmarc-aggregate';
import { usePage } from '@benchside/ui';

/** Every finding in the order found (REP-7, REP-8). */
export function Findings({ findings }: { findings: readonly Finding[] }) {
  const [shown, more] = usePage(findings.length);
  return (
    <section>
      <h2>Findings</h2>
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Finding</th>
            <th>Where</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {findings.slice(0, shown).map((f, i) => (
            <tr key={i} data-severity={f.severity}>
              <td>{f.severity}</td>
              <td>
                <code>{f.id}</code>
              </td>
              <td>
                {f.label ?? 'Batch'}
                {f.record !== undefined && `, record ${f.record + 1}`}
                {f.line !== undefined && `, line ${f.line}`}
              </td>
              <td>{f.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </section>
  );
}

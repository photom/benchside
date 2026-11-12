import type {
  FormatCount,
  PolicyConfig,
  ReporterError,
  ReporterRow,
} from '@benchside/dmarc-aggregate';
import { count, formatBadge, percent, stated } from './format.ts';

/** CMB-11 */
export function Reporters({ rows }: { rows: readonly ReporterRow[] }) {
  return (
    <section>
      <h2>Reporters</h2>
      <table>
        <thead>
          <tr>
            <th>Reporter</th>
            <th>Reports</th>
            <th>Messages</th>
            <th>DMARC pass</th>
            <th>Pass rate</th>
            <th>Days</th>
            <th>First day</th>
            <th>Last day</th>
            <th>Formats</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.reporter}>
              <td>{r.reporter}</td>
              <td class="num">{count(r.reports)}</td>
              <td class="num">{count(r.messages)}</td>
              <td class="num">{count(r.passing)}</td>
              <td class="num">{percent(r.passRate)}</td>
              <td class="num">{count(r.days)}</td>
              <td>{r.firstDay ?? '—'}</td>
              <td>{r.lastDay ?? '—'}</td>
              <td>
                {r.formats.map((format) => formatBadge({ format, namespace: '' })).join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** CMB-12 */
export function Formats({ rows }: { rows: readonly FormatCount[] }) {
  return (
    <section>
      <h2>Formats</h2>
      <table>
        <thead>
          <tr>
            <th>Format</th>
            <th>Namespace</th>
            <th>Reports</th>
            <th>Mixed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.format} ${r.namespace}`}>
              <td>{formatBadge(r)}</td>
              <td>{r.namespace === null ? 'none' : <code>{r.namespace}</code>}</td>
              <td class="num">{count(r.reports)}</td>
              <td class="num">{count(r.mixed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** CMB-13 */
export function ReporterErrors({ rows }: { rows: readonly ReporterError[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2>Reporter errors</h2>
      <table>
        <thead>
          <tr>
            <th>Reporter</th>
            <th>Policy domain</th>
            <th>Day</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.reporter}</td>
              <td>{r.policyDomain}</td>
              <td>{r.day ?? 'Undated'}</td>
              <td>{r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** CMB-8: not filtered; it comes with the batch changes (REP-11). */
export function Policies({ rows }: { rows: readonly PolicyConfig[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2>Published policies</h2>
      <table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>p</th>
            <th>sp</th>
            <th>np</th>
            <th>adkim</th>
            <th>aspf</th>
            <th>pct</th>
            <th>fo</th>
            <th>testing</th>
            <th>Reporters</th>
            <th>First day</th>
            <th>Last day</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.domain}</td>
              <td>{stated(r.p)}</td>
              <td>{stated(r.sp)}</td>
              <td>{stated(r.np)}</td>
              <td>{stated(r.adkim)}</td>
              <td>{stated(r.aspf)}</td>
              <td>{stated(r.pct)}</td>
              <td>{stated(r.fo)}</td>
              <td>{stated(r.testing)}</td>
              <td>{r.reporters.join(', ')}</td>
              <td>{r.firstDay ?? '—'}</td>
              <td>{r.lastDay ?? '—'}</td>
              <td>{r.inEffect ? 'In effect' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

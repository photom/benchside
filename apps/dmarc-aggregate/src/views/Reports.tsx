import type { ReportSummary } from '@benchside/dmarc-aggregate';
import { TableScroll, usePage } from '@benchside/ui';
import { count, formatBadge } from './format.ts';

/** One row per report read, whatever its status (REP-1..4). */
export function Reports({ reports }: { reports: readonly ReportSummary[] }) {
  const [shown, more] = usePage(reports.length);
  return (
    <section>
      <h2>Reports</h2>
      <TableScroll label="Reports">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Report</th>
              <th>Reporter</th>
              <th>Policy domain</th>
              <th>Day</th>
              <th>Format</th>
              <th>Status</th>
              <th>Records</th>
              <th>Messages</th>
            </tr>
          </thead>
          <tbody>
            {reports.slice(0, shown).map((r) => (
              <tr key={r.index}>
                <td>{r.index + 1}</td>
                <td class="long">{r.label}</td>
                <td>{r.reporter}</td>
                <td>{r.policyDomain}</td>
                <td class="nowrap">{r.day ?? 'Undated'}</td>
                <td>{formatBadge(r)}</td>
                <td>{r.status}</td>
                <td class="num">{count(r.records)}</td>
                <td class="num">{count(r.messages)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {more}
    </section>
  );
}

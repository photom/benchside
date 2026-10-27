import type { Revision } from '@benchside/pdf';
import { offset } from '@benchside/ui';

/** REP-1: newest first. */
export function Revisions({ revisions }: { revisions: readonly Revision[] }) {
  return (
    <section aria-label="Revisions">
      <h2>Revisions</h2>
      <table>
        <thead>
          <tr>
            <th>Revision</th>
            <th>Section</th>
            <th>Offset</th>
            <th>Entries</th>
            <th>Prev</th>
            <th>XRefStm</th>
          </tr>
        </thead>
        <tbody>
          {revisions.map((r) => (
            <tr key={r.offset}>
              <td>{r.index}</td>
              <td>{r.kind}</td>
              <td>{offset(r.offset)}</td>
              <td>{r.entryCount}</td>
              <td>{r.trailer.prev === null ? '' : offset(r.trailer.prev)}</td>
              <td>{r.xrefStm === null ? '' : offset(r.xrefStm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

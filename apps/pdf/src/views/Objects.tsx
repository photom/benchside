import type { PdfObject } from '@benchside/pdf';
import { offset, usePage } from '@benchside/ui';

const STATUS = { 'in-use': 'in use', compressed: 'compressed', free: 'free' } as const;

const where = (o: PdfObject) =>
  o.status === 'compressed'
    ? `object stream ${o.container}, index ${o.index}`
    : o.offset === undefined
      ? ''
      : offset(o.offset);

const type = (o: PdfObject) =>
  [o.type, o.subtype].filter(Boolean).join(' / ') +
  (o.stream
    ? ` (stream, ${o.stream.byteLength} bytes${o.stream.filters.length ? `, ${o.stream.filters.join(', ')}` : ''})`
    : '');

export function Objects({ objects }: { objects: readonly PdfObject[] }) {
  const [shown, more] = usePage(objects.length);
  return (
    <section aria-label="Objects">
      <h2>Objects</h2>
      <table>
        <thead>
          <tr>
            <th>Number</th>
            <th>Generation</th>
            <th>Status</th>
            <th>Revision</th>
            <th>Where</th>
            <th>Type</th>
            <th>Replaced</th>
          </tr>
        </thead>
        <tbody>
          {objects.slice(0, shown).map((o) => (
            <tr key={o.number}>
              <td>{o.number}</td>
              <td>{o.generation}</td>
              <td>{STATUS[o.status]}</td>
              <td>{o.revision}</td>
              <td>{where(o)}</td>
              <td>{type(o)}</td>
              <td>{o.replaced.length > 0 ? `replaced revision ${o.replaced.join(', ')}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </section>
  );
}

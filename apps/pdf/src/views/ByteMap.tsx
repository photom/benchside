import type { Region, RegionKind } from '@benchside/pdf';
import { offset, usePage } from '@benchside/ui';

const KIND_NAMES: Record<RegionKind, string> = {
  header: 'Header',
  object: 'Object',
  'xref-stream': 'Cross-reference stream',
  'xref-table': 'Cross-reference table',
  trailer: 'Trailer',
  startxref: 'startxref',
  prepended: 'Prepended data',
  trailing: 'Trailing data',
  gap: 'Gap',
  unknown: 'Unknown',
};

export function ByteMap({ regions }: { regions: readonly Region[] }) {
  const [shown, more] = usePage(regions.length);
  return (
    <section aria-label="Byte map">
      <h2>Byte map</h2>
      <table>
        <thead>
          <tr>
            <th>Offset</th>
            <th>Length</th>
            <th>Kind</th>
            <th>Object</th>
          </tr>
        </thead>
        <tbody>
          {regions.slice(0, shown).map((r) => (
            <tr key={`${r.offset}-${r.kind}-${r.object}`} data-kind={r.kind}>
              <td>{offset(r.offset)}</td>
              <td>{r.byteLength}</td>
              <td>{KIND_NAMES[r.kind]}</td>
              <td>{r.object ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </section>
  );
}

import type { Region, RegionKind } from '@benchside/zip';
import { offset } from './format.ts';
import { usePage } from './Paged.tsx';

const KIND_NAMES: Record<RegionKind, string> = {
  'local-header': 'Local header',
  'file-data': 'File data',
  'data-descriptor': 'Data descriptor',
  'central-header': 'Central header',
  'digital-signature': 'Digital signature',
  'zip64-eocd': 'ZIP64 end of central directory',
  'zip64-locator': 'ZIP64 locator',
  eocd: 'End of central directory',
  prepended: 'Prepended data',
  gap: 'Gap',
  trailing: 'Trailing data',
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
            <th>Entry</th>
          </tr>
        </thead>
        <tbody>
          {regions.slice(0, shown).map((r) => (
            <tr key={`${r.offset}-${r.kind}-${r.entry}`} data-kind={r.kind}>
              <td>{offset(r.offset)}</td>
              <td>{r.byteLength}</td>
              <td>{KIND_NAMES[r.kind]}</td>
              <td>{r.entry ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </section>
  );
}

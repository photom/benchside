import type { Region } from '@benchside/zip';
import { offset } from './format.ts';
import { REGION_NAMES } from './labels.ts';
import { usePage } from './Paged.tsx';

export function ByteMap({
  regions,
  onBytes,
}: {
  regions: readonly Region[];
  /** HEX-1 */
  onBytes: (region: Region) => void;
}) {
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
            <th>Bytes</th>
          </tr>
        </thead>
        <tbody>
          {regions.slice(0, shown).map((r) => (
            <tr key={`${r.offset}-${r.kind}-${r.entry}`} data-kind={r.kind}>
              <td>{offset(r.offset)}</td>
              <td>{r.byteLength}</td>
              <td>{REGION_NAMES[r.kind]}</td>
              <td>{r.entry ?? ''}</td>
              <td>
                <button type="button" onClick={() => onBytes(r)}>
                  Show bytes
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </section>
  );
}

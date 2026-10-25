import type { Entry } from '@benchside/zip';
import { crc, offset } from './format.ts';
import { usePage } from './Paged.tsx';

export function notes(e: Entry): string {
  return [
    e.kind === 'directory' && 'directory',
    e.archiveHint && 'archive?',
    e.zip64 && 'ZIP64',
    e.mismatches.length > 0 && 'differs',
  ]
    .filter(Boolean)
    .join(', ');
}

export function Entries({
  entries,
  selected,
  onSelect,
}: {
  entries: readonly Entry[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const [shown, more] = usePage(entries.length);
  return (
    <section aria-label="Entries">
      <h2>Entries</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Method</th>
            <th>Compressed</th>
            <th>Uncompressed</th>
            <th>CRC-32</th>
            <th>Modified</th>
            <th>Local header</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, shown).map((e) => (
            <tr key={e.index} data-selected={e.index === selected}>
              <td>{e.index}</td>
              <td>
                <button type="button" class="link" onClick={() => onSelect(e.index)}>
                  {e.name.text}
                </button>
              </td>
              <td>{e.central.method.name}</td>
              <td>{e.compressedSize}</td>
              <td>{e.uncompressedSize}</td>
              <td>
                <code>{crc(e.crc32)}</code>
              </td>
              <td>{e.central.modified.text ?? 'invalid'}</td>
              <td>{offset(e.localHeaderOffset)}</td>
              <td>{notes(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </section>
  );
}

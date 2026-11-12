import type { FileRow } from '../state.ts';

/** Files skipped, stopped, or failed (ui.md, Progress: done note). */
export function FilesNotRead({ files }: { files: readonly FileRow[] }) {
  const list = files.filter(
    (f) => f.status === 'skipped' || f.status === 'stopped' || f.status === 'failed',
  );
  if (list.length === 0) return null;
  return (
    <section>
      <h2>Files not read</h2>
      <ul>
        {list.map((f) => (
          <li key={f.index}>
            {f.name}: {f.status}
          </li>
        ))}
      </ul>
    </section>
  );
}

import type { Page } from '@benchside/pdf';
import { usePage } from '@benchside/ui';

const size = (r: readonly number[] | null) =>
  r ? `${Math.abs((r[2] ?? 0) - (r[0] ?? 0))} × ${Math.abs((r[3] ?? 0) - (r[1] ?? 0))}` : '';

const annotations = (p: Page) => {
  if (p.annotations.length === 0) return '0';
  const kinds = [...new Set(p.annotations.map((a) => a.subtype ?? '?'))].join(', ');
  return `${p.annotations.length}: ${kinds}`;
};

/** REQ-PDF-004: pages in page tree order. */
export function Pages({ pages, count }: { pages: readonly Page[]; count: number | null }) {
  const [shownRows, more] = usePage(pages.length);
  return (
    <section aria-label="Pages">
      <h2>Pages</h2>
      <p>
        {pages.length} found{count === null ? '' : `; the page tree says ${count}`}.
      </p>
      <table>
        <thead>
          <tr>
            <th>Page</th>
            <th>Object</th>
            <th>Media box size</th>
            <th>Crop box size</th>
            <th>Rotate</th>
            <th>Annotations</th>
          </tr>
        </thead>
        <tbody>
          {pages.slice(0, shownRows).map((p) => (
            <tr key={p.index}>
              <td>{p.index + 1}</td>
              <td>{p.object ?? 'direct'}</td>
              <td>{p.mediaBox ? size(p.mediaBox) : 'missing'}</td>
              <td>{size(p.cropBox)}</td>
              <td>{p.rotate}</td>
              <td>{annotations(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more}
    </section>
  );
}

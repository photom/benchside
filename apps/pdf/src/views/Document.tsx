import type { PdfDocument } from '@benchside/pdf';
import { shown } from './text.ts';

/** REQ-PDF-004: catalog and document information. */
export function Document({ document }: { document: PdfDocument }) {
  const c = document.catalog;
  return (
    <section aria-label="Document">
      <h2>Document</h2>
      {c ? (
        <dl>
          <dt>Catalog</dt>
          <dd>{c.object === null ? 'direct' : `object ${c.object}`}</dd>
          <dt>Version</dt>
          <dd>{c.version ?? 'as in the header'}</dd>
          <dt>Page layout</dt>
          <dd>{c.pageLayout ?? 'not set'}</dd>
          <dt>Page mode</dt>
          <dd>{c.pageMode ?? 'not set'}</dd>
          <dt>Language</dt>
          <dd>{c.lang ? shown(c.lang) : 'not set'}</dd>
          <dt>Entries</dt>
          <dd>{c.keys.join(', ')}</dd>
          <dt>Outline items</dt>
          <dd>{document.outlineItems}</dd>
          <dt>Form fields</dt>
          <dd>{document.fields}</dd>
        </dl>
      ) : (
        <p>No catalog could be read.</p>
      )}
      <section aria-label="Document information">
        <h3>Document information</h3>
        {document.info ? (
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {document.info.entries.map((e) => (
                <tr key={e.key}>
                  <td>{e.key}</td>
                  <td>{shown(e.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>None.</p>
        )}
      </section>
    </section>
  );
}

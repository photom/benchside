import type { PdfReport } from '@benchside/pdf';

const ref = (r: { number: number; generation: number } | null) =>
  r ? `${r.number} ${r.generation} R` : 'none';

export function Summary({ report }: { report: PdfReport }) {
  const t = report.trailer;
  return (
    <section aria-label="Summary">
      <h2>Summary</h2>
      <dl>
        <dt>Size</dt>
        <dd>{report.byteLength} bytes</dd>
        <dt>Version</dt>
        <dd>
          {report.header ? report.header.version : 'no header'}
          {report.header?.binaryMarker && ' (binary marker)'}
        </dd>
        <dt>Revisions</dt>
        <dd>{report.revisions.length}</dd>
        <dt>Pages</dt>
        <dd>{report.document ? report.document.pages.length : 'unknown'}</dd>
        <dt>Actions</dt>
        <dd>{report.actions.length}</dd>
        <dt>Scripts</dt>
        <dd>
          {report.scripts.length} outside actions,{' '}
          {report.actions.filter((a) => a.script || a.type === 'JavaScript').length} in actions
        </dd>
        <dt>Objects</dt>
        <dd>{report.objects.length}</dd>
        {t && (
          <>
            <dt>Root</dt>
            <dd>{ref(t.root)}</dd>
            <dt>Info</dt>
            <dd>{ref(t.info)}</dd>
            {t.id && (
              <>
                <dt>ID</dt>
                <dd>
                  <code>{t.id.join(' ')}</code>
                </dd>
              </>
            )}
          </>
        )}
        <dt>Encrypted</dt>
        <dd>{report.encrypted ? 'Yes' : 'No'}</dd>
      </dl>
    </section>
  );
}

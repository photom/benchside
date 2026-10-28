import type { PdfReport } from '@benchside/pdf';
import { DropZone } from '@benchside/ui';
import { useState } from 'preact/hooks';
import { Actions } from './views/Actions.tsx';
import { ByteMap } from './views/ByteMap.tsx';
import { Document } from './views/Document.tsx';
import { Findings } from './views/Findings.tsx';
import { Objects } from './views/Objects.tsx';
import { Pages } from './views/Pages.tsx';
import { References } from './views/References.tsx';
import { Revisions } from './views/Revisions.tsx';
import { Summary } from './views/Summary.tsx';
import type { PdfHost } from './worker/host.ts';

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: PdfReport }
  | { kind: 'failed'; message: string };

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function App({ host }: { host: PdfHost }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // A new number per file resets paging in the tables.
  const [run, setRun] = useState(0);

  async function analyze(file: File) {
    setStatus({ kind: 'running' });
    setRun((n) => n + 1);
    try {
      // The host rejects a superseded request with AbortError, so this is the latest file.
      setStatus({ kind: 'done', report: await host.analyze(file) });
    } catch (error) {
      if (!isAbort(error)) setStatus({ kind: 'failed', message: String(error) });
    }
  }

  return (
    <main>
      <h1>PDF analyzer</h1>
      <DropZone
        label="Drop a PDF here, or choose one:"
        accept=".pdf,application/pdf"
        onFile={(file) => void analyze(file)}
      />
      {status.kind === 'running' && <p role="status">Analyzing…</p>}
      {status.kind === 'failed' && <p role="alert">Analysis failed: {status.message}</p>}
      {status.kind === 'done' && (
        <>
          <Summary report={status.report} />
          <Findings findings={status.report.findings} />
          <Actions key={`a${run}`} actions={status.report.actions} />
          {status.report.document && (
            <>
              <Document document={status.report.document} />
              <Pages
                key={`p${run}`}
                pages={status.report.document.pages}
                count={status.report.document.pageCount}
              />
            </>
          )}
          <Revisions revisions={status.report.revisions} />
          <Objects key={`o${run}`} objects={status.report.objects} />
          <ByteMap key={`m${run}`} regions={status.report.regions} />
        </>
      )}
      <References />
    </main>
  );
}

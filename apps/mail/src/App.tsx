import type { AuthResult, Finding, PartialReport } from '@benchside/mail';
import { useState } from 'preact/hooks';
import { ArcDetail } from './views/ArcDetail.tsx';
import { DeliveryDetails } from './views/DeliveryDetails.tsx';
import { DkimDetail } from './views/DkimDetail.tsx';
import { DnsLog } from './views/DnsLog.tsx';
import { FindingList } from './views/Findings.tsx';
import { entryText } from './views/labels.ts';
import { SpfDetail } from './views/SpfDetail.tsx';
import { Summary } from './views/Summary.tsx';
import type { WorkerHost } from './worker/host.ts';

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: PartialReport }
  | { kind: 'failed'; message: string };

export function App({ host }: { host: WorkerHost }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [active, setActive] = useState(false);

  async function analyze(file: File) {
    setStatus({ kind: 'running' });
    try {
      const report = await host.analyze(new Uint8Array(await file.arrayBuffer()));
      setStatus({ kind: 'done', report });
    } catch (error) {
      // A newer file replaced this analysis; its own result will be shown.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus({ kind: 'failed', message: String(error) });
    }
  }

  return (
    <main>
      <h1>Mail analyzer</h1>
      <label
        class="drop"
        data-active={active}
        onDragOver={(e) => {
          e.preventDefault();
          setActive(true);
        }}
        onDragLeave={() => setActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setActive(false);
          const file = e.dataTransfer?.files[0];
          if (file) void analyze(file);
        }}
      >
        Drop an .eml file here, or choose one:{' '}
        <input
          type="file"
          accept=".eml,message/rfc822"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) void analyze(file);
          }}
        />
      </label>
      <Result status={status} />
    </main>
  );
}

function Result({ status }: { status: Status }) {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'running':
      return <p role="status">Analyzing…</p>;
    case 'failed':
      return <p role="alert">Analysis failed: {status.message}</p>;
    case 'done':
      return (
        <>
          <Summary lines={status.report.summary} />
          <DeliveryDetails envelope={status.report.envelope} />
          <ReceiverResults
            results={status.report.receiver.results}
            findings={status.report.findings}
          />
          <SpfDetail spf={status.report.spf} />
          <DkimDetail results={status.report.dkim} />
          <ArcDetail arc={status.report.arc} />
          <Notes report={status.report} />
          <HeaderFields report={status.report} />
          <DnsLog entries={status.report.dnsLog} />
        </>
      );
  }
}

function ReceiverResults({
  results,
  findings,
}: {
  results: readonly AuthResult[];
  findings: readonly Finding[];
}) {
  // Findings about one field (authres.untrusted, authres.syntax) are shown with it.
  const about = (field: number) =>
    findings.filter((f) => f.evidence.some((e) => e.kind === 'header' && e.index === field));
  return (
    <section aria-label="Receiver results">
      <h2>Receiver results</h2>
      {results.length === 0 && <p>No Authentication-Results field.</p>}
      {results.map((r) => (
        <article key={r.field} class="authres" data-trusted={r.trusted}>
          <h3>
            {r.authservId || '(no authserv-id)'}{' '}
            <span class="trust">{r.trusted ? 'Trusted' : 'Untrusted'}</span>
          </h3>
          <p>
            Header field <a href={`#field-${r.field + 1}`}>{r.field + 1}</a>
          </p>
          <FindingList findings={about(r.field)} />
          <ul>
            {r.entries.map((e, i) => (
              <li key={i}>{entryText(e)}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

/** Findings not shown with a receiver result (those carry its field as evidence). */
function Notes({ report }: { report: PartialReport }) {
  const resultFields = new Set(report.receiver.results.map((r) => r.field));
  const notes = report.findings.filter(
    (f) => !f.evidence.some((e) => e.kind === 'header' && resultFields.has(e.index)),
  );
  if (notes.length === 0) return null;
  return (
    <section aria-label="Notes">
      <h2>Notes</h2>
      <FindingList findings={notes} />
    </section>
  );
}

function HeaderFields({ report }: { report: PartialReport }) {
  return (
    <section aria-label="Header fields">
      <h2>{report.headers.length} header fields</h2>
      <ol>
        {report.headers.map((h) => (
          <li key={h.index} id={`field-${h.index + 1}`}>
            {h.name || '(malformed line)'}
          </li>
        ))}
      </ol>
      <p>{report.hasBody ? 'Body present.' : 'Headers only.'}</p>
    </section>
  );
}

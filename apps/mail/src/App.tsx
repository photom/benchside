import type { AuthResult, DmarcMode, FieldUse, Finding, PartialReport } from '@benchside/mail';
import { DropZone } from '@benchside/ui';
import { useRef, useState } from 'preact/hooks';
import { ArcDetail } from './views/ArcDetail.tsx';
import { DeliveryDetails } from './views/DeliveryDetails.tsx';
import { DkimDetail } from './views/DkimDetail.tsx';
import { DmarcDetail } from './views/DmarcDetail.tsx';
import { DnsLog } from './views/DnsLog.tsx';
import { FieldValue } from './views/FieldValue.tsx';
import { FindingList } from './views/Findings.tsx';
import { HowChecked, References } from './views/HowChecked.tsx';
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
  const [modes, setModes] = useState<readonly DmarcMode[]>(['rfc9989', 'rfc7489']);
  // The latest modes, for a run that started before the user changed them.
  const currentModes = useRef(modes);
  // The last file, so an option change can analyze it again.
  const last = useRef<Uint8Array | null>(null);

  async function analyze(file: File) {
    await run(async () => {
      last.current = new Uint8Array(await file.arrayBuffer());
      return last.current;
    });
  }

  async function run(read: () => Promise<Uint8Array>) {
    setStatus({ kind: 'running' });
    try {
      const bytes = await read();
      const report = await host.analyze(bytes, { dmarcModes: currentModes.current });
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
      <DropZone
        label="Drop an .eml file here, or choose one:"
        accept=".eml,message/rfc822"
        onFile={(file) => void analyze(file)}
      />
      <Options
        modes={modes}
        onChange={(next) => {
          setModes(next);
          currentModes.current = next;
          const bytes = last.current;
          if (bytes) void run(async () => bytes);
        }}
      />
      <Result status={status} />
    </main>
  );
}

const MODE_OPTIONS: readonly { mode: DmarcMode; label: string }[] = [
  { mode: 'rfc9989', label: 'RFC 9989 (DMARCbis)' },
  { mode: 'rfc7489', label: 'RFC 7489 (DMARC1)' },
];

/** DMARC-27: the DMARC modes to evaluate; at least one stays checked. */
function Options({
  modes,
  onChange,
}: {
  modes: readonly DmarcMode[];
  onChange: (modes: readonly DmarcMode[]) => void;
}) {
  return (
    <section aria-label="Options">
      <fieldset>
        <legend>DMARC</legend>
        {MODE_OPTIONS.map(({ mode, label }) => {
          const checked = modes.includes(mode);
          return (
            <label key={mode}>
              <input
                type="checkbox"
                checked={checked}
                disabled={checked && modes.length === 1}
                onChange={() =>
                  onChange(
                    MODE_OPTIONS.map((o) => o.mode).filter((m) =>
                      m === mode ? !checked : modes.includes(m),
                    ),
                  )
                }
              />
              {label}
            </label>
          );
        })}
      </fieldset>
    </section>
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
          <DmarcDetail dmarc={status.report.dmarc} />
          <ArcDetail arc={status.report.arc} />
          <Notes report={status.report} />
          <HeaderFields report={status.report} />
          <DnsLog entries={status.report.dnsLog} />
          <References />
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
      <HowChecked method="receiver" />
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

const FIELD_USE_NAMES: Record<FieldUse, string> = {
  delivery: 'Delivery details',
  dkim: 'DKIM',
  dmarc: 'DMARC',
  arc: 'ARC',
  receiver: 'Receiver results',
};

/** REQ-MAIL-013: every field's name; the fields a check reads also show who reads them and the value. */
function HeaderFields({ report }: { report: PartialReport }) {
  return (
    <section aria-label="Header fields">
      <h2>{report.headers.length} header fields</h2>
      <ol>
        {report.headers.map((h) => (
          <li key={h.index} id={`field-${h.index + 1}`}>
            {h.name || '(malformed line)'}
            {h.usedBy.length > 0 && (
              <>
                {' '}
                <span class="used-by">
                  Read by: {h.usedBy.map((u) => FIELD_USE_NAMES[u]).join(', ')}
                </span>
                <FieldValue value={h.value ?? ''} />
              </>
            )}
          </li>
        ))}
      </ol>
      <p>{report.hasBody ? 'Body present.' : 'Headers only.'}</p>
    </section>
  );
}

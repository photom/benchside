import { useState } from 'preact/hooks';
import type { WorkerHost } from './worker/host.ts';
import type { SkeletonReport } from './worker/protocol.ts';

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: SkeletonReport }
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
        <section aria-label="Header fields">
          <h2>{status.report.headers.length} header fields</h2>
          <ol>
            {status.report.headers.map((h) => (
              <li key={h.index}>{h.name || '(malformed line)'}</li>
            ))}
          </ol>
          <p>{status.report.hasBody ? 'Body present.' : 'Headers only.'}</p>
        </section>
      );
  }
}

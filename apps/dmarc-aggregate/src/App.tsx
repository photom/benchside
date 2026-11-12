import { useEffect, useState } from 'preact/hooks';
import type { Picked } from './input/collect.ts';
import { applySnapshot, initialState, partialLabel } from './state.ts';
import { FilesNotRead } from './views/FilesNotRead.tsx';
import { Findings } from './views/Findings.tsx';
import { Input } from './views/Input.tsx';
import { Reports } from './views/Reports.tsx';
import { StatusBar } from './views/StatusBar.tsx';
import { Summary } from './views/Summary.tsx';
import type { DmarcHost } from './worker/host.ts';

export function App({ host }: { host: DmarcHost }) {
  const [state, setState] = useState(initialState);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    host.onSnapshot((s) => setState((prev) => applySnapshot(prev, s)));
    host.onFailed((message) => setFailure(`Reading failed: ${message}`));
  }, [host]);

  const add = (files: Picked[]) => {
    setFailure(null);
    host.add(files);
  };

  return (
    <main>
      <h1>DMARC aggregate report analyzer</h1>
      <p>Reads aggregate reports (rua). Failure reports (ruf) are not read.</p>
      <p class="note">Your files never leave this browser. They are read here and sent nowhere.</p>
      <Input onAdd={add} onClear={() => host.clear()} onError={setFailure} />
      <StatusBar progress={state.progress} onStop={() => host.stop()} />
      {failure && (
        <p role="alert" class="error">
          {failure}
        </p>
      )}
      {state.shown && <Summary view={state.shown.view} partial={partialLabel(state)} />}
      {state.reports.length > 0 && <Reports reports={state.reports} />}
      <FilesNotRead files={state.files} />
      {state.findings.length > 0 && <Findings findings={state.findings} />}
    </main>
  );
}

import type { Filters as FilterSet, Focus } from '@benchside/dmarc-aggregate';
import { useEffect, useState } from 'preact/hooks';
import type { Picked } from './input/collect.ts';
import { applySnapshot, initialState, partialLabel, setFilters } from './state.ts';
import { Enforcement } from './views/Enforcement.tsx';
import { FilesNotRead } from './views/FilesNotRead.tsx';
import { Filters } from './views/Filters.tsx';
import { Findings } from './views/Findings.tsx';
import { Input } from './views/Input.tsx';
import { Paths } from './views/Paths.tsx';
import { Reports } from './views/Reports.tsx';
import { Sources } from './views/Sources.tsx';
import { StatusBar } from './views/StatusBar.tsx';
import { Summary } from './views/Summary.tsx';
import { Formats, Policies, ReporterErrors, Reporters } from './views/Tables.tsx';
import type { DmarcHost } from './worker/host.ts';

export function App({ host }: { host: DmarcHost }) {
  const [state, setState] = useState(initialState);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    host.onSnapshot((s) => setState((prev) => applySnapshot(prev, s)));
    host.onFailed((message) => setFailure(`Reading failed: ${message}`));
  }, [host]);

  /** CMB-6, SRC-5: the choice applies at once; the View for it comes with the answer (PRG-8). */
  const choose = (filters: FilterSet, focus: Focus | null) => {
    setState((prev) => setFilters(prev, filters, focus));
    host.view(filters, focus);
  };

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
      {state.reports.length > 0 && (
        <Filters
          reports={state.reports}
          filters={state.filters}
          focus={state.focus}
          onChange={choose}
        />
      )}
      {state.shown && <Summary view={state.shown.view} partial={partialLabel(state)} />}
      {state.shown && (
        <Paths totals={state.shown.view.totals} onFocus={(f) => choose(state.filters, f)} />
      )}
      {state.shown && <Enforcement domains={state.shown.view.domains} />}
      {state.shown && <Reporters rows={state.shown.view.reporters} />}
      {state.shown && <Formats rows={state.shown.view.formats} />}
      {state.shown && <Sources rows={state.shown.view.sources} />}
      {state.shown && <ReporterErrors rows={state.shown.view.reporterErrors} />}
      <Policies rows={state.policies} />
      {state.reports.length > 0 && <Reports reports={state.reports} />}
      <FilesNotRead files={state.files} />
      {state.findings.length > 0 && <Findings findings={state.findings} />}
    </main>
  );
}

import type { Filters as FilterSet, Focus, LookupProvider } from '@benchside/dmarc-aggregate';
import { AppHeader } from '@benchside/ui';
import { useEffect, useState } from 'preact/hooks';
import type { Picked } from './input/collect.ts';
import {
  applyNames,
  applySnapshot,
  hostLabel,
  initialState,
  partialLabel,
  setFilters,
  setLookup,
} from './state.ts';
import {
  CauseBars,
  DailyColumns,
  PassRate,
  PathBar,
  ReporterBars,
} from './views/charts/charts.tsx';
import { Enforcement } from './views/Enforcement.tsx';
import { FilesNotRead } from './views/FilesNotRead.tsx';
import { Filters } from './views/Filters.tsx';
import { Findings } from './views/Findings.tsx';
import { Input } from './views/Input.tsx';
import { Lookup } from './views/Lookup.tsx';
import { QueryLog } from './views/QueryLog.tsx';
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
    host.onNames((n) => setState((prev) => applyNames(prev, n)));
  }, [host]);

  /** CMB-6, SRC-5: the choice applies at once; the View for it comes with the answer (PRG-8). */
  const choose = (filters: FilterSet, focus: Focus | null) => {
    setState((prev) => setFilters(prev, filters, focus));
    host.view(filters, focus);
  };

  /** RDNS-1, RDNS-9 */
  const lookup = (on: boolean, provider: LookupProvider) => {
    setState((prev) => setLookup(prev, on, provider));
    host.lookup(on, provider);
  };

  const add = (files: Picked[]) => {
    setFailure(null);
    host.add(files);
  };

  return (
    <main>
      <svg class="defs" aria-hidden="true" focusable="false">
        <defs>
          <pattern
            id="hatch-direct"
            class="hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke-width="2" />
          </pattern>
          <pattern
            id="hatch-forwarded"
            class="hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(135)"
          >
            <line x1="0" y1="0" x2="0" y2="6" stroke-width="2" />
          </pattern>
          <pattern
            id="hatch-other"
            class="hatch"
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="4" stroke-width="1" />
          </pattern>
        </defs>
      </svg>
      <AppHeader
        title="DMARC aggregate report analyzer"
        privacy="Your files never leave this browser. If you turn on host-name lookup, source IP addresses go to the DNS provider you pick."
      >
        <p>Reads aggregate reports (rua). Failure reports (ruf) are not read.</p>
      </AppHeader>
      <Input onAdd={add} onClear={() => host.clear()} onError={setFailure} />
      <StatusBar
        progress={state.progress}
        onStop={() => host.stop()}
        lookup={state.lookup.on ? state.lookup.counts : null}
        onLookupStop={() => lookup(false, state.lookup.provider)}
      />
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
        <div class="charts">
          <DailyColumns
            days={state.shown.view.timeline}
            undated={state.shown.view.undatedMessages}
            earlier={state.shown.view.earlierMessages}
          />
          <PassRate days={state.shown.view.timeline} />
          <PathBar totals={state.shown.view.totals} onFocus={(f) => choose(state.filters, f)} />
          <CauseBars totals={state.shown.view.totals} onFocus={(f) => choose(state.filters, f)} />
        </div>
      )}
      {state.shown && <Enforcement domains={state.shown.view.domains} />}
      {state.shown && <ReporterBars rows={state.shown.view.reporters} />}
      {state.shown && <Reporters rows={state.shown.view.reporters} />}
      {state.shown && <Formats rows={state.shown.view.formats} />}
      {state.shown && (
        <Sources rows={state.shown.view.sources} host={(ip) => hostLabel(state, ip)} />
      )}
      {state.shown && <Lookup lookup={state.lookup} onChange={lookup} />}
      <QueryLog lookup={state.lookup} />
      {state.shown && <ReporterErrors rows={state.shown.view.reporterErrors} />}
      <Policies rows={state.policies} />
      {state.reports.length > 0 && <Reports reports={state.reports} />}
      <FilesNotRead files={state.files} />
      {state.findings.length > 0 && <Findings findings={state.findings} />}
    </main>
  );
}

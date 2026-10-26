import { DropZone } from '@benchside/ui';
import type { ParameterInput, ZipReport } from '@benchside/zip';
import { useRef, useState } from 'preact/hooks';
import { ByteMap } from './views/ByteMap.tsx';
import { Entries } from './views/Entries.tsx';
import { EntryDetail, type OpenState, REFUSALS } from './views/EntryDetail.tsx';
import { Findings } from './views/Findings.tsx';
import { Options } from './views/Options.tsx';
import { References } from './views/References.tsx';
import { Summary } from './views/Summary.tsx';
import type { ZipHost } from './worker/host.ts';

/** One archive on the path from the chosen file down (REQ-ZIP-004). */
interface Level {
  readonly label: string;
  readonly report: ZipReport;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; levels: readonly Level[] }
  | { kind: 'failed'; message: string };

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

export function App({ host }: { host: ZipHost }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState<OpenState>({ kind: 'idle' });
  // REQ-ZIP-008: for this visit only; never stored.
  const [parameters, setParameters] = useState<ParameterInput>({});
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped whenever the view changes, so a late open result cannot move it back.
  const view = useRef(0);
  // The chosen file and the archives open on it, for analyzing again after an option change.
  const file = useRef<File | null>(null);
  const shownLevels = useRef<readonly Level[]>([]);

  async function analyze(chosen: File, params = parameters, reopen: readonly Level[] = []) {
    file.current = chosen;
    // Until this file is shown, an option change reopens only what was open on it.
    shownLevels.current = reopen;
    view.current++;
    const mine = view.current;
    setStatus({ kind: 'running' });
    setSelected(null);
    setOpen({ kind: 'idle' });
    setNotice(null);
    try {
      // The host rejects a superseded request with AbortError, so this is the latest file.
      const report = await host.analyze(chosen, params);
      const levels: Level[] = [{ label: chosen.name, report }];
      // Open again, under the new values, each archive the user had open below the top level.
      for (const level of reopen.slice(1)) {
        const result = await host.open(level.report.path);
        if (mine !== view.current) return;
        if (result.kind === 'refused') {
          setNotice(`${level.label} could not be opened again: ${REFUSALS[result.reason]}`);
          break;
        }
        levels.push({ label: level.label, report: result.report });
      }
      show(levels, false);
    } catch (error) {
      if (!isAbort(error)) setStatus({ kind: 'failed', message: String(error) });
    }
  }

  function changeParameters(next: ParameterInput) {
    setParameters(next);
    if (file.current) void analyze(file.current, next, shownLevels.current);
  }

  function show(levels: readonly Level[], bump = true) {
    if (bump) {
      view.current++;
      setNotice(null);
    }
    shownLevels.current = levels;
    setStatus({ kind: 'done', levels });
    setSelected(null);
    setOpen({ kind: 'idle' });
  }

  async function openEntry(levels: readonly Level[], index: number) {
    const current = levels.at(-1) as Level;
    const entry = current.report.entries[index];
    if (!entry) return;
    setOpen({ kind: 'opening' });
    const mine = view.current;
    try {
      const result = await host.open([...current.report.path, index]);
      if (mine !== view.current) return;
      if (result.kind === 'refused') setOpen({ kind: 'refused', reason: result.reason });
      else show([...levels, { label: entry.name.text, report: result.report }]);
    } catch (error) {
      // The report stays; only this entry failed to open.
      if (mine === view.current && !isAbort(error)) {
        setOpen({ kind: 'failed', message: String(error) });
      }
    }
  }

  return (
    <main>
      <h1>ZIP analyzer</h1>
      <DropZone
        label="Drop a ZIP file here, or choose one:"
        accept=".zip,.jar,.war,.ear,.aar,.apk,.xpi,.epub,.docx,.xlsx,.pptx,.odt,.ods,.odp,.whl,.nupkg,.vsix,application/zip"
        onFile={(chosen) => void analyze(chosen)}
      />
      <Options value={parameters} onChange={changeParameters} />
      {notice && <p role="status">{notice}</p>}
      {status.kind === 'running' && <p role="status">Analyzing…</p>}
      {status.kind === 'failed' && <p role="alert">Analysis failed: {status.message}</p>}
      {status.kind === 'done' && (
        <Result
          levels={status.levels}
          selected={selected}
          open={open}
          onSelect={(index) => {
            view.current++;
            setSelected(index);
            setOpen({ kind: 'idle' });
          }}
          onBack={(depth) => show(status.levels.slice(0, depth + 1))}
          onOpen={(index) => void openEntry(status.levels, index)}
        />
      )}
      <References />
    </main>
  );
}

function Result({
  levels,
  selected,
  open,
  onSelect,
  onBack,
  onOpen,
}: {
  levels: readonly Level[];
  selected: number | null;
  open: OpenState;
  onSelect: (index: number) => void;
  onBack: (depth: number) => void;
  onOpen: (index: number) => void;
}) {
  const { report } = levels.at(-1) as Level;
  const entry = selected === null ? undefined : report.entries[selected];
  // A new key per archive resets paging and scroll state in the tables.
  const key = report.path.join('/');
  return (
    <>
      <nav aria-label="Archive path">
        {levels.map((level, depth) => (
          <span key={depth}>
            {depth > 0 && ' › '}
            {depth === levels.length - 1 ? (
              <span aria-current="page">{level.label}</span>
            ) : (
              <button type="button" class="link" onClick={() => onBack(depth)}>
                {level.label}
              </button>
            )}
          </span>
        ))}
      </nav>
      <Summary report={report} />
      <Findings findings={report.findings} onEntry={onSelect} />
      <Entries key={key} entries={report.entries} selected={selected} onSelect={onSelect} />
      {entry && <EntryDetail entry={entry} open={open} onOpen={() => onOpen(entry.index)} />}
      <ByteMap key={key} regions={report.regions} />
    </>
  );
}

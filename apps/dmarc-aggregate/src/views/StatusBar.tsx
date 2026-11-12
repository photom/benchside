import type { Progress } from '@benchside/dmarc-aggregate';
import { useEffect, useRef, useState } from 'preact/hooks';
import { count, mib } from './format.ts';

const doneText = (p: Progress) =>
  p.phase === 'stopped'
    ? `Stopped after ${p.filesRead} of ${p.filesTotal} files`
    : `Read ${count(p.filesTotal)} files, ${count(p.reports)} reports`;

/** Start, each quarter, and the end (ui.md, Progress). */
function announcement(p: Progress): string {
  if (p.phase !== 'reading') return `${doneText(p)}.`;
  if (p.filesRead === 0) return `Reading ${count(p.filesTotal)} files.`;
  return `Read ${count(p.filesRead)} of ${count(p.filesTotal)} files.`;
}

/** The sticky reading indicator, Stop, and the done note (PRG-4..6, PRG-9). */
export function StatusBar({ progress, onStop }: { progress: Progress | null; onStop: () => void }) {
  const [noteVisible, setNoteVisible] = useState(false);
  const [live, setLive] = useState('');
  const quarter = useRef(-1);
  // A new finished run changes these counts; a view answer after it does not (PRG-8).
  const finished =
    progress && progress.phase !== 'reading' && progress.filesTotal > 0
      ? `${progress.phase}:${progress.filesRead}:${progress.filesTotal}:${progress.reports}`
      : null;

  useEffect(() => {
    if (!progress) return;
    if (progress.phase !== 'reading') {
      quarter.current = -1;
      setLive(announcement(progress));
      return;
    }
    const q =
      progress.filesTotal === 0 ? 0 : Math.floor((progress.filesRead / progress.filesTotal) * 4);
    if (q !== quarter.current) {
      quarter.current = q;
      setLive(announcement(progress));
    }
  }, [progress]);

  useEffect(() => {
    if (finished === null) {
      setNoteVisible(false);
      return;
    }
    setNoteVisible(true);
    const t = setTimeout(() => setNoteVisible(false), 5000);
    return () => clearTimeout(t);
  }, [finished]);

  return (
    <div class="status">
      {progress?.phase === 'reading' ? (
        <>
          <div
            role="progressbar"
            aria-label="Reading files"
            aria-valuenow={progress.bytesRead}
            aria-valuemax={progress.bytesTotal}
            class="bar"
          >
            <div
              class="fill"
              style={{
                width: `${progress.bytesTotal ? (100 * progress.bytesRead) / progress.bytesTotal : 0}%`,
              }}
            />
          </div>
          <span>
            Reading files: {progress.filesRead} of {progress.filesTotal} ({mib(progress.bytesRead)}{' '}
            of {mib(progress.bytesTotal)}), {count(progress.reports)} reports
          </span>{' '}
          <button type="button" onClick={onStop}>
            Stop
          </button>
        </>
      ) : progress && noteVisible ? (
        <span class="done">{doneText(progress)}</span>
      ) : null}
      <span aria-live="polite" class="visually-hidden">
        {live}
      </span>
    </div>
  );
}

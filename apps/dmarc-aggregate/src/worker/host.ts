import type { Filters, Focus, Snapshot } from '@benchside/dmarc-aggregate';
import type { AddedFile, FromWorker, ToWorker } from './protocol.ts';
// ?worker&inline starts the worker from a blob: URL, so it inherits the page's CSP (0004).
import ReadingWorker from './worker.ts?worker&inline';

export interface DmarcHost {
  add(files: readonly AddedFile[]): void;
  /** PRG-8: answered by a snapshot carrying the same filters and focus. */
  view(filters: Filters, focus: Focus | null): void;
  stop(): void;
  clear(): void;
  /** Every snapshot, periodic or an answer (PRG-4, PRG-8). */
  onSnapshot(listener: (s: Snapshot) => void): void;
  onFailed(listener: (message: string) => void): void;
}

/** Starts the reading worker and passes its messages on (ui.md, App structure). */
export function createWorkerHost(worker: Worker = new ReadingWorker()): DmarcHost {
  let next = 0;
  let snapshot: (s: Snapshot) => void = () => {};
  let failed: (message: string) => void = () => {};
  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const m = event.data;
    if (m.type === 'failed') failed(m.message);
    else {
      const { type: _type, ...s } = m;
      snapshot(s);
    }
  };
  worker.onerror = () => failed('The reading worker stopped with an error.');
  worker.onmessageerror = () => failed('A message from the reading worker could not be read.');
  const send = (m: (id: number) => ToWorker) => worker.postMessage(m(++next));
  return {
    add: (files) => send((id) => ({ type: 'add', id, files })),
    view: (filters, focus) => send((id) => ({ type: 'view', id, filters, focus })),
    stop: () => send((id) => ({ type: 'stop', id })),
    clear: () => send((id) => ({ type: 'clear', id })),
    onSnapshot: (l) => {
      snapshot = l;
    },
    onFailed: (l) => {
      failed = l;
    },
  };
}

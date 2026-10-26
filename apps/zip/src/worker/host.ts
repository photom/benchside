import type { NestedResult, ParameterInput, ZipReport } from '@benchside/zip';
import type { FromWorker, ToWorker } from './protocol.ts';
// ?worker&inline starts the worker from a blob: URL, so it inherits the page's CSP (0004).
import AnalysisWorker from './worker.ts?worker&inline';

export interface ZipHost {
  analyze(file: Blob, parameters?: ParameterInput): Promise<ZipReport>;
  open(path: readonly number[]): Promise<NestedResult>;
  /** HEX-3: bytes of the archive at `path`. */
  read(path: readonly number[], offset: number, byteLength: number): Promise<Uint8Array>;
}

/** 0008: a request supersedes only the older request on its own lane. */
type Lane = 'analysis' | 'read';

type Waiter = { resolve: (reply: FromWorker) => void; reject: (e: Error) => void; lane: Lane };

/** Starts the worker and keeps only the latest request's answer per lane (zip-architecture.md). */
export function createWorkerHost(worker: Worker = new AnalysisWorker()): ZipHost {
  let next = 0;
  const latest: Record<Lane, number> = { analysis: 0, read: 0 };
  const pending = new Map<number, Waiter>();

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const reply = event.data;
    const waiter = pending.get(reply.id);
    pending.delete(reply.id);
    if (!waiter || reply.id !== latest[waiter.lane]) return;
    if (reply.type === 'failed') waiter.reject(new Error(reply.message));
    else waiter.resolve(reply);
  };

  // A crashed worker sends nothing more; settle the waiting requests instead of hanging.
  const fail = (message: string) => () => {
    for (const lane of ['analysis', 'read'] as const) {
      pending.get(latest[lane])?.reject(new Error(message));
      pending.delete(latest[lane]);
    }
  };
  worker.onerror = fail('The analysis worker stopped with an error.');
  worker.onmessageerror = fail('A message from the analysis worker could not be read.');

  function send(lane: Lane, message: (id: number) => ToWorker): Promise<FromWorker> {
    // The older request's answer would be dropped, so settle it here.
    pending
      .get(latest[lane])
      ?.reject(new DOMException('Superseded by a newer request', 'AbortError'));
    pending.delete(latest[lane]);
    const id = ++next;
    latest[lane] = id;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, lane });
      worker.postMessage(message(id));
    });
  }

  return {
    async analyze(file, parameters = {}) {
      const reply = await send('analysis', (id) => ({ type: 'analyze', id, file, parameters }));
      if (reply.type !== 'report') throw new Error(`Unexpected reply: ${reply.type}`);
      return reply.report;
    },
    async open(path) {
      const reply = await send('analysis', (id) => ({ type: 'open', id, path }));
      if (reply.type === 'refused') return { kind: 'refused', reason: reply.reason };
      if (reply.type !== 'report') throw new Error(`Unexpected reply: ${reply.type}`);
      return { kind: 'report', report: reply.report };
    },
    async read(path, offset, byteLength) {
      const reply = await send('read', (id) => ({ type: 'read', id, path, offset, byteLength }));
      if (reply.type !== 'bytes') throw new Error(`Unexpected reply: ${reply.type}`);
      return reply.bytes;
    },
  };
}

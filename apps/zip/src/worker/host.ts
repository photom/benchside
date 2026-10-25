import type { NestedResult, ZipReport } from '@benchside/zip';
import type { FromWorker, ToWorker } from './protocol.ts';
// ?worker&inline starts the worker from a blob: URL, so it inherits the page's CSP (0004).
import AnalysisWorker from './worker.ts?worker&inline';

export interface ZipHost {
  analyze(file: Blob): Promise<ZipReport>;
  open(path: readonly number[]): Promise<NestedResult>;
}

type Waiter = { resolve: (reply: FromWorker) => void; reject: (e: Error) => void };

/** Starts the worker and keeps only the latest request's answer (zip-architecture.md). */
export function createWorkerHost(worker: Worker = new AnalysisWorker()): ZipHost {
  let latest = 0;
  const pending = new Map<number, Waiter>();

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const reply = event.data;
    const waiter = pending.get(reply.id);
    pending.delete(reply.id);
    if (!waiter || reply.id !== latest) return;
    if (reply.type === 'failed') waiter.reject(new Error(reply.message));
    else waiter.resolve(reply);
  };

  // A crashed worker sends nothing more; settle the waiting request instead of hanging.
  const fail = (message: string) => () => {
    pending.get(latest)?.reject(new Error(message));
    pending.delete(latest);
  };
  worker.onerror = fail('The analysis worker stopped with an error.');
  worker.onmessageerror = fail('A message from the analysis worker could not be read.');

  function send(message: (id: number) => ToWorker): Promise<FromWorker> {
    // The older request's answer would be dropped, so settle it here.
    pending.get(latest)?.reject(new DOMException('Superseded by a newer request', 'AbortError'));
    pending.delete(latest);
    const id = ++latest;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage(message(id));
    });
  }

  return {
    async analyze(file) {
      const reply = await send((id) => ({ type: 'analyze', id, file }));
      if (reply.type !== 'report') throw new Error(`Unexpected reply: ${reply.type}`);
      return reply.report;
    },
    async open(path) {
      const reply = await send((id) => ({ type: 'open', id, path }));
      if (reply.type === 'refused') return { kind: 'refused', reason: reply.reason };
      if (reply.type !== 'report') throw new Error(`Unexpected reply: ${reply.type}`);
      return { kind: 'report', report: reply.report };
    },
  };
}

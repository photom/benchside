import type { PartialReport } from '@benchside/mail';
import type { FromWorker, ToWorker } from './protocol.ts';
// ?worker&inline starts the worker from a blob: URL, so it inherits the page's CSP (0004).
import AnalysisWorker from './worker.ts?worker&inline';

export interface WorkerHost {
  analyze(bytes: Uint8Array): Promise<PartialReport>;
}

/** Starts the worker and keeps only the latest request's answer (detailed design §8). */
export function createWorkerHost(worker: Worker = new AnalysisWorker()): WorkerHost {
  let latest = 0;
  const pending = new Map<
    number,
    { resolve: (r: PartialReport) => void; reject: (e: Error) => void }
  >();

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const reply = event.data;
    const waiter = pending.get(reply.id);
    pending.delete(reply.id);
    if (!waiter || reply.id !== latest) return;
    if (reply.type === 'report') waiter.resolve(reply.report);
    else waiter.reject(new Error(reply.message));
  };

  return {
    analyze(bytes) {
      if (latest > 0) post({ type: 'cancel', id: latest });
      const id = ++latest;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        post({ type: 'analyze', id, bytes });
      });
    },
  };

  function post(message: ToWorker) {
    worker.postMessage(message);
  }
}

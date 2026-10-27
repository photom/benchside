import type { PdfReport } from '@benchside/pdf';
import type { FromWorker, ToWorker } from './protocol.ts';
// ?worker&inline starts the worker from a blob: URL, so it inherits the page's CSP (0004).
import AnalysisWorker from './worker.ts?worker&inline';

export interface PdfHost {
  analyze(file: Blob): Promise<PdfReport>;
}

type Waiter = { resolve: (report: PdfReport) => void; reject: (e: Error) => void };

/** Starts the worker and keeps only the latest request's answer (pdf-architecture.md). */
export function createWorkerHost(worker: Worker = new AnalysisWorker()): PdfHost {
  let latest = 0;
  const pending = new Map<number, Waiter>();

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const reply = event.data;
    const waiter = pending.get(reply.id);
    pending.delete(reply.id);
    if (!waiter || reply.id !== latest) return;
    if (reply.type === 'failed') waiter.reject(new Error(reply.message));
    else waiter.resolve(reply.report);
  };

  // A crashed worker sends nothing more; settle the waiting request instead of hanging.
  const fail = (message: string) => () => {
    pending.get(latest)?.reject(new Error(message));
    pending.delete(latest);
  };
  worker.onerror = fail('The analysis worker stopped with an error.');
  worker.onmessageerror = fail('A message from the analysis worker could not be read.');

  return {
    analyze(file) {
      // The older request's answer would be dropped, so settle it here.
      pending.get(latest)?.reject(new DOMException('Superseded by a newer request', 'AbortError'));
      pending.delete(latest);
      const id = ++latest;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'analyze', id, file } satisfies ToWorker);
      });
    },
  };
}

import type { Job } from '@benchside/dmarc-aggregate';
import { toJobFile } from './job-file.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

/** The worker's message handling, apart from `self` so it can be tested. */
export function createHandler(job: Job, post: (m: FromWorker) => void): (m: ToWorker) => void {
  let watched: Promise<void> | null = null;
  return (m) => {
    if (m.type === 'add') {
      job.add(m.files.map(toJobFile));
      // One run, one watcher: adds during a run share its promise, so a failure is reported once.
      const run = job.idle;
      if (run !== watched) {
        watched = run;
        run.catch((error: unknown) => post({ type: 'failed', id: m.id, message: String(error) }));
      }
    } else if (m.type === 'view') job.view(m.id, m.filters, m.focus);
    else if (m.type === 'stop') job.stop();
    else if (m.type === 'lookup') job.lookup(m.on, m.provider);
    else job.clear();
  };
}

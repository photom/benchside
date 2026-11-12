import { Job } from '@benchside/dmarc-aggregate';
import { describe, expect, it } from 'vitest';
import { createHandler } from './handler.ts';
import type { FromWorker } from './protocol.ts';

const xml = (name: string) => ({ file: new File(['<a/>'], name), path: name, fromFolder: false });

describe('Worker handler (job.md)', () => {
  it('PRG-9: given several adds in one run that then fails, when it fails, then one failed message', async () => {
    const posted: FromWorker[] = [];
    let sends = 0;
    // Like a postMessage that cannot clone: every snapshot after the first throws.
    const job = new Job({
      send: () => {
        if (++sends > 1) throw new Error('DataCloneError');
      },
      stepMs: 0,
      yieldToEvents: () => Promise.resolve(),
    });
    const handle = createHandler(job, (m) => posted.push(m));
    handle({ type: 'add', id: 1, files: [xml('a')] });
    handle({ type: 'add', id: 2, files: [xml('b')] });
    handle({ type: 'add', id: 3, files: [xml('c')] });
    await new Promise((r) => setTimeout(r, 10));
    expect(posted).toEqual([{ type: 'failed', id: 1, message: 'Error: DataCloneError' }]);
  });
});

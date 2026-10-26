import { DEFAULT_PARAMETERS, type ZipReport } from '@benchside/zip';
import { describe, expect, it } from 'vitest';
import { createWorkerHost } from './host.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

/** A stand-in for Worker that records posts and lets the test reply. */
function fakeWorker() {
  const sent: ToWorker[] = [];
  const worker = {
    onmessage: null as ((e: MessageEvent<FromWorker>) => void) | null,
    onerror: null as ((e: Event) => void) | null,
    postMessage(message: ToWorker) {
      sent.push(message);
    },
  };
  const reply = (message: FromWorker) =>
    worker.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  const crash = () => worker.onerror?.(new Event('error'));
  return { worker: worker as unknown as Worker, sent, reply, crash };
}

const report: ZipReport = {
  byteLength: 22,
  path: [],
  end: null,
  entries: [],
  regions: [],
  findings: [],
  parameters: DEFAULT_PARAMETERS,
};
const file = new Blob(['x']);

describe('worker host', () => {
  it('REQ-ZIP-005: given a file, when analyzed, then the File itself goes to the worker and the report comes back', async () => {
    const { worker, sent, reply } = fakeWorker();
    const result = createWorkerHost(worker).analyze(file, { maxFiles: 5 });
    expect(sent).toEqual([{ type: 'analyze', id: 1, file, parameters: { maxFiles: 5 } }]);
    reply({ type: 'report', id: 1, report });
    await expect(result).resolves.toEqual(report);
  });

  it('NEST-5: given a path, when opened, then the worker gets it and the nested report comes back', async () => {
    const { worker, sent, reply } = fakeWorker();
    const result = createWorkerHost(worker).open([2, 0]);
    expect(sent).toEqual([{ type: 'open', id: 1, path: [2, 0] }]);
    reply({ type: 'report', id: 1, report: { ...report, path: [2, 0] } });
    await expect(result).resolves.toEqual({ kind: 'report', report: { ...report, path: [2, 0] } });
  });

  it('NEST-2: given a refusal, when the worker sends it, then open resolves with the reason', async () => {
    const { worker, reply } = fakeWorker();
    const result = createWorkerHost(worker).open([0]);
    reply({ type: 'refused', id: 1, reason: 'encrypted' });
    await expect(result).resolves.toEqual({ kind: 'refused', reason: 'encrypted' });
  });

  it('REQ-ZIP-005: given a newer request, when the older answer arrives, then the older one rejects with AbortError', async () => {
    const { worker, reply } = fakeWorker();
    const host = createWorkerHost(worker);
    const first = host.analyze(file);
    const second = host.analyze(file);
    reply({ type: 'report', id: 1, report });
    reply({ type: 'report', id: 2, report: { ...report, byteLength: 99 } });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ byteLength: 99 });
  });

  it('given a failure, when the worker reports it, then the promise rejects', async () => {
    const { worker, reply } = fakeWorker();
    const result = createWorkerHost(worker).analyze(file);
    reply({ type: 'failed', id: 1, message: 'boom' });
    await expect(result).rejects.toThrow('boom');
  });

  it('REQ-ZIP-005: given a worker that crashes, when a request is pending, then it rejects', async () => {
    const { worker, crash } = fakeWorker();
    const result = createWorkerHost(worker).open([0]);
    crash();
    await expect(result).rejects.toThrow('worker');
  });
});

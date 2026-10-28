import type { PdfReport } from '@benchside/pdf';
import { describe, expect, it } from 'vitest';
import { createWorkerHost } from './host.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

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

const report = {
  byteLength: 1,
  header: null,
  revisions: [],
  objects: [],
  trailer: null,
  encrypted: false,
  regions: [],
  document: null,
  actions: [],
  scripts: [],
  findings: [],
} satisfies PdfReport;
const file = new Blob(['x']);

describe('worker host', () => {
  it('REQ-PDF-003: given a file, when analyzed, then the File itself goes to the worker and the report comes back', async () => {
    const { worker, sent, reply } = fakeWorker();
    const result = createWorkerHost(worker).analyze(file);
    expect(sent).toEqual([{ type: 'analyze', id: 1, file }]);
    reply({ type: 'report', id: 1, report });
    await expect(result).resolves.toEqual(report);
  });

  it('REQ-PDF-003: given a newer request, when the older answer arrives, then the older one rejects with AbortError', async () => {
    const { worker, reply } = fakeWorker();
    const host = createWorkerHost(worker);
    const first = host.analyze(file);
    const second = host.analyze(file);
    reply({ type: 'report', id: 1, report });
    reply({ type: 'report', id: 2, report: { ...report, byteLength: 9 } });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ byteLength: 9 });
  });

  it('REQ-PDF-003: given a failure or a crash, when pending, then the request rejects', async () => {
    const one = fakeWorker();
    const failed = createWorkerHost(one.worker).analyze(file);
    one.reply({ type: 'failed', id: 1, message: 'boom' });
    await expect(failed).rejects.toThrow('boom');
    const two = fakeWorker();
    const crashed = createWorkerHost(two.worker).analyze(file);
    two.crash();
    await expect(crashed).rejects.toThrow('worker');
  });
});

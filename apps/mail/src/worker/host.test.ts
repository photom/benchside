import { describe, expect, it } from 'vitest';
import { createWorkerHost } from './host.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

/** A stand-in for Worker that records posts and lets the test reply. */
function fakeWorker() {
  const sent: ToWorker[] = [];
  const worker = {
    onmessage: null as ((e: MessageEvent<FromWorker>) => void) | null,
    postMessage(message: ToWorker) {
      sent.push(message);
    },
  };
  const reply = (message: FromWorker) =>
    worker.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  return { worker: worker as unknown as Worker, sent, reply };
}

const report = { headers: [{ index: 0, name: 'From' }], hasBody: true };

describe('worker host', () => {
  it('given one request, when the worker reports, then the promise resolves with the report', async () => {
    const { worker, sent, reply } = fakeWorker();
    const result = createWorkerHost(worker).analyze(new Uint8Array([1]));
    expect(sent).toEqual([{ type: 'analyze', id: 1, bytes: new Uint8Array([1]) }]);
    reply({ type: 'report', id: 1, report });
    await expect(result).resolves.toEqual(report);
  });

  it('REQ-MAIL-012: given a second request, when sent, then the first is cancelled', () => {
    const { worker, sent } = fakeWorker();
    const host = createWorkerHost(worker);
    void host.analyze(new Uint8Array([1]));
    void host.analyze(new Uint8Array([2]));
    expect(sent.map((m) => [m.type, m.id])).toEqual([
      ['analyze', 1],
      ['cancel', 1],
      ['analyze', 2],
    ]);
  });

  it('REQ-MAIL-012: given a stale report, when it arrives, then it is ignored', async () => {
    const { worker, reply } = fakeWorker();
    const host = createWorkerHost(worker);
    const first = host.analyze(new Uint8Array([1]));
    const second = host.analyze(new Uint8Array([2]));
    let firstSettled = false;
    first.then(
      () => (firstSettled = true),
      () => (firstSettled = true),
    );
    reply({ type: 'report', id: 1, report });
    reply({ type: 'report', id: 2, report: { ...report, hasBody: false } });
    await expect(second).resolves.toMatchObject({ hasBody: false });
    expect(firstSettled).toBe(false);
  });

  it('given a failure, when the worker reports it, then the promise rejects', async () => {
    const { worker, reply } = fakeWorker();
    const result = createWorkerHost(worker).analyze(new Uint8Array([1]));
    reply({ type: 'failed', id: 1, message: 'boom' });
    await expect(result).rejects.toThrow('boom');
  });
});

import type { PartialReport } from '@benchside/mail';
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

const report: PartialReport = {
  headers: [{ index: 0, name: 'From' }],
  hasBody: true,
  received: [],
  boundary: null,
  referenceTime: '2026-10-24T00:00:00.000Z',
  summary: [],
  receiver: { results: [], comparisons: [] },
  dkim: [],
  envelope: {},
  spf: {
    mailFrom: { result: 'none', counters: { dnsTerms: 0, voids: 0 }, findings: [] },
    helo: { result: 'none', counters: { dnsTerms: 0, voids: 0 }, findings: [] },
  },
  arc: { result: 'none', sets: [], findings: [] },
  dnsLog: [],
  findings: [],
};

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
    host.analyze(new Uint8Array([1])).catch(() => {});
    void host.analyze(new Uint8Array([2]));
    expect(sent.map((m) => [m.type, m.id])).toEqual([
      ['analyze', 1],
      ['cancel', 1],
      ['analyze', 2],
    ]);
  });

  it('REQ-MAIL-012: given a stale report, when it arrives, then it does not resolve the superseded request', async () => {
    const { worker, reply } = fakeWorker();
    const host = createWorkerHost(worker);
    const first = host.analyze(new Uint8Array([1]));
    const second = host.analyze(new Uint8Array([2]));
    reply({ type: 'report', id: 1, report });
    reply({ type: 'report', id: 2, report: { ...report, hasBody: false } });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toMatchObject({ hasBody: false });
  });

  it('given a failure, when the worker reports it, then the promise rejects', async () => {
    const { worker, reply } = fakeWorker();
    const result = createWorkerHost(worker).analyze(new Uint8Array([1]));
    reply({ type: 'failed', id: 1, message: 'boom' });
    await expect(result).rejects.toThrow('boom');
  });

  it('REQ-MAIL-012: given a second request, when sent, then the first rejects with AbortError and is dropped', async () => {
    const { worker } = fakeWorker();
    const host = createWorkerHost(worker);
    const first = host.analyze(new Uint8Array([1]));
    void host.analyze(new Uint8Array([2]));
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  });
});

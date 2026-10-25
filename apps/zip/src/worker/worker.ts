/// <reference lib="webworker" />
import { ArchiveChain } from './chain.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

const chain = new ArchiveChain();

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  const post = (reply: FromWorker) => self.postMessage(reply);
  try {
    if (message.type === 'analyze') {
      post({ type: 'report', id: message.id, report: await chain.analyze(message.file) });
      return;
    }
    const result = await chain.open(message.path);
    post(
      result.kind === 'report'
        ? { type: 'report', id: message.id, report: result.report }
        : { type: 'refused', id: message.id, reason: result.reason },
    );
  } catch (error) {
    post({ type: 'failed', id: message.id, message: String(error) });
  }
};

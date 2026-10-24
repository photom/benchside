/// <reference lib="webworker" />
import { splitHeaders } from '@benchside/mail';
import type { FromWorker, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type !== 'analyze') return;
  try {
    const block = splitHeaders(message.bytes);
    const reply: FromWorker = {
      type: 'report',
      id: message.id,
      report: {
        headers: block.headers.map(({ index, name }) => ({ index, name })),
        hasBody: block.body !== null,
      },
    };
    self.postMessage(reply);
  } catch (error) {
    const reply: FromWorker = { type: 'failed', id: message.id, message: String(error) };
    self.postMessage(reply);
  }
};

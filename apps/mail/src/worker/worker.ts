/// <reference lib="webworker" />
import { analyze } from '@benchside/mail';
import type { FromWorker, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type !== 'analyze') return;
  try {
    const reply: FromWorker = { type: 'report', id: message.id, report: analyze(message.bytes) };
    self.postMessage(reply);
  } catch (error) {
    const reply: FromWorker = { type: 'failed', id: message.id, message: String(error) };
    self.postMessage(reply);
  }
};

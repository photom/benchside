/// <reference lib="webworker" />
import { Job } from '@benchside/dmarc-aggregate';
import { createDohTransport } from '@benchside/dns/doh';
import { createHandler } from './handler.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

const post = (message: FromWorker) => self.postMessage(message);
// RDNS-1: the DoH transport is made only when the user turns lookups on.
const job = new Job({
  send: (s) => post({ type: 'snapshot', ...s }),
  sendNames: post,
  transport: (provider) => createDohTransport(provider),
});
const handle = createHandler(job, post);
self.onmessage = (event: MessageEvent<ToWorker>) => handle(event.data);

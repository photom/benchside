/// <reference lib="webworker" />
import { Job } from '@benchside/dmarc-aggregate';
import { createHandler } from './handler.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

const post = (message: FromWorker) => self.postMessage(message);
const handle = createHandler(new Job({ send: (s) => post({ type: 'snapshot', ...s }) }), post);
self.onmessage = (event: MessageEvent<ToWorker>) => handle(event.data);

/// <reference lib="webworker" />
import { blobSource } from '@benchside/core';
import { analyzePdf } from '@benchside/pdf';
import type { FromWorker, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  const post = (reply: FromWorker) => self.postMessage(reply);
  try {
    post({ type: 'report', id: message.id, report: await analyzePdf(blobSource(message.file)) });
  } catch (error) {
    post({ type: 'failed', id: message.id, message: String(error) });
  }
};

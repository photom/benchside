/// <reference lib="webworker" />
import { analyze, createDnsCache } from '@benchside/mail';
import { createDohTransport, type DohProvider } from '../dns/doh.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

// One cache for the worker's lifetime (DNS-14); Cloudflare is the default provider (DNS-5).
const provider: DohProvider = 'cloudflare';
const cache = createDnsCache();
const transport = createDohTransport(provider);
const running = new Map<number, AbortController>();

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    running.get(message.id)?.abort();
    running.delete(message.id);
    return;
  }
  const controller = new AbortController();
  running.set(message.id, controller);
  try {
    const report = await analyze(
      message.bytes,
      {},
      { transport, source: provider, cache, signal: controller.signal },
    );
    const reply: FromWorker = { type: 'report', id: message.id, report };
    self.postMessage(reply);
  } catch (error) {
    // A cancelled analysis is discarded; the host already moved on.
    if (controller.signal.aborted) return;
    const reply: FromWorker = { type: 'failed', id: message.id, message: String(error) };
    self.postMessage(reply);
  } finally {
    running.delete(message.id);
  }
};

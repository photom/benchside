import { describe, expect, it } from 'vitest';
import { cspPolicy, DOH_ORIGINS } from '../../vite.shared.ts';

/**
 * Runs `workerCode` in a worker started from a blob: URL inside an iframe whose
 * meta CSP is `policy`, and resolves with the worker's first message.
 * The iframe needs 'unsafe-inline' for its own bootstrap script only.
 */
function runInBlobWorker(policy: string, workerCode: string): Promise<string> {
  const harnessPolicy = policy.replace(
    "default-src 'self'",
    "default-src 'self'; script-src 'unsafe-inline'",
  );
  const bootstrap = `
    const blob = new Blob([${JSON.stringify(workerCode)}], { type: 'text/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = (e) => parent.postMessage({ harness: true, result: e.data }, '*');
    worker.onerror = () => parent.postMessage({ harness: true, result: 'worker-error' }, '*');
  `;
  const frame = document.createElement('iframe');
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${harnessPolicy.replaceAll('"', '&quot;')}"><script>${bootstrap}</script>`;
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent) => {
      if (!e.data?.harness) return;
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve(String(e.data.result));
    };
    window.addEventListener('message', onMessage);
    document.body.append(frame);
  });
}

/** Same server, different origin: localhost ↔ 127.0.0.1. */
function otherOrigin(): string {
  const url = new URL(location.href);
  url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return url.origin;
}

const probe = (target: string) => `
  fetch(${JSON.stringify(target)}, { mode: 'no-cors' })
    .then(() => postMessage('reached'), () => postMessage('blocked'));
`;

describe('0004: a blob: worker inherits the page CSP', () => {
  it('control: with connect-src *, the worker reaches the other origin', async () => {
    const policy = cspPolicy(['*']);
    expect(await runInBlobWorker(policy, probe(`${otherOrigin()}/`))).toBe('reached');
  });

  it("REQ-MAIL-001: with connect-src 'none', the worker cannot reach the other origin", async () => {
    expect(await runInBlobWorker(cspPolicy([]), probe(`${otherOrigin()}/`))).toBe('blocked');
  });

  it('REQ-MAIL-001: with the mail policy, the worker cannot reach a non-DoH origin', async () => {
    expect(await runInBlobWorker(cspPolicy(DOH_ORIGINS), probe(`${otherOrigin()}/`))).toBe(
      'blocked',
    );
  });
});

/**
 * Settles like `promise`, but rejects with the signal's reason as soon as it
 * aborts, even if the work ignores the signal. The listener is removed once
 * either side settles, so nothing stays attached to a long-lived signal.
 */
export function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** The deadline (`AbortSignal.timeout`) aborts with a `TimeoutError`; a caller's cancel does not. */
export function isTimeout(signal: AbortSignal): boolean {
  return (
    signal.aborted && (signal.reason as { name?: string } | undefined)?.name === 'TimeoutError'
  );
}

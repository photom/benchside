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

/**
 * REP-7, REP-8: runs `work` until the signal aborts. The deadline gives
 * `onFailure('timeout')`, any other throw `onFailure('internal-error')`, and the
 * caller's cancel rejects with its reason.
 */
export async function guard<T>(
  signal: AbortSignal,
  work: () => Promise<T>,
  onFailure: (kind: 'timeout' | 'internal-error', error: unknown) => T,
): Promise<T> {
  try {
    return await untilAborted(work(), signal);
  } catch (error) {
    if (signal.aborted && !isTimeout(signal)) throw signal.reason;
    return onFailure(isTimeout(signal) ? 'timeout' : 'internal-error', error);
  }
}

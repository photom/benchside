import { toALabels } from '../shared/domain.ts';
import { cacheKey } from './cache.ts';
import type { DnsType, Transport } from './types.ts';

export interface ManualRecord {
  readonly name: string;
  readonly type: DnsType;
  readonly data: string;
}

/** DNS-12: answers only from records the user entered; never touches the network. */
export function offlineTransport(records: readonly ManualRecord[]): Transport {
  const byKey = new Map<string, string[]>();
  for (const r of records) {
    const key = cacheKey('offline', toALabels(r.name) ?? r.name, r.type);
    byKey.set(key, [...(byKey.get(key) ?? []), r.data]);
  }
  return async (q) => {
    const found = byKey.get(cacheKey('offline', q.name, q.type));
    return found
      ? { rcode: 'NOERROR', records: found, authenticated: false }
      : { rcode: 'OFFLINE', records: [], authenticated: false };
  };
}

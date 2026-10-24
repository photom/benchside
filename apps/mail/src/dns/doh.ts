import { type DnsType, joinTxtData, type Lookup, type Transport } from '@benchside/mail';

/** DNS-5. Each origin must also be in the mail app's CSP `connect-src`. */
const ENDPOINTS = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/resolve',
} as const;

export type DohProvider = keyof typeof ENDPOINTS;

/** RFC 1035 / RFC 3596 type numbers in the JSON `Answer` array. */
const TYPE_NUMBER: Record<DnsType, number> = { A: 1, PTR: 12, MX: 15, TXT: 16, AAAA: 28 };

const SERVFAIL: Lookup = { rcode: 'SERVFAIL', records: [], authenticated: false };

/** DNS over HTTPS with the JSON API. `fetchFn` is a parameter so tests need no network. */
export function createDohTransport(
  provider: DohProvider,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 5000,
): Transport {
  return async ({ name, type }, signal) => {
    // DNS-6: name and type only. The resolver already converted the name to A-labels (DNS-18).
    const url = `${ENDPOINTS[provider]}?name=${encodeURIComponent(name)}&type=${type}`;
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    let body: unknown;
    try {
      response = await fetchFn(url, {
        method: 'GET',
        headers: { accept: 'application/dns-json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok) return SERVFAIL;
      body = await response.json();
    } catch {
      if (signal.aborted) throw signal.reason;
      if (timeout.aborted) return { rcode: 'TIMEOUT', records: [], authenticated: false };
      // Network error or a body that is not JSON (DNS-16).
      return SERVFAIL;
    }
    return toLookup(body, TYPE_NUMBER[type]);
  };
}

function toLookup(body: unknown, typeNumber: number): Lookup {
  if (typeof body !== 'object' || body === null) return SERVFAIL;
  const { Status, AD, Answer } = body as { Status?: unknown; AD?: unknown; Answer?: unknown };
  if (Status === 3) return { rcode: 'NXDOMAIN', records: [], authenticated: AD === true };
  if (Status !== 0) return SERVFAIL;
  if (Answer !== undefined && !Array.isArray(Answer)) return SERVFAIL;
  const records: string[] = [];
  for (const a of (Answer ?? []) as unknown[]) {
    const { type, data } = (a ?? {}) as { type?: unknown; data?: unknown };
    // DNS-17: skip CNAME steps and anything else of another type.
    if (type !== typeNumber || typeof data !== 'string') continue;
    records.push(typeNumber === TYPE_NUMBER.TXT ? joinTxtData(data) : data);
  }
  return { rcode: 'NOERROR', records, authenticated: AD === true };
}

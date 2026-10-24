import { describe, expect, it } from 'vitest';

// DNS-5: the JSON API must be reachable cross-origin from a browser.
// Needs internet access; runs in CI.
const providers = [
  {
    name: 'cloudflare',
    url: 'https://cloudflare-dns.com/dns-query?name=example.com&type=TXT',
    headers: { accept: 'application/dns-json' },
  },
  { name: 'google', url: 'https://dns.google/resolve?name=example.com&type=TXT', headers: {} },
];

describe.each(providers)('DNS-5: $name DoH JSON API', ({ url, headers }) => {
  it('answers a cross-origin request with JSON', { retry: 2, timeout: 15_000 }, async () => {
    const response = await fetch(url, {
      headers,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { Status: number; Answer?: unknown[] };
    expect(body.Status).toBe(0);
  });
});

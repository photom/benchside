import { describe, expect, it } from 'vitest';
import { createDohTransport } from './doh.ts';

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond(String(input));
  }) as typeof fetch;
  return { f, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/dns-json' },
  });

const signal = new AbortController().signal;

describe('DoH transport', () => {
  it('DNS-5, DNS-6: given Cloudflare, when looking up, then only name and type are sent, with the JSON Accept header and no credentials or referrer', async () => {
    const { f, calls } = fakeFetch(() => json({ Status: 0, AD: false, Answer: [] }));
    await createDohTransport('cloudflare', f)({ name: 'example.com', type: 'TXT' }, signal);
    expect(calls[0]?.url).toBe('https://cloudflare-dns.com/dns-query?name=example.com&type=TXT');
    expect(calls[0]?.init).toMatchObject({
      method: 'GET',
      headers: { accept: 'application/dns-json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  });

  it('DNS-5: given Google, when looking up, then the resolve endpoint is used', async () => {
    const { f, calls } = fakeFetch(() => json({ Status: 0, Answer: [] }));
    await createDohTransport('google', f)({ name: 'example.com', type: 'A' }, signal);
    expect(calls[0]?.url).toBe('https://dns.google/resolve?name=example.com&type=A');
  });

  it('DNS-7, DNS-8, DNS-17: given TXT answers with a CNAME step, when looking up, then only TXT records are returned, joined, with AD as authenticated', async () => {
    const { f } = fakeFetch(() =>
      json({
        Status: 0,
        AD: true,
        Answer: [
          { name: 'a.example.', type: 5, data: 'b.example.' },
          { name: 'b.example.', type: 16, data: '"v=DKIM1; " "p=abc"' },
        ],
      }),
    );
    expect(
      await createDohTransport('cloudflare', f)({ name: 'a.example', type: 'TXT' }, signal),
    ).toEqual({
      rcode: 'NOERROR',
      records: ['v=DKIM1; p=abc'],
      authenticated: true,
    });
  });

  it('DNS-16: given Status 3, when looking up, then the answer is NXDOMAIN', async () => {
    const { f } = fakeFetch(() => json({ Status: 3 }));
    expect(
      (await createDohTransport('cloudflare', f)({ name: 'x.example', type: 'TXT' }, signal)).rcode,
    ).toBe('NXDOMAIN');
  });

  it('DNS-16: given Status 2, an HTTP error, a network error, or bad JSON, when looking up, then the answer is SERVFAIL', async () => {
    const cases: (() => Response | Promise<Response>)[] = [
      () => json({ Status: 2 }),
      () => new Response('nope', { status: 500 }),
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => new Response('not json', { status: 200 }),
      () => json({ Status: 0, Answer: 'oops' }),
    ];
    for (const respond of cases) {
      const { f } = fakeFetch(respond);
      expect(
        (await createDohTransport('cloudflare', f)({ name: 'x.example', type: 'TXT' }, signal))
          .rcode,
      ).toBe('SERVFAIL');
    }
  });

  it('DNS-16: given no answer within the timeout, when looking up, then the answer is TIMEOUT', async () => {
    const hang = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    const answer = await createDohTransport(
      'cloudflare',
      hang,
      10,
    )({ name: 'x.example', type: 'TXT' }, signal);
    expect(answer.rcode).toBe('TIMEOUT');
  });

  it("given the caller's signal is aborted, when looking up, then it rejects with AbortError", async () => {
    const controller = new AbortController();
    const hang = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    const pending = createDohTransport('cloudflare', hang)(
      { name: 'x.example', type: 'TXT' },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

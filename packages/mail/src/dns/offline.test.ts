import { describe, expect, it } from 'vitest';
import { offlineTransport } from './offline.ts';

const signal = new AbortController().signal;

describe('offline mode', () => {
  it('DNS-12: given a user record for the name and type, when looked up, then it is returned with NOERROR', async () => {
    const t = offlineTransport([
      { name: 'sel._domainkey.example.com', type: 'TXT', data: 'v=DKIM1; p=abc' },
    ]);
    expect(await t({ name: 'SEL._domainkey.example.com', type: 'TXT' }, signal)).toEqual({
      rcode: 'NOERROR',
      records: ['v=DKIM1; p=abc'],
      authenticated: false,
    });
  });

  it('DNS-12: given no matching record, when looked up, then the answer is OFFLINE', async () => {
    const t = offlineTransport([{ name: 'a.example', type: 'A', data: '192.0.2.1' }]);
    expect((await t({ name: 'a.example', type: 'TXT' }, signal)).rcode).toBe('OFFLINE');
  });
});

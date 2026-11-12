import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';
import {
  direct,
  on,
  rec,
  reportXml,
} from '../../../packages/dmarc-aggregate/src/test/report-xml.ts';
import { jobHost, mount, pick, root, section, settle, xmlFile } from './test/harness.tsx';

const ok = (...records: string[]) => ({ rcode: 'NOERROR' as const, records, authenticated: false });
const toggle = () =>
  [...root.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith('Look up host names'))
    ?.querySelector('input') as HTMLInputElement;
const provider = () =>
  [...root.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith('Provider'))
    ?.querySelector('select') as HTMLSelectElement;
const hostCell = (ip: string) =>
  [...section('Sources').querySelectorAll('tr.source')]
    .find((r) => r.querySelector('td')?.textContent === ip)
    ?.querySelectorAll('td')[1]?.textContent;
const click = async (el: HTMLElement) => {
  act(() => el.click());
  await settle();
  await settle();
};

async function loaded() {
  const t = jobHost({
    'PTR 1.2.0.192.in-addr.arpa': ok('mx.example.net.'),
    'A mx.example.net.': ok('192.0.2.1'),
  });
  mount(t.host);
  await pick([
    xmlFile(
      'a.xml',
      reportXml({ id: 'a', ...on(0), records: direct('192.0.2.1', 3) + rec({ ip: '192.0.2.2' }) }),
    ),
  ]);
  return t;
}

describe('App: reverse lookup (RDNS-1, RDNS-5, RDNS-7, RDNS-9)', () => {
  it('RDNS-1: given the page, when shown, then lookups are off and the control names the provider and what is sent', async () => {
    await loaded();
    expect(toggle().checked).toBe(false);
    expect(toggle().closest('label')?.textContent).toBe(
      'Look up host names. Sends source IP addresses to Cloudflare as reverse DNS names',
    );
    act(() => {
      provider().value = 'google';
      provider().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(toggle().closest('label')?.textContent).toContain('to Google as');
    expect(hostCell('192.0.2.1')).toBe('Not looked up');
  });

  it('RDNS-5, RDNS-7: given lookups turned on, when they finish, then host names fill the cells and the query log lists every query', async () => {
    const t = await loaded();
    await click(toggle());
    await t.job.lookupIdle;
    await settle();
    expect(t.calls).toContain('lookup true cloudflare');
    expect(hostCell('192.0.2.1')).toBe('mx.example.net');
    expect(hostCell('192.0.2.2')).toBe('No host name');
    const log = [...section('Query log').querySelectorAll('tbody tr')].map(
      (r) => r.querySelector('td + td')?.textContent,
    );
    expect(log).toEqual(['2.2.0.192.in-addr.arpa', '1.2.0.192.in-addr.arpa', 'mx.example.net.']);
  });

  it('RDNS-9: given lookups on, when turned off, then the host names found stay and the control is off', async () => {
    const t = await loaded();
    await click(toggle());
    await t.job.lookupIdle;
    await settle();
    await click(toggle());
    expect(t.calls).toContain('lookup false cloudflare');
    expect(toggle().checked).toBe(false);
    expect(hostCell('192.0.2.1')).toBe('mx.example.net');
  });

  it('PRG-3: given lookups on, when Clear is pressed, then the control turns off', async () => {
    const t = await loaded();
    await click(toggle());
    await t.job.lookupIdle;
    const clear = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Clear',
    ) as HTMLButtonElement;
    await click(clear);
    expect(toggle().checked).toBe(false);
  });
});

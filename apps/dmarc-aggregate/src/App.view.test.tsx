import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';
import {
  direct,
  failing,
  forwarded,
  on,
  rec,
  reportXml,
} from '../../../packages/dmarc-aggregate/src/test/report-xml.ts';
import { jobHost, mount, pick, root, section, settle, xmlFile } from './test/harness.tsx';

const report = (name: string, o: Parameters<typeof reportXml>[0]) => xmlFile(name, reportXml(o));
const messages = () => section('Summary').querySelector('dt + dd')?.textContent;
const select = (label: string) =>
  [...root.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector('select') as HTMLSelectElement;
const change = async (el: HTMLInputElement | HTMLSelectElement, value?: string) => {
  act(() => {
    if (value !== undefined) el.value = value;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
};
const button = (scope: Element, text: string) =>
  [...scope.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLButtonElement;

/** A clickable chart mark by the start of its accessible name. */
const mark = (scope: Element, name: string) =>
  [...scope.querySelectorAll('g[role="button"]')].find((g) =>
    g.getAttribute('aria-label')?.startsWith(name),
  ) as SVGGElement;

async function loaded() {
  const { host } = jobHost();
  mount(host);
  await pick([
    report('a.xml', {
      id: 'a',
      ...on(0),
      records: direct('192.0.2.1', 5) + failing('198.51.100.9', 2),
    }),
    report('b.xml', {
      id: 'b',
      ...on(1),
      org: 'Other',
      records: forwarded('203.0.113.4', 3) + failing('203.0.113.4', 1),
    }),
    report('c.xml', {
      id: 'c',
      ...on(2),
      domain: 'example.net',
      policy: '<p>reject</p>',
      records: direct('192.0.2.7', 10),
    }),
  ]);
}

describe('App: filters (CMB-6)', () => {
  it('CMB-6: given a policy domain chosen, when changed, then the numbers cover that domain only', async () => {
    await loaded();
    expect(messages()).toBe('21');
    await change(select('Policy domain'), 'example.net');
    expect(messages()).toBe('10');
    await change(select('Policy domain'), '');
    expect(messages()).toBe('21');
  });

  it('CMB-6: given a reporter unticked, when changed, then its reports drop out', async () => {
    await loaded();
    const box = [...root.querySelectorAll('fieldset label')]
      .find((l) => l.textContent === 'Other')
      ?.querySelector('input') as HTMLInputElement;
    await change(box);
    expect(messages()).toBe('17');
  });

  it('CMB-6: given a From day after the To day, when chosen, then the range runs from the earlier day to the later one', async () => {
    await loaded();
    await change(select('To'), '2023-11-14');
    await change(select('From'), '2023-11-15');
    expect([select('From').value, select('To').value]).toEqual(['2023-11-14', '2023-11-15']);
    expect(messages()).toBe('11');
  });

  it('CMB-6: given every reporter ticked again, when a new reporter arrives, then it counts too', async () => {
    await loaded();
    const box = () =>
      [...root.querySelectorAll('fieldset label')]
        .find((l) => l.textContent === 'Other')
        ?.querySelector('input') as HTMLInputElement;
    await change(box());
    await change(box());
    await pick([
      report('d.xml', { id: 'd', ...on(3), org: 'Third', records: direct('192.0.2.9', 100) }),
    ]);
    expect(messages()).toBe('121');
  });

  it('CMB-6: given a day range, when chosen, then only reports of those days count', async () => {
    await loaded();
    await change(select('From'), '2023-11-15');
    expect(messages()).toBe('14');
    await change(select('To'), '2023-11-15');
    expect(messages()).toBe('4');
  });
});

describe('App: paths, causes, and focus (CMB-9, SRC-5)', () => {
  it('SRC-5: given a cause clicked, when focused, then the chip shows and the source table keeps that cause only', async () => {
    await loaded();
    expect(section('Sources').querySelectorAll('tbody > tr.source')).toHaveLength(4);
    act(() => {
      mark(section('Causes of failure'), 'Nothing authenticates').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await settle();
    expect(root.querySelector('.chip')?.textContent).toContain('Nothing authenticates');
    const ips = [...section('Sources').querySelectorAll('tbody > tr.source')].map(
      (r) => r.querySelector('td')?.textContent,
    );
    expect(ips).toEqual(['198.51.100.9']);
    expect(messages()).toBe('21');
    act(() => button(root.querySelector('.chip') as Element, 'Clear focus').click());
    await settle();
    expect(section('Sources').querySelectorAll('tbody > tr.source')).toHaveLength(4);
  });

  it('SRC-5: given a path clicked, when focused, then sources keep that path', async () => {
    await loaded();
    act(() => {
      mark(section('Delivery path'), 'Forwarded').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await settle();
    const ips = [...section('Sources').querySelectorAll('tbody > tr.source')].map(
      (r) => r.querySelector('td')?.textContent,
    );
    expect(ips).toEqual(['203.0.113.4']);
  });
});

describe('App: sources (SRC-2..4, SRC-6, REQ-DMARC-010)', () => {
  it('SRC-4: given a source row, when expanded, then its detail rows show, and they stay after a new snapshot', async () => {
    const { host } = jobHost();
    mount(host);
    await pick([
      report('a.xml', {
        id: 'a',
        ...on(0),
        records: direct('192.0.2.1', 5) + rec({ ip: '192.0.2.1', disposition: 'reject' }),
      }),
    ]);
    act(() => button(section('Sources'), '192.0.2.1').click());
    expect(section('Sources').querySelectorAll('tr.detail')).toHaveLength(2);
    await pick([report('b.xml', { id: 'b', ...on(1), records: direct('192.0.2.2') })]);
    expect(section('Sources').querySelectorAll('tr.detail')).toHaveLength(2);
  });

  it('SRC-6: given more than 50 detail rows shown with Show more details, when a new snapshot arrives, then they stay shown', async () => {
    const { host } = jobHost();
    mount(host);
    const records = Array.from({ length: 60 }, (_, i) =>
      rec({ ip: '192.0.2.1', envelopeFrom: `e${i}.example.com` }),
    ).join('');
    await pick([report('a.xml', { id: 'a', ...on(0), records })]);
    act(() => button(section('Sources'), '192.0.2.1').click());
    expect(section('Sources').querySelectorAll('tr.detail')).toHaveLength(51);
    act(() => button(section('Sources'), 'Show more details').click());
    expect(section('Sources').querySelectorAll('tr.detail')).toHaveLength(60);
    await pick([report('b.xml', { id: 'b', ...on(1), records: direct('10.0.0.1') })]);
    expect(section('Sources').querySelectorAll('tr.detail')).toHaveLength(60);
  });

  it('SRC-6: given more than 100 sources, when shown, then 100 rows and Show more adds the rest', async () => {
    const { host } = jobHost();
    mount(host);
    const records = Array.from({ length: 130 }, (_, i) => direct(`10.0.${i >> 8}.${i & 255}`)).join(
      '',
    );
    await pick([report('a.xml', { id: 'a', ...on(0), records })]);
    expect(section('Sources').querySelectorAll('tbody > tr.source')).toHaveLength(100);
    act(() => button(section('Sources'), 'Show more').click());
    expect(section('Sources').querySelectorAll('tbody > tr.source')).toHaveLength(130);
  });
});

describe('App: enforcement and tables (ENF-1..7, CMB-8, CMB-11..13)', () => {
  it('ENF-7: given each domain, when shown, then its status with icon and words, and its policy in effect', async () => {
    await loaded();
    const text = section('Enforcement').textContent;
    expect(text).toContain('example.com');
    expect(text).toContain('Some mail passes through SPF alone');
    expect(text).toContain('example.net');
    expect(text).toContain('p=reject');
    expect(section('Enforcement').querySelectorAll('[data-tone]').length).toBe(2);
  });

  it('CMB-11, CMB-12: given reports from two reporters, when shown, then reporter and format rows', async () => {
    const { host } = jobHost();
    await loaded();
    const reporters = [...section('Reporters').querySelectorAll('tbody tr')].map(
      (r) => r.querySelector('td')?.textContent,
    );
    expect(reporters).toEqual(['Example Receiver', 'Other']);
    expect(section('Formats').textContent).toContain('urn:ietf:params:xml:ns:dmarc-2.0');
  });

  it('CMB-8, CMB-13: given policies and reporter errors, when shown, then both are listed', async () => {
    const { host } = jobHost();
    mount(host);
    await pick([
      report('a.xml', { id: 'a', ...on(0), policy: '<p>none</p>' }),
      report('b.xml', { id: 'b', ...on(1), policy: '<p>reject</p>', errors: ['DNS timeout'] }),
    ]);
    const policies = section('Published policies').querySelectorAll('tbody tr');
    expect(policies).toHaveLength(2);
    expect(policies[1]?.textContent).toContain('In effect');
    expect(section('Reporter errors').textContent).toContain('DNS timeout');
  });
});

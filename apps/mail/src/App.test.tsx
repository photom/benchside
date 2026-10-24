import type { PartialReport } from '@benchside/mail';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import type { WorkerHost } from './worker/host.ts';

let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
});

function mount(host: WorkerHost) {
  root = document.createElement('div');
  document.body.append(root);
  act(() => render(<App host={host} />, root));
  return root;
}

const emptyReport: PartialReport = {
  headers: [],
  hasBody: false,
  received: [],
  boundary: null,
  referenceTime: '2026-10-24T00:00:00.000Z',
  receiver: { results: [], comparisons: [] },
  dkim: [],
  dnsLog: [],
  findings: [],
};

async function choose(container: HTMLElement, content: string) {
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  const file = new File([content], 'm.eml', { type: 'message/rfc822' });
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('App', () => {
  it('REQ-MAIL-001: given a chosen file, when analyzed, then its bytes go to the worker host', async () => {
    let received: Uint8Array | undefined;
    const host: WorkerHost = {
      analyze: async (bytes) => {
        received = bytes;
        return emptyReport;
      },
    };
    await choose(mount(host), 'From: a\r\n\r\n');
    expect(new TextDecoder().decode(received)).toBe('From: a\r\n\r\n');
  });

  it('given a report, when shown, then every header name is listed in order', async () => {
    const report: PartialReport = {
      ...emptyReport,
      headers: [
        { index: 0, name: 'From' },
        { index: 1, name: '' },
        { index: 2, name: 'Subject' },
      ],
      hasBody: true,
    };
    const container = mount({ analyze: async () => report });
    await choose(container, 'x');
    const items = [...container.querySelectorAll('[aria-label="Header fields"] li')].map(
      (li) => li.textContent,
    );
    expect(items).toEqual(['From', '(malformed line)', 'Subject']);
    expect(container.textContent).toContain('3 header fields');
    expect(container.textContent).toContain('Body present.');
  });

  it('REQ-MAIL-012: given a failing analysis, when shown, then an alert explains it', async () => {
    const container = mount({ analyze: async () => Promise.reject(new Error('boom')) });
    await choose(container, 'x');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('boom');
  });

  it('AR-10: given receiver results, when shown, then each lists authserv-id, a trust label, and method=result entries', async () => {
    const report: PartialReport = {
      ...emptyReport,
      receiver: {
        comparisons: [],
        results: [
          {
            field: 4,
            trusted: true,
            authservId: 'mx.example.org',
            entries: [
              {
                method: 'dkim',
                result: 'pass',
                props: { 'header.d': 'example.com', 'header.s': 'sel1' },
              },
              { method: 'spf', result: 'fail', reason: 'not permitted', props: {} },
            ],
          },
          {
            field: 9,
            trusted: false,
            authservId: 'mx.attacker.example',
            entries: [{ method: 'dmarc', result: 'pass', props: {} }],
          },
        ],
      },
      findings: [
        {
          id: 'authres.untrusted',
          severity: 'info',
          message: 'Untrusted-finding text.',
          evidence: [{ kind: 'header', index: 9 }],
        },
      ],
    };
    const container = mount({ analyze: async () => report });
    await choose(container, 'x');
    const section = container.querySelector('[aria-label="Receiver results"]') as HTMLElement;
    const [trusted, untrusted] = [...section.querySelectorAll('article')];
    expect(trusted?.textContent).toContain('mx.example.org');
    expect(trusted?.textContent).toContain('Trusted');
    expect([...(trusted?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'dkim=pass header.d=example.com header.s=sel1',
      'spf=fail reason: not permitted',
    ]);
    expect(untrusted?.textContent).toContain('Untrusted');
    expect(trusted?.textContent).toContain('Header field 5');
    expect(trusted?.textContent).not.toContain('Untrusted-finding text.');
    expect(untrusted?.textContent).toContain('Header field 10');
    expect(untrusted?.textContent).toContain('Untrusted-finding text.');
  });

  it('AR-10: given no receiver results, when shown, then the section says none were found', async () => {
    const container = mount({ analyze: async () => emptyReport });
    await choose(container, 'x');
    expect(container.querySelector('[aria-label="Receiver results"]')?.textContent).toContain(
      'No Authentication-Results field',
    );
  });

  it('IN-13: given findings not tied to a receiver result, when shown, then they are listed under Notes', async () => {
    const report: PartialReport = {
      ...emptyReport,
      findings: [
        {
          id: 'input.lf-converted',
          severity: 'warning',
          message: 'LF converted.',
          evidence: [{ kind: 'bytes', range: { start: 4, end: 5 } }],
        },
      ],
    };
    const container = mount({ analyze: async () => report });
    await choose(container, 'x');
    const notes = container.querySelector('[aria-label="Notes"]');
    expect(notes?.textContent).toContain('Warning');
    expect(notes?.textContent).toContain('LF converted.');
  });

  it('REQ-MAIL-012: given an analysis superseded by a newer one, when it rejects with AbortError, then no alert is shown', async () => {
    const container = mount({
      analyze: async () => Promise.reject(new DOMException('Superseded', 'AbortError')),
    });
    await choose(container, 'x');
    expect(container.querySelector('[role=alert]')).toBeNull();
  });
});

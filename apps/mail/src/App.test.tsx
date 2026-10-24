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
  summary: [],
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

  describe('DKIM', () => {
    const dkimReport: PartialReport = {
      ...emptyReport,
      headers: [
        { index: 0, name: 'DKIM-Signature' },
        { index: 1, name: 'From' },
      ],
      summary: [{ method: 'dkim', result: 'fail', counts: { fail: 1, 'not-evaluated': 1 } }],
      dkim: [
        {
          field: 0,
          result: 'fail',
          d: 'example.com',
          s: 'sel',
          keyQueryId: 'q1',
          findings: [
            {
              id: 'dkim.body-hash-mismatch',
              severity: 'error',
              message: 'The body was changed.',
              evidence: [
                { kind: 'header', index: 0 },
                { kind: 'dns', queryId: 'q1' },
              ],
            },
          ],
          trace: {
            tags: [
              ['d', 'example.com'],
              ['s', 'sel'],
            ],
            selectedHeaders: [1],
            body: { canonical: 'Hallo\r\n', length: 7, computed: 'AAA=', expected: 'BBB=' },
          },
        },
        {
          field: 0,
          result: 'not-evaluated',
          reason: 'offline',
          d: 'other.example',
          s: 'k1',
          findings: [],
          trace: { tags: [], selectedHeaders: [] },
        },
      ],
      dnsLog: [
        {
          queryId: 'q1',
          name: 'sel._domainkey.example.com',
          type: 'TXT',
          sensitivity: 'domain',
          purpose: 'DKIM key for sel._domainkey.example.com',
          rcode: 'NOERROR',
          records: ['v=DKIM1; p=abc'],
          authenticated: false,
          durationMs: 12,
          cacheHit: false,
        },
      ],
    };

    async function show(report: PartialReport) {
      const container = mount({ analyze: async () => report });
      await choose(container, 'x');
      return container;
    }

    it('SUM-2, REQ-MAIL-002: given DKIM results, when shown, then the summary line has the result and the counts', async () => {
      const c = await show(dkimReport);
      expect(c.querySelector('[aria-label="Summary"]')?.textContent).toContain(
        'DKIM: fail (1 fail, 1 not evaluated)',
      );
    });

    it('SUM-2: given no signatures, when shown, then the summary says none', async () => {
      const c = await show({
        ...emptyReport,
        summary: [{ method: 'dkim', result: 'none', counts: {} }],
      });
      expect(c.querySelector('[aria-label="Summary"]')?.textContent).toContain('DKIM: none');
    });

    it('REQ-MAIL-002: given a signature, when shown, then its card has d=, s=, the result in words, and its findings', async () => {
      const c = await show(dkimReport);
      const [first] = [...c.querySelectorAll('[aria-label="DKIM"] article')];
      expect(first?.textContent).toContain('d=example.com');
      expect(first?.textContent).toContain('s=sel');
      expect(first?.textContent).toContain('Fail');
      expect(first?.textContent).toContain('The body was changed.');
    });

    it('REQ-MAIL-002: given a not-evaluated signature, when shown, then it reads as not evaluated with its reason', async () => {
      const c = await show(dkimReport);
      const second = c.querySelectorAll('[aria-label="DKIM"] article')[1];
      expect(second?.textContent).toContain('Not evaluated (offline)');
      expect(second?.textContent).not.toContain('Fail');
    });

    it('REQ-MAIL-002: given finding evidence, when shown, then it links to the header field and the DNS log row', async () => {
      const c = await show(dkimReport);
      const links = [...c.querySelectorAll('[aria-label="DKIM"] article a')].map((a) =>
        a.getAttribute('href'),
      );
      expect(links).toContain('#field-1');
      expect(links).toContain('#dns-q1');
      expect(c.querySelector('#field-1')?.textContent).toBe('DKIM-Signature');
      expect(c.querySelector('#dns-q1')?.textContent).toContain('sel._domainkey.example.com');
    });

    it('REQ-MAIL-004: given a body hash mismatch, when shown, then the canonicalized body and both hashes are shown open', async () => {
      const c = await show(dkimReport);
      const body = c.querySelector(
        '[aria-label="DKIM"] details[data-part="body"]',
      ) as HTMLDetailsElement;
      expect(body.open).toBe(true);
      expect(body.textContent).toContain('Hallo');
      expect(body.textContent).toContain('AAA=');
      expect(body.textContent).toContain('BBB=');
    });

    it('DNS-15: given DNS queries, when shown, then the log lists name, type, result, DNSSEC, and cache hit', async () => {
      const c = await show(dkimReport);
      const row = c.querySelector('#dns-q1');
      expect(row?.textContent).toContain('TXT');
      expect(row?.textContent).toContain('NOERROR');
      expect(row?.textContent).toContain('not authenticated');
    });

    it('REQ-MAIL-004: given hashes that differ without a mismatch finding, when shown, then the body is still open', async () => {
      const [first] = dkimReport.dkim;
      if (!first) throw new Error('fixture');
      const c = await show({ ...dkimReport, dkim: [{ ...first, findings: [] }] });
      expect((c.querySelector('details[data-part="body"]') as HTMLDetailsElement).open).toBe(true);
    });

    it('DKIM-16: given a body longer than the 64 KiB shown, when shown, then the cut is marked', async () => {
      const [first] = dkimReport.dkim;
      if (!first?.trace.body) throw new Error('fixture');
      const body = { ...first.trace.body, length: 200_000 };
      const c = await show({
        ...dkimReport,
        dkim: [{ ...first, trace: { ...first.trace, body } }],
      });
      expect(c.querySelector('details[data-part="body"]')?.textContent).toContain(
        'first 65536 bytes shown',
      );
    });

    it('DNS-15: given a query that was never sent, when shown, then DNSSEC reads n/a', async () => {
      const [entry] = dkimReport.dnsLog;
      if (!entry) throw new Error('fixture');
      const c = await show({ ...dkimReport, dnsLog: [{ ...entry, rcode: 'BLOCKED' }] });
      expect(c.querySelector('#dns-q1')?.textContent).toContain('n/a');
      expect(c.querySelector('#dns-q1')?.textContent).not.toContain('not authenticated');
    });

    it('REQ-MAIL-002: given a note with DNS evidence, when shown, then it links to the DNS log row', async () => {
      const c = await show({
        ...dkimReport,
        findings: [
          {
            id: 'dns.unauthenticated',
            severity: 'info',
            message: 'Not DNSSEC-authenticated.',
            evidence: [{ kind: 'dns', queryId: 'q1' }],
          },
        ],
      });
      expect(c.querySelector('[aria-label="Notes"] a')?.getAttribute('href')).toBe('#dns-q1');
    });
  });

  it('REQ-MAIL-002: given a receiver result, when shown, then its header field is a link', async () => {
    const container = mount({
      analyze: async () => ({
        ...emptyReport,
        receiver: {
          comparisons: [],
          results: [{ field: 4, trusted: true, authservId: 'mx.example.org', entries: [] }],
        },
      }),
    });
    await choose(container, 'x');
    expect(container.querySelector('[aria-label="Receiver results"] a')?.getAttribute('href')).toBe(
      '#field-5',
    );
  });
});

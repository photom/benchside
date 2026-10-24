import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import type { WorkerHost } from './worker/host.ts';
import type { SkeletonReport } from './worker/protocol.ts';

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
        return { headers: [], hasBody: false };
      },
    };
    await choose(mount(host), 'From: a\r\n\r\n');
    expect(new TextDecoder().decode(received)).toBe('From: a\r\n\r\n');
  });

  it('given a report, when shown, then every header name is listed in order', async () => {
    const report: SkeletonReport = {
      headers: [
        { index: 0, name: 'From' },
        { index: 1, name: '' },
        { index: 2, name: 'Subject' },
      ],
      hasBody: true,
    };
    const container = mount({ analyze: async () => report });
    await choose(container, 'x');
    const items = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual(['From', '(malformed line)', 'Subject']);
    expect(container.textContent).toContain('3 header fields');
    expect(container.textContent).toContain('Body present.');
  });

  it('REQ-MAIL-012: given a failing analysis, when shown, then an alert explains it', async () => {
    const container = mount({ analyze: async () => Promise.reject(new Error('boom')) });
    await choose(container, 'x');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('boom');
  });
});

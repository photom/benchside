/** Test harness for the app: mounting, hosts, pickers (App tests). */
import { Job, type Names, type Progress, type Snapshot } from '@benchside/dmarc-aggregate';
import type { Lookup } from '@benchside/dns';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, vi } from 'vitest';
import { NOW } from '../../../../packages/dmarc-aggregate/src/test/report-xml.ts';
import { App } from '../App.tsx';
import { ALL_FILTERS } from '../state.ts';
import type { DmarcHost } from '../worker/host.ts';
import { toJobFile } from '../worker/job-file.ts';

export let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
});

export const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

export function mount(host: DmarcHost) {
  root = document.createElement('div');
  document.body.append(root);
  act(() => render(<App host={host} />, root));
  return root;
}

/** A host that runs the real job in this thread. */
/** DNS answers for the fake transport, keyed "TYPE name"; anything else is NXDOMAIN. */
export type DnsTable = Record<string, Lookup>;

export function jobHost(dns: DnsTable = {}) {
  let listener: (s: Snapshot) => void = () => {};
  let names: (n: Names) => void = () => {};
  let n = 0;
  const queries: string[] = [];
  const job = new Job({
    send: (s) => listener(s),
    sendNames: (x) => names(x),
    transport: () => async (q) => {
      queries.push(`${q.type} ${q.name}`);
      return dns[`${q.type} ${q.name}`] ?? { rcode: 'NXDOMAIN', records: [], authenticated: false };
    },
    lookupFlushMs: 0,
    stepMs: 0,
    yieldToEvents: () => Promise.resolve(),
    now: () => NOW + 4000 * 86_400,
  });
  const calls: string[] = [];
  const host: DmarcHost = {
    add: (files) => job.add(files.map(toJobFile)),
    view: (f, focus) => job.view(++n, f, focus),
    stop: () => {
      calls.push('stop');
      job.stop();
    },
    clear: () => {
      calls.push('clear');
      job.clear();
    },
    lookup: (on, provider) => {
      calls.push(`lookup ${on} ${provider}`);
      job.lookup(on, provider);
    },
    onSnapshot: (l) => {
      listener = l;
    },
    onFailed: () => {},
    onNames: (l) => {
      names = l;
    },
  };
  return { host, calls, job, queries };
}

/** A host whose snapshots the test sends by hand. */
export function manualHost() {
  let listener: (s: Snapshot) => void = () => {};
  let failed: (m: string) => void = () => {};
  const calls: string[] = [];
  const host: DmarcHost = {
    add: () => calls.push('add'),
    view: () => calls.push('view'),
    stop: () => calls.push('stop'),
    clear: () => calls.push('clear'),
    lookup: () => calls.push('lookup'),
    onNames: () => {},
    onSnapshot: (l) => {
      listener = l;
    },
    onFailed: (l) => {
      failed = l;
    },
  };
  const progress = (o: Partial<Progress>): Progress => ({
    phase: 'reading',
    bytesRead: 0,
    bytesTotal: 3 * 1024 * 1024,
    filesRead: 0,
    filesTotal: 4,
    reports: 0,
    ...o,
  });
  const send = (o: Partial<Progress>, partial = true) =>
    act(() =>
      listener({
        id: null,
        generation: 1,
        filters: ALL_FILTERS,
        focus: null,
        view: null,
        partial,
        progress: progress(o),
        changes: {
          filesAdded: [],
          fileStatus: [],
          reportsAdded: [],
          findingsAdded: [],
          policies: null,
        },
      }),
    );
  return { host, calls, send, fail: (m: string) => act(() => failed(m)) };
}

/** A section by its heading, or a chart by its caption. */
export const section = (name: string) =>
  ([...root.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === name) ??
    [...root.querySelectorAll('figure')].find((f) =>
      f.querySelector('figcaption')?.textContent?.startsWith(name),
    )) as HTMLElement;

export async function pick(files: File[], label = 'Add files') {
  const input = [...root.querySelectorAll('label')]
    .find((l) => l.textContent?.includes(label))
    ?.querySelector('input') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change'));
  });
  await settle();
  await settle();
}

export const xmlFile = (name: string, text: string) => new File([text], name, { type: 'text/xml' });

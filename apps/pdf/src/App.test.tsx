import { blobSource } from '@benchside/core';
import { analyzePdf } from '@benchside/pdf';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfBuilder, simplePdf } from '../../../packages/pdf/src/test/build-pdf.ts';
import { App } from './App.tsx';
import type { PdfHost } from './worker/host.ts';

let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const directHost: PdfHost = { analyze: (file) => analyzePdf(blobSource(file)) };

function mount(host: PdfHost = directHost) {
  root = document.createElement('div');
  document.body.append(root);
  act(() => render(<App host={host} />, root));
}

async function choose(bytes: Uint8Array, name = 'doc.pdf') {
  const input = root.querySelector('input[type=file]') as HTMLInputElement;
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // Decompression takes several ticks; wait until the analysis is shown.
  for (let i = 0; i < 50 && root.textContent?.includes('Analyzing'); i++) await settle();
}

const section = (label: string) => root.querySelector(`[aria-label="${label}"]`) as HTMLElement;
const rows = (label: string) =>
  [...section(label).querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent),
  );
const button = (scope: HTMLElement, text: string) => {
  const found = [...scope.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
};

describe('PDF app', () => {
  it('REQ-PDF-002: given a PDF, when chosen, then the summary and the objects show its structure', async () => {
    mount();
    const b = simplePdf();
    await choose(b.bytes());
    const summary = section('Summary').textContent;
    expect(summary).toContain('Version1.7');
    expect(summary).toContain('Revisions1');
    expect(summary).toContain('Objects3');
    expect(rows('Objects')).toEqual([
      [
        '1',
        '0',
        'in use',
        '0',
        `${b.offsets.get(1)} (0x${(b.offsets.get(1) as number).toString(16)})`,
        'Catalog',
        '',
      ],
      [
        '2',
        '0',
        'in use',
        '0',
        `${b.offsets.get(2)} (0x${(b.offsets.get(2) as number).toString(16)})`,
        'Pages',
        '',
      ],
      [
        '3',
        '0',
        'in use',
        '0',
        `${b.offsets.get(3)} (0x${(b.offsets.get(3) as number).toString(16)})`,
        'Page',
        '',
      ],
    ]);
    expect(section('Findings').textContent).toContain('No findings.');
  });

  it('REQ-PDF-002: given an incremental update, when shown, then revisions newest first and the replaced object says so', async () => {
    mount();
    const b = simplePdf();
    b.object(3, '<< /Type /Page /Rotate 90 >>').xrefTable({ trailer: '/Root 1 0 R' });
    await choose(b.bytes());
    expect(rows('Revisions').map((r) => [r[0], r[1]])).toEqual([
      ['1', 'table'],
      ['0', 'table'],
    ]);
    expect(rows('Objects')[2]?.[6]).toBe('replaced revision 0');
  });

  it('REQ-PDF-002: given compressed objects, when shown, then their object stream and index', async () => {
    mount();
    const b = new PdfBuilder({ version: '1.5' })
      .objectStream(5, [{ num: 1, body: '<< /Type /Catalog >>' }])
      .xrefStream(6, { trailer: '/Root 1 0 R' });
    await choose(b.bytes());
    expect(rows('Objects')[0]?.slice(2, 5)).toEqual([
      'compressed',
      '0',
      'object stream 5, index 0',
    ]);
  });

  it('REQ-PDF-002: given a finding, when shown, then it cites the ISO 32000-1 clause', async () => {
    mount();
    await choose(simplePdf().raw('junk').bytes());
    expect(section('Findings').textContent).toContain('ISO 32000-1 7.5.5');
    expect(section('Findings').textContent).toContain('pdf.eof.trailing');
  });

  it('REQ-PDF-002: given a PDF, when analyzed, then the byte map lists its regions', async () => {
    mount();
    await choose(simplePdf().bytes());
    expect(rows('Byte map').map((r) => r[2])).toEqual([
      'Header',
      'Object',
      'Object',
      'Object',
      'Cross-reference table',
      'Trailer',
      'startxref',
    ]);
  });

  it('REQ-PDF-001: given a type name that looks like markup, when shown, then it is text', async () => {
    mount();
    const b = new PdfBuilder()
      .object(1, '<< /Type /#3Cb#3Ex#3C#2Fb#3E >>')
      .xrefTable({ trailer: '/Root 1 0 R' });
    await choose(b.bytes());
    expect(section('Objects').querySelector('b')).toBeNull();
    expect(section('Objects').textContent).toContain('<b>x</b>');
  });

  it('REQ-PDF-003: given 501 objects, when shown, then 500 rows and a button for the rest', async () => {
    mount();
    const b = new PdfBuilder().object(1, '<< /Type /Catalog >>');
    for (let n = 2; n <= 501; n++) b.object(n, '<< >>');
    b.xrefTable({ trailer: '/Root 1 0 R' });
    await choose(b.bytes());
    expect(rows('Objects')).toHaveLength(500);
    await act(async () => button(section('Objects'), 'Show more').click());
    expect(rows('Objects')).toHaveLength(501);
  });

  it('REQ-PDF-003: given a failing analysis, when chosen, then an alert explains it', async () => {
    mount({ analyze: () => Promise.reject(new Error('boom')) });
    await choose(new Uint8Array(1));
    expect(root.querySelector('[role=alert]')?.textContent).toContain('boom');
  });
});

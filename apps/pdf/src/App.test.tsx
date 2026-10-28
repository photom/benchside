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

  it('REQ-PDF-005: given an OpenAction with JavaScript, when shown, then the action says it runs on open, with its script as text', async () => {
    mount();
    const b = new PdfBuilder()
      .object(1, '<< /Type /Catalog /Pages 2 0 R /OpenAction 3 0 R >>')
      .object(2, '<< /Type /Pages /Kids [] /Count 0 >>')
      .object(3, '<< /S /JavaScript /JS (alert("<b>x</b>")) >>')
      .xrefTable({ trailer: '/Root 1 0 R' });
    await choose(b.bytes());
    const actions = section('Actions');
    expect(rows('Actions')[0]?.slice(0, 3)).toEqual([
      'JavaScript · object 3',
      'Catalog, object 1',
      'When the document is opened (runs without a click)',
    ]);
    expect(actions.querySelector('b')).toBeNull();
    expect(actions.querySelector('pre')?.textContent).toBe('alert("<b>x</b>")');
    expect(section('Findings').textContent).toContain('pdf.action.javascript');
  });

  it('REQ-PDF-005: given a link, when shown, then its page, target, and event', async () => {
    mount();
    const b = new PdfBuilder()
      .object(1, '<< /Type /Catalog /Pages 2 0 R >>')
      .object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792] >>')
      .object(3, '<< /Type /Page /Parent 2 0 R /Annots [4 0 R] >>')
      .object(4, '<< /Subtype /Link /A << /S /URI /URI (https://example.com/) >> >>')
      .xrefTable({ trailer: '/Root 1 0 R' });
    await choose(b.bytes());
    expect(rows('Actions')[0]).toEqual([
      'URI',
      'Annotation, object 4, page 1',
      'When the annotation is activated',
      'https://example.com/',
    ]);
  });

  it('REQ-PDF-006: given a 3D script that runs on open and a hidden script, when shown, then both rows, their scripts as text, and the summary count', async () => {
    mount();
    const b = new PdfBuilder()
      .object(1, '<< /Type /Catalog /Pages 2 0 R >>')
      .object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792] >>')
      .object(3, '<< /Type /Page /Parent 2 0 R /Annots [4 0 R] >>')
      .object(4, '<< /Subtype /3D /Rect [0 0 1 1] /3DD 5 0 R /3DA << /A /PO >> >>')
      .stream(5, '/Subtype /U3D /OnInstantiate (spin())', 'U3D')
      .object(6, '<< /S /JavaScript /JS (<i>x</i>) >>')
      .xrefTable({ trailer: '/Root 1 0 R' });
    await choose(b.bytes());
    expect(rows('Scripts').map((r) => r.slice(0, 3))).toEqual([
      [
        '3D artwork · JavaScript',
        'Object 5, 3D annotation 4, page 1',
        'When its page opens (runs without a click)',
      ],
      ['Not reached · JavaScript', 'Object 6', 'Nothing in the document leads to it'],
    ]);
    const scripts = section('Scripts');
    expect(scripts.querySelector('i')).toBeNull();
    expect([...scripts.querySelectorAll('pre')].map((p) => p.textContent)).toEqual([
      'spin()',
      '<i>x</i>',
    ]);
    expect(section('Summary').textContent).toContain('Scripts2 outside actions, 0 in actions');
  });

  it('REQ-PDF-006: given an XFA script, a PostScript XObject, and a removed script, when shown, then where and when for each', async () => {
    mount();
    const b = new PdfBuilder()
      .object(
        1,
        '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [] /XFA [(template) 3 0 R] >> >>',
      )
      .object(2, '<< /Type /Pages /Kids [] /Count 0 >>')
      .stream(
        3,
        '',
        '<event activity="click"><script contentType="application/x-formcalc">1+1</script></event>',
      )
      .stream(4, '/Subtype /PS', 'showpage')
      .object(5, '<< /JS 9 0 R >>')
      .xrefTable({ trailer: '/Root 1 0 R' });
    b.object(5, '<< >>').xrefTable({ trailer: '/Root 1 0 R' });
    await choose(b.bytes());
    expect(rows('Scripts').map((r) => r.slice(0, 4))).toEqual([
      [
        'XFA form · application/x-formcalc',
        'Object 3, packet "template"',
        'XFA event "click"',
        'Script, 3 bytes1+1',
      ],
      [
        'PostScript XObject · PostScript',
        'Object 4',
        'Only when printed to a PostScript printer',
        'Script, 8 bytesshowpage',
      ],
      [
        'Removed · JavaScript',
        'Object 5, revision 0',
        'No longer in the newest revision',
        '(not readable)',
      ],
    ]);
  });

  it('REQ-PDF-006: given a walk cut short by a limit, when shown, then a script it did not reach may run', async () => {
    mount({ analyze: (file) => analyzePdf(blobSource(file), { limits: { maxActions: 1 } }) });
    const b = new PdfBuilder()
      .object(1, '<< /Type /Catalog /Pages 2 0 R /OpenAction 3 0 R /AA << /WC 4 0 R >> >>')
      .object(2, '<< /Type /Pages /Kids [] /Count 0 >>')
      .object(3, '<< /S /JavaScript /JS (a()) >>')
      .object(4, '<< /S /JavaScript /JS (b()) >>')
      .xrefTable({ trailer: '/Root 1 0 R' });
    await choose(b.bytes());
    expect(rows('Scripts').map((r) => r.slice(0, 3))).toEqual([
      [
        'Not checked · JavaScript',
        'Object 4',
        'May run: the document walk was cut short before reaching it',
      ],
    ]);
  });

  it('REQ-PDF-004: given pages and document information, when shown, then the pages table and the Info entries', async () => {
    mount();
    const b = simplePdf();
    b.object(4, '<< /Title (Report) /Producer (Tool) >>').xrefTable({
      trailer: '/Root 1 0 R /Info 4 0 R',
    });
    await choose(b.bytes());
    expect(rows('Pages')).toEqual([['1', '3', '612 × 792', '612 × 792', '0', '0']]);
    expect(rows('Document information')).toEqual([
      ['Title', 'Report'],
      ['Producer', 'Tool'],
    ]);
    expect(section('Document').textContent).toContain('Type, Pages');
    expect(section('Summary').textContent).toContain('Pages1');
  });

  it('REQ-PDF-004: given an encrypted file, when shown, then text values say they are encrypted', async () => {
    mount();
    const b = simplePdf();
    b.object(4, '<< /Title (x) >>').object(5, '<< /Filter /Standard >>');
    b.xrefTable({ trailer: '/Root 1 0 R /Info 4 0 R /Encrypt 5 0 R' });
    await choose(b.bytes());
    expect(rows('Document information')).toEqual([['Title', '(encrypted)']]);
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

import { deflateSync } from 'node:zlib';
import { bytesSource } from '@benchside/core';
import { describe, expect, it } from 'vitest';
import { analyzePdf, type Limits } from './analyze.ts';
import { PdfBuilder } from './test/build-pdf.ts';
import type { PdfReport } from './types.ts';

const analyze = (b: PdfBuilder, limits: Partial<Limits> = {}) =>
  analyzePdf(bytesSource(b.bytes()), { limits });
const ids = (r: PdfReport) => r.findings.map((f) => f.id);
const actionIds = (r: PdfReport) =>
  ids(r).filter(
    (id) =>
      id.startsWith('pdf.action') || id.startsWith('pdf.tree') || id === 'pdf.too-many-actions',
  );
const brief = (r: PdfReport) =>
  r.actions.map((a) => [a.type, a.source, a.event, a.automatic, a.depth]);

/**
 * Catalog 1 with `catalog` entries, page tree 2, page 3 with `page` entries, and the
 * given objects. Every page has a media box.
 */
function doc(catalog: string, page: string, objects: [number, string][] = [], trailer = '') {
  const b = new PdfBuilder()
    .object(1, `<< /Type /Catalog /Pages 2 0 R ${catalog} >>`)
    .object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792] >>')
    .object(3, `<< /Type /Page /Parent 2 0 R ${page} >>`);
  for (const [n, body] of objects) b.object(n, body);
  return b.xrefTable({ trailer: `/Root 1 0 R ${trailer}` });
}

describe('acceptance', () => {
  it('REQ-PDF-005: given an OpenAction with JavaScript, when analyzed, then one action that runs on open, with its script', async () => {
    const r = await analyze(
      doc('/OpenAction 4 0 R', '', [[4, '<< /S /JavaScript /JS (app.alert(1)) >>']]),
    );
    expect(r.actions).toEqual([
      {
        type: 'JavaScript',
        source: 'catalog',
        event: 'OpenAction',
        automatic: true,
        depth: 0,
        holder: 1,
        object: 4,
        script: { text: { text: 'app.alert(1)', truncated: false }, byteLength: 12 },
      },
    ]);
    expect(actionIds(r)).toEqual(['pdf.action.javascript', 'pdf.action.automatic']);
  });

  it('REQ-PDF-005: given a link annotation with a URI action, when analyzed, then the URI, its page, and the annotation', async () => {
    const r = await analyze(
      doc('', '/Annots [4 0 R]', [
        [
          4,
          '<< /Type /Annot /Subtype /Link /Rect [0 0 1 1] /A << /S /URI /URI (https://example.com/) >> >>',
        ],
      ]),
    );
    expect(r.findings).toEqual([]);
    expect(r.actions).toEqual([
      {
        type: 'URI',
        source: 'annotation',
        event: 'A',
        automatic: false,
        depth: 0,
        page: 0,
        holder: 4,
        target: { text: 'https://example.com/', truncated: false },
      },
    ]);
  });

  it('REQ-PDF-005: given a JavaScript action in an object stream with its script in a Flate stream, when analyzed, then the decoded script', async () => {
    const script = deflateSync(new TextEncoder().encode('this.print();'));
    const b = new PdfBuilder({ version: '1.5' })
      .stream(5, '/Filter /FlateDecode', new Uint8Array(script))
      .objectStream(9, [
        { num: 1, body: '<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>' },
        { num: 2, body: '<< /Type /Pages /Kids [] /Count 0 >>' },
        { num: 4, body: '<< /S /JavaScript /JS 5 0 R >>' },
      ])
      .xrefStream(10, { trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(r.actions[0]?.script).toEqual({
      text: { text: 'this.print();', truncated: false },
      byteLength: 13,
    });
  });

  it('REQ-PDF-005, ACT-4: given a Next chain that points back to an earlier action, when analyzed, then action.loop', async () => {
    const r = await analyze(
      doc('/OpenAction 4 0 R', '', [
        [4, '<< /S /Named /N /NextPage /Next 5 0 R >>'],
        [5, '<< /S /Named /N /PrevPage /Next 4 0 R >>'],
      ]),
    );
    expect(r.actions).toHaveLength(2);
    expect(actionIds(r)).toEqual([
      'pdf.action.automatic',
      'pdf.action.automatic',
      'pdf.action.loop',
    ]);
  });

  it('REQ-PDF-005: given only go-to links, when analyzed, then no action findings', async () => {
    const r = await analyze(
      doc('', '/Annots [<< /Subtype /Link /A << /S /GoTo /D [3 0 R /Fit] >> >>]'),
    );
    expect(r.findings).toEqual([]);
    expect(brief(r)).toEqual([['GoTo', 'annotation', 'A', false, 0]]);
  });
});

describe('places', () => {
  it('ACT-1: given catalog, page, and annotation additional actions, when analyzed, then each event and whether it runs without a click', async () => {
    const js = (s: string) => `<< /S /Named /N /${s} >>`;
    const r = await analyze(
      doc(
        `/AA << /WC ${js('A')} /DP ${js('B')} >>`,
        `/AA << /O ${js('C')} /C ${js('D')} >> /Annots [<< /Subtype /Screen /AA << /U ${js('E')} /PV ${js('F')} >> >>]`,
      ),
    );
    expect(brief(r)).toEqual([
      ['Named', 'catalog', 'WC', false, 0],
      ['Named', 'catalog', 'DP', false, 0],
      ['Named', 'page', 'O', true, 0],
      ['Named', 'page', 'C', false, 0],
      ['Named', 'annotation', 'U', false, 0],
      ['Named', 'annotation', 'PV', true, 0],
    ]);
  });

  it('ACT-2: given an OpenAction that is a destination array, when analyzed, then no action', async () => {
    const r = await analyze(doc('/OpenAction [3 0 R /Fit]', ''));
    expect(r.actions).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it('ACT-3: given an unknown or missing S, when analyzed, then action.unknown and the type as written', async () => {
    const r = await analyze(doc('', '/AA << /O << /S /Explode >> /C << /N /X >> >>'));
    expect(r.actions.map((a) => a.type)).toEqual(['Explode', '']);
    expect(actionIds(r)).toEqual([
      'pdf.action.unknown',
      'pdf.action.automatic',
      'pdf.action.unknown',
    ]);
  });

  it("ACT-4: given a Next array, when analyzed, then the chain in order with depths and the first action's place", async () => {
    const r = await analyze(
      doc(
        '',
        '/AA << /C << /S /Named /N /A /Next [<< /S /Named /N /B /Next << /S /Hide >> >> << /S /Trans >>] >> >>',
      ),
    );
    expect(brief(r)).toEqual([
      ['Named', 'page', 'C', false, 0],
      ['Named', 'page', 'C', false, 1],
      ['Hide', 'page', 'C', false, 2],
      ['Trans', 'page', 'C', false, 1],
    ]);
  });

  it('ACT-4, ACT-10: given a Next chain after an automatic action, when analyzed, then every action in it is automatic', async () => {
    const r = await analyze(
      doc('/OpenAction << /S /Named /N /A /Next << /S /Named /N /B >> >>', ''),
    );
    expect(r.actions.map((a) => a.automatic)).toEqual([true, true]);
  });

  it('ACT-5: given a field merged with its widget, when analyzed, then its actions are listed once, from the page', async () => {
    const r = await analyze(
      doc('/AcroForm << /Fields [4 0 R] >>', '/Annots [4 0 R]', [
        [4, '<< /Subtype /Widget /FT /Btn /T (go) /Rect [0 0 1 1] /A << /S /ResetForm >> >>'],
      ]),
    );
    expect(brief(r)).toEqual([['ResetForm', 'annotation', 'A', false, 0]]);
    expect(r.document?.fields).toBe(1);
  });
});

describe('targets', () => {
  const one = async (action: string, extra: [number, string][] = []) =>
    analyze(doc('', `/AA << /C ${action} >>`, extra));

  it('ACT-6, ACT-9: given a Launch with a file specification dictionary, when analyzed, then its UF and action.launch', async () => {
    const r = await one('<< /S /Launch /F << /Type /Filespec /F (a.exe) /UF (b.exe) >> >>');
    expect(r.actions[0]?.target?.text).toBe('b.exe');
    expect(actionIds(r)).toEqual(['pdf.action.launch']);
  });

  it('ACT-6: given a Launch with Win parameters, when analyzed, then the Win file and its parameters', async () => {
    const r = await one('<< /S /Launch /Win << /F (cmd.exe) /P (/c calc) >> >>');
    expect(r.actions[0]?.target?.text).toBe('cmd.exe /c calc');
  });

  it('ACT-6, ACT-9: given GoToR and GoToE, when analyzed, then their files and action.remote', async () => {
    const r = await analyze(
      doc(
        '',
        '/AA << /O << /S /GoToR /F (other.pdf) /D (x) >> /C << /S /GoToE /T << /R /C /N (e) >> /D (x) >> >>',
      ),
    );
    expect(r.actions.map((a) => a.target?.text)).toEqual(['other.pdf', undefined]);
    expect(actionIds(r).filter((id) => id === 'pdf.action.remote')).toHaveLength(2);
  });

  it('ACT-6, ACT-9: given SubmitForm and ImportData, when analyzed, then their files and findings', async () => {
    const r = await analyze(
      doc(
        '',
        '/AA << /O << /S /SubmitForm /F << /FS /URL /F (https://example.net/s) >> >> /C << /S /ImportData /F (data.fdf) >> >>',
      ),
    );
    expect(r.actions.map((a) => a.target?.text)).toEqual(['https://example.net/s', 'data.fdf']);
    expect(actionIds(r)).toEqual([
      'pdf.action.submit-form',
      'pdf.action.automatic',
      'pdf.action.import-data',
    ]);
  });

  it('ACT-6: given Named and GoTo actions, when analyzed, then the name and the named destination', async () => {
    const r = await analyze(
      doc('', '/AA << /O << /S /Named /N /Print >> /C << /S /GoTo /D (chapter1) >> >>'),
    );
    expect(r.actions.map((a) => a.target?.text)).toEqual(['Print', 'chapter1']);
  });

  it('ACT-7, ACT-9: given a Rendition with a script, when analyzed, then the script and action.javascript', async () => {
    const r = await one('<< /S /Rendition /OP 0 /JS (play()) >>');
    expect(r.actions[0]?.script?.text.text).toBe('play()');
    expect(actionIds(r)).toEqual(['pdf.action.javascript']);
  });

  it('ACT-7: given a script stream that does not decode, when analyzed, then no script and filter.error', async () => {
    const LF = String.fromCharCode(10);
    const stream = `<< /Length 4 /Filter /FlateDecode >>${LF}stream${LF}nope${LF}endstream`;
    const r = await one('<< /S /JavaScript /JS 4 0 R >>', [[4, stream]]);
    expect(r.actions[0]?.script).toBeUndefined();
    expect(ids(r)).toContain('pdf.filter.error');
  });

  it('ACT-8: given an encrypted file, when analyzed, then the type and place, but no script text or target', async () => {
    const r = await analyze(
      doc(
        '/OpenAction << /S /JavaScript /JS (x()) >>',
        '/AA << /C << /S /URI /URI (https://a/) >> >>',
        [[4, '<< /Filter /Standard >>']],
        '/Encrypt 4 0 R /ID [<00> <00>]',
      ),
    );
    expect(r.actions.map((a) => [a.type, a.script?.text.text, a.target?.text])).toEqual([
      ['JavaScript', null, undefined],
      ['URI', undefined, null],
    ]);
  });

  it('ACT-8, TXT-4: given an encrypted file, when the JavaScript name tree is read, then its keys are not decoded', async () => {
    const r = await analyze(
      doc(
        '/Names << /JavaScript << /Names [(key) << /S /JavaScript /JS (x) >>] >> >>',
        '',
        [[4, '<< /Filter /Standard >>']],
        '/Encrypt 4 0 R',
      ),
    );
    expect(r.actions[0]?.label).toBeUndefined();
  });

  it('ACT-11: given more actions than the limit, when analyzed, then too-many-actions', async () => {
    const r = await analyze(doc('', '/AA << /O << /S /Hide >> /C << /S /Hide >> >>'), {
      maxActions: 1,
    });
    expect(r.actions).toHaveLength(1);
    expect(ids(r)).toContain('pdf.too-many-actions');
  });
});

describe('trees', () => {
  it("ACT-12: given an outline with nested items, when analyzed, then each item's action with its title, depth-first", async () => {
    const r = await analyze(
      doc('/Outlines 4 0 R', '', [
        [4, '<< /Type /Outlines /First 5 0 R /Last 6 0 R /Count 3 >>'],
        [
          5,
          '<< /Title (One) /Parent 4 0 R /Next 6 0 R /First 7 0 R /Last 7 0 R /A << /S /Named /N /A >> >>',
        ],
        [6, '<< /Title (Two) /Parent 4 0 R /Prev 5 0 R /A << /S /URI /URI (https://b/) >> >>'],
        [7, '<< /Title (One.1) /Parent 5 0 R /A << /S /Named /N /B >> >>'],
      ]),
    );
    expect(r.actions.map((a) => [a.source, a.label, a.holder])).toEqual([
      ['outline', 'One', 5],
      ['outline', 'One.1', 7],
      ['outline', 'Two', 6],
    ]);
    expect(r.document?.outlineItems).toBe(3);
  });

  it('ACT-15: given outline items whose Next points back, when analyzed, then tree.loop', async () => {
    const r = await analyze(
      doc('/Outlines << /First 4 0 R >>', '', [
        [4, '<< /Title (A) /Next 5 0 R >>'],
        [5, '<< /Title (B) /Next 4 0 R >>'],
      ]),
    );
    expect(actionIds(r)).toEqual(['pdf.tree.loop']);
    expect(r.document?.outlineItems).toBe(2);
  });

  it('ACT-13: given a field tree, when analyzed, then field events with the full field name, and widget kids as annotations', async () => {
    const r = await analyze(
      doc('/AcroForm << /Fields [4 0 R] >>', '', [
        [4, '<< /T (person) /Kids [5 0 R] >>'],
        [
          5,
          '<< /T (age) /Parent 4 0 R /FT /Tx /AA << /K << /S /JavaScript /JS (k()) >> /V << /S /JavaScript /JS (v()) >> >> /Kids [6 0 R] >>',
        ],
        [6, '<< /Subtype /Widget /Parent 5 0 R /Rect [0 0 1 1] /AA << /Fo << /S /Hide >> >> >>'],
      ]),
    );
    expect(r.actions.map((a) => [a.source, a.event, a.label])).toEqual([
      ['field', 'K', 'person.age'],
      ['field', 'V', 'person.age'],
      ['annotation', 'Fo', 'person.age'],
    ]);
    expect(r.document?.fields).toBe(3);
  });

  it('ACT-14: given a JavaScript name tree with Kids, when analyzed, then each script with its key, run on open', async () => {
    const r = await analyze(
      doc('/Names << /JavaScript 4 0 R >>', '', [
        [4, '<< /Kids [5 0 R] >>'],
        [5, '<< /Limits [(a) (b)] /Names [(a) << /S /JavaScript /JS (one()) >> (b) 6 0 R] >>'],
        [6, '<< /S /JavaScript /JS (two()) >>'],
      ]),
    );
    expect(r.actions.map((a) => [a.source, a.event, a.label, a.automatic, a.object])).toEqual([
      ['names', 'JavaScript', 'a', true, undefined],
      ['names', 'JavaScript', 'b', true, 6],
    ]);
  });

  it('ACT-15: given more tree items than the limit, when analyzed, then tree.limit', async () => {
    const r = await analyze(
      doc('/Outlines << /First 4 0 R >>', '', [
        [4, '<< /Title (A) /Next 5 0 R >>'],
        [5, '<< /Title (B) /Next 6 0 R >>'],
        [6, '<< /Title (C) >>'],
      ]),
      { maxTreeItems: 2 },
    );
    expect(actionIds(r)).toEqual(['pdf.tree.limit']);
    expect(r.document?.outlineItems).toBe(2);
  });

  it('REP-10: given actions in every place, when analyzed, then catalog, names, pages, fields, outline order', async () => {
    const h = '<< /S /Hide >>';
    const r = await analyze(
      doc(
        `/Outlines << /First 5 0 R >> /AcroForm << /Fields [4 0 R] >> /Names << /JavaScript << /Names [(n) ${h}] >> >> /AA << /WC ${h} >>`,
        `/AA << /C ${h} >>`,
        [
          [4, `<< /T (f) /AA << /C ${h} >> >>`],
          [5, `<< /Title (o) /A ${h} >>`],
        ],
      ),
    );
    expect(r.actions.map((a) => a.source)).toEqual([
      'catalog',
      'names',
      'page',
      'field',
      'outline',
    ]);
  });
});

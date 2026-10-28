import { deflateSync } from 'node:zlib';
import { bytesSource } from '@benchside/core';
import { describe, expect, it } from 'vitest';
import { analyzePdf, type Limits } from './analyze.ts';
import { PdfBuilder } from './test/build-pdf.ts';
import type { PdfReport } from './types.ts';

const analyze = (b: PdfBuilder, limits: Partial<Limits> = {}) =>
  analyzePdf(bytesSource(b.bytes()), { limits });
const scriptIds = (r: PdfReport) =>
  r.findings
    .map((f) => f.id)
    .filter(
      (id) =>
        id.startsWith('pdf.script') || id.startsWith('pdf.xfa') || id === 'pdf.too-many-scripts',
    );
const brief = (r: PdfReport) => r.scripts.map((s) => [s.source, s.object, s.script?.text.text]);
const flate = (s: string) => new Uint8Array(deflateSync(new TextEncoder().encode(s)));

/**
 * Catalog 1 with `catalog` entries, page tree 2, page 3 with `page` entries; `more` adds
 * objects before the cross-reference table.
 */
function doc(
  catalog: string,
  page: string,
  more: (b: PdfBuilder) => void = () => {},
  trailer = '',
) {
  const b = new PdfBuilder()
    .object(1, `<< /Type /Catalog /Pages 2 0 R ${catalog} >>`)
    .object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 612 792] >>')
    .object(3, `<< /Type /Page /Parent 2 0 R ${page} >>`);
  more(b);
  return b.xrefTable({ trailer: `/Root 1 0 R ${trailer}` });
}

const XFA =
  '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template><subform><field name="f">' +
  '<event activity="initialize"><script contentType="application/x-javascript">app.alert(1)</script>' +
  '</event></field></subform></template></xdp:xdp>';

describe('acceptance', () => {
  it('REQ-PDF-006: given a 3D annotation whose stream has OnInstantiate and activation PO, when analyzed, then the script with its page, running on open', async () => {
    const r = await analyze(
      doc('', '/Annots [4 0 R]', (b) =>
        b
          .object(4, '<< /Type /Annot /Subtype /3D /Rect [0 0 1 1] /3DD 5 0 R /3DA << /A /PO >> >>')
          .stream(5, '/Type /3D /Subtype /U3D /OnInstantiate 6 0 R', 'U3D')
          .stream(6, '/Filter /FlateDecode', flate('host.alert(3)')),
      ),
    );
    expect(r.scripts).toEqual([
      {
        source: '3d',
        language: 'JavaScript',
        automatic: true,
        object: 5,
        holder: 4,
        page: 0,
        event: 'PO',
        script: { text: { text: 'host.alert(3)', truncated: false }, byteLength: 13 },
      },
    ]);
    expect(scriptIds(r)).toEqual(['pdf.script.3d']);
  });

  it('REQ-PDF-006: given an XFA form with a script in an initialize event, when analyzed, then its text, contentType, and event', async () => {
    const r = await analyze(
      doc('/AcroForm << /Fields [] /XFA 4 0 R >>', '', (b) =>
        b.stream(4, '/Filter /FlateDecode', flate(XFA)),
      ),
    );
    expect(r.scripts).toEqual([
      {
        source: 'xfa',
        language: 'application/x-javascript',
        automatic: false,
        object: 4,
        event: 'initialize',
        script: { text: { text: 'app.alert(1)', truncated: false }, byteLength: 12 },
      },
    ]);
    expect(scriptIds(r)).toEqual(['pdf.xfa', 'pdf.script.xfa']);
  });

  it('REQ-PDF-006: given a PostScript XObject, when analyzed, then its PostScript text', async () => {
    const r = await analyze(
      doc('', '', (b) => b.stream(4, '/Type /XObject /Subtype /PS', '/Times findfont')),
    );
    expect(r.scripts).toEqual([
      {
        source: 'postscript',
        language: 'PostScript',
        automatic: false,
        object: 4,
        script: { text: { text: '/Times findfont', truncated: false }, byteLength: 15 },
      },
    ]);
    expect(scriptIds(r)).toEqual(['pdf.script.postscript']);
  });

  it('REQ-PDF-006: given a JavaScript action that nothing refers to, when analyzed, then it is listed as unreached', async () => {
    const r = await analyze(doc('', '', (b) => b.object(4, '<< /S /JavaScript /JS (hidden()) >>')));
    expect(r.actions).toEqual([]);
    expect(r.scripts).toEqual([
      {
        source: 'unreached',
        language: 'JavaScript',
        automatic: false,
        object: 4,
        script: { text: { text: 'hidden()', truncated: false }, byteLength: 8 },
      },
    ]);
    expect(scriptIds(r)).toEqual(['pdf.script.unreached']);
  });

  it('REQ-PDF-006: given a JavaScript action removed by an update, when analyzed, then it is listed with the revision that held it', async () => {
    const b = doc('/OpenAction << /S /JavaScript /JS (gone()) >>', '');
    b.object(1, '<< /Type /Catalog /Pages 2 0 R >>').xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(r.actions).toEqual([]);
    expect(r.scripts).toEqual([
      {
        source: 'removed',
        language: 'JavaScript',
        automatic: false,
        object: 1,
        revision: 0,
        script: { text: { text: 'gone()', truncated: false }, byteLength: 6 },
      },
    ]);
    expect(scriptIds(r)).toEqual(['pdf.script.removed']);
  });

  it('REQ-PDF-006: given JavaScript only in actions, when analyzed, then no other scripts', async () => {
    const r = await analyze(
      doc(
        '/OpenAction 4 0 R /AA << /WC << /S /JavaScript /JS (a()) /Next << /S /JavaScript /JS (b()) >> >> >>',
        '/Annots [<< /Subtype /Link /Rect [0 0 1 1] /A << /S /JavaScript /JS (c()) >> >>]',
        (b) => b.object(4, '<< /S /JavaScript /JS (d()) >>'),
      ),
    );
    expect(r.actions).toHaveLength(4);
    expect(r.scripts).toEqual([]);
    expect(scriptIds(r)).toEqual([]);
  });
});

describe('3D', () => {
  it('SCR-2: given two annotations sharing a 3D reference dictionary without activation, when analyzed, then one script, not automatic, event XA', async () => {
    const r = await analyze(
      doc('', '/Annots [4 0 R 5 0 R]', (b) =>
        b
          .object(4, '<< /Subtype /3D /Rect [0 0 1 1] /3DD 6 0 R >>')
          .object(5, '<< /Subtype /3D /Rect [0 0 1 1] /3DD 6 0 R >>')
          .object(6, '<< /Type /3DRef /3DD 7 0 R >>')
          .stream(7, '/Type /3D /Subtype /U3D /OnInstantiate 8 0 R', 'U3D')
          .stream(8, '', 'x()'),
      ),
    );
    expect(r.scripts.map((s) => [s.source, s.object, s.holder, s.event, s.automatic])).toEqual([
      ['3d', 7, 4, 'XA', false],
    ]);
  });

  it('SCR-2: given activation PV, when analyzed, then automatic', async () => {
    const r = await analyze(
      doc('', '/Annots [4 0 R]', (b) =>
        b
          .object(4, '<< /Subtype /3D /Rect [0 0 1 1] /3DD 5 0 R /3DA << /A /PV >> >>')
          .stream(5, '/Subtype /U3D /OnInstantiate 6 0 R', 'U3D')
          .stream(6, '', 'x()'),
      ),
    );
    expect(r.scripts.map((s) => [s.event, s.automatic])).toEqual([['PV', true]]);
  });

  it('SCR-2: given a 3D stream without OnInstantiate, or a 3DD that is not a stream, when analyzed, then no scripts', async () => {
    const r = await analyze(
      doc('', '/Annots [4 0 R 5 0 R]', (b) =>
        b
          .object(4, '<< /Subtype /3D /Rect [0 0 1 1] /3DD 6 0 R >>')
          .object(5, '<< /Subtype /3D /Rect [0 0 1 1] /3DD (nope) >>')
          .stream(6, '/Subtype /U3D', 'U3D'),
      ),
    );
    expect(r.scripts).toEqual([]);
  });
});

describe('XFA', () => {
  it('SCR-3: given XFA packets with a bad pair, when analyzed, then scripts carry their packet names and the bad pair is skipped', async () => {
    const r = await analyze(
      doc(
        '/AcroForm << /Fields [] /XFA [(xdp:xdp) 4 0 R /bad 5 0 R (template) 5 0 R (config)] >>',
        '',
        (b) =>
          b.stream(4, '', '<xdp:xdp>').stream(5, '', '<template><script>t()</script></template>'),
      ),
    );
    expect(r.scripts.map((s) => [s.source, s.object, s.label, s.script?.text.text])).toEqual([
      ['xfa', 5, 'template', 't()'],
    ]);
  });

  it('SCR-3: given an encrypted file with XFA, when analyzed, then pdf.xfa only', async () => {
    const r = await analyze(
      doc(
        '/AcroForm << /Fields [] /XFA 4 0 R >>',
        '',
        (b) => b.stream(4, '', XFA).object(5, '<< /Filter /Standard >>'),
        '/Encrypt 5 0 R',
      ),
    );
    expect(r.scripts).toEqual([]);
    expect(scriptIds(r)).toEqual(['pdf.xfa']);
    expect(r.findings.find((f) => f.id === 'pdf.xfa')?.message).toContain('not searched');
  });
});

describe('PostScript', () => {
  it('SCR-6: given a form with Subtype2 PS and a Level1 stream, when analyzed, then both, Level1 labeled', async () => {
    const r = await analyze(
      doc('', '', (b) =>
        b
          .stream(4, '/Subtype /Form /Subtype2 /PS /BBox [0 0 1 1] /Level1 5 0 R', 'level2')
          .stream(5, '', 'level1'),
      ),
    );
    expect(r.scripts.map((s) => [s.source, s.object, s.label, s.script?.text.text])).toEqual([
      ['postscript', 4, undefined, 'level2'],
      ['postscript', 5, 'Level1', 'level1'],
    ]);
  });

  it('SCR-6: given a form XObject and a PS name in a plain dictionary, when analyzed, then no scripts', async () => {
    const r = await analyze(
      doc('', '', (b) =>
        b.stream(4, '/Subtype /Form /BBox [0 0 1 1]', 'q Q').object(5, '<< /Subtype /PS >>'),
      ),
    );
    expect(r.scripts).toEqual([]);
  });
});

describe('objects nothing reaches', () => {
  it('SCR-7: given JavaScript dictionaries nested in arrays, in a compressed object, and an OnInstantiate, when analyzed, then each is unreached', async () => {
    const b = new PdfBuilder({ version: '1.5' })
      .object(1, '<< /Type /Catalog /Pages 2 0 R >>')
      .object(2, '<< /Type /Pages /Kids [] /Count 0 >>')
      .object(3, '<< /Junk [1 [<< /JS (deep()) >>]] >>')
      .stream(4, '/Subtype /U3D /OnInstantiate 5 0 R', 'U3D')
      .stream(5, '', 'three()')
      .objectStream(7, [{ num: 6, body: '<< /S /JavaScript /JS (packed()) >>' }])
      .xrefStream(8, { trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(brief(r)).toEqual([
      ['unreached', 3, 'deep()'],
      ['unreached', 4, 'three()'],
      ['unreached', 6, 'packed()'],
    ]);
  });

  it('SCR-8: given a reached JavaScript action that also holds an unreached one, when analyzed, then only the unreached one', async () => {
    const r = await analyze(
      doc('/OpenAction 4 0 R', '', (b) =>
        b.object(4, '<< /S /JavaScript /JS (seen()) /Other << /S /JavaScript /JS (unseen()) >> >>'),
      ),
    );
    expect(brief(r)).toEqual([['unreached', 4, 'unseen()']]);
  });

  it('SCR-8: given a file with no trailer, when analyzed, then no scripts', async () => {
    const b = new PdfBuilder().object(1, '<< /S /JavaScript /JS (x()) >>');
    const r = await analyze(b);
    expect(r.scripts).toEqual([]);
  });
});

describe('removed', () => {
  it('SCR-9: given an update that keeps the script, when analyzed, then nothing is removed', async () => {
    const b = doc('/OpenAction << /S /JavaScript /JS (kept()) >>', '');
    b.object(1, '<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (kept()) >> >>');
    b.xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(r.scripts).toEqual([]);
  });

  it('SCR-9: given a removed script whose stream is gone, when analyzed, then listed without a script', async () => {
    const b = doc('', '', (x) =>
      x.object(4, '<< /S /JavaScript /JS 5 0 R >>').stream(5, '', 'old()'),
    );
    b.object(4, '<< >>').object(5, 'null').xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(r.scripts).toEqual([
      { source: 'removed', language: 'JavaScript', automatic: false, object: 4, revision: 0 },
    ]);
  });
});

describe('cut walks, large copies, and joined packets', () => {
  it('SCR-8: given a walk cut short by the action limit, when analyzed, then the action it dropped is unchecked, not unreached', async () => {
    const r = await analyze(
      doc('/OpenAction 4 0 R /AA << /WC 5 0 R >>', '', (b) =>
        b.object(4, '<< /S /JavaScript /JS (a()) >>').object(5, '<< /S /JavaScript /JS (b()) >>'),
      ),
      { maxActions: 1 },
    );
    expect(brief(r)).toEqual([['unchecked', 5, 'b()']]);
    expect(scriptIds(r)).toEqual(['pdf.script.unchecked']);
  });

  it('SCR-7, SCR-9: given a newest copy too large for the object read that still holds JavaScript, when analyzed, then it is unreached and nothing is removed', async () => {
    const big = 'a'.repeat(70_000);
    const b = doc('', '', (x) => x.object(4, '<< /JS (old()) >>'));
    b.object(4, `<< /JS (${big}) >>`).xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(r.scripts.map((s) => [s.source, s.object, s.script?.byteLength])).toEqual([
      ['unreached', 4, 70_000],
    ]);
  });

  it('SCR-9: given a newest copy that cannot be read, when analyzed, then its older copy is not removed', async () => {
    const b = new PdfBuilder({ version: '1.5' })
      .object(1, '<< /Type /Catalog /Pages 2 0 R >>')
      .object(2, '<< /Type /Pages /Kids [] /Count 0 >>')
      .object(4, '<< /JS (old()) >>')
      .object(9, '<< /Filter /Standard >>')
      .xrefStream(10, { trailer: '/Root 1 0 R /Encrypt 9 0 R' })
      .objectStream(11, [{ num: 4, body: '<< >>' }])
      .xrefStream(12, { trailer: '/Root 1 0 R /Encrypt 9 0 R' });
    const r = await analyze(b);
    expect(r.scripts).toEqual([]);
  });

  it('SCR-9: given a removed script that refers to an object now holding something else, when analyzed, then no script text', async () => {
    const b = doc('', '', (x) => x.object(4, '<< /JS 5 0 R >>').stream(5, '', 'evil()'));
    b.object(4, '<< >>').stream(5, '', 'benign').xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(r.scripts).toEqual([
      { source: 'removed', language: 'JavaScript', automatic: false, object: 4, revision: 0 },
    ]);
  });

  it('SCR-3: given a script split across two packets, when analyzed, then it is listed with the packet where it starts', async () => {
    const r = await analyze(
      doc('/AcroForm << /Fields [] /XFA [(template) 4 0 R (rest) 5 0 R] >>', '', (b) =>
        b
          .stream(4, '', '<event activity="docReady"><script>app.')
          .stream(5, '', 'alert(1)</script></event>'),
      ),
    );
    expect(r.scripts.map((s) => [s.object, s.label, s.event, s.script?.text.text])).toEqual([
      [4, 'template', 'docReady', 'app.alert(1)'],
    ]);
  });

  it('SCR-4: given XFA the scan cannot finish, when analyzed, then pdf.xfa.incomplete', async () => {
    let xml = '';
    for (let i = 0; i < 20_000; i++) xml += `<a${i}:script>`;
    const r = await analyze(
      doc('/AcroForm << /Fields [] /XFA 4 0 R >>', '', (b) =>
        b.stream(4, '/Filter /FlateDecode', flate(xml)),
      ),
    );
    expect(scriptIds(r)).toEqual(['pdf.xfa', 'pdf.xfa.incomplete']);
  });
});

/** A raw cross-reference section with `entries` (each `n first-line`) and its tail. */
function rawSection(b: PdfBuilder, entries: string, trailer = '/Root 1 0 R') {
  const bytes = b.bytes();
  const text = new TextDecoder('latin1').decode(bytes);
  const prev = text.lastIndexOf('\nxref') + 1;
  const at = bytes.length;
  b.raw(
    `xref\n${entries}trailer\n<< /Size 20 /Prev ${prev} ${trailer} >>\nstartxref\n${at}\n%%EOF\n`,
  );
  return at;
}
const entry = (offset: number, generation: number, kind: 'n' | 'f') =>
  `${String(offset).padStart(10, '0')} ${String(generation).padStart(5, '0')} ${kind}\r\n`;

describe('large actions, freed objects, and shared streams', () => {
  it('RES-1, SCR-8: given an OpenAction to a JavaScript action larger than 64 KiB, when analyzed, then it is an action, not unreached', async () => {
    const big = 'x'.repeat(70_000);
    const r = await analyze(
      doc('/OpenAction 4 0 R', '', (b) => b.object(4, `<< /S /JavaScript /JS (${big}) >>`)),
    );
    expect(r.actions.map((a) => [a.type, a.automatic, a.script?.byteLength])).toEqual([
      ['JavaScript', true, 70_000],
    ]);
    expect(r.scripts).toEqual([]);
  });

  it('SCR-8: given a walk led to an object it cannot read, when analyzed, then other JavaScript is unchecked', async () => {
    const b = new PdfBuilder({ version: '1.5' })
      .object(1, '<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R >>')
      .object(2, '<< /Type /Pages /Kids [] /Count 0 >>')
      .object(4, '<< /JS (x()) >>')
      .object(5, '<< /Filter /Standard >>')
      .objectStream(7, [{ num: 6, body: '<< /S /JavaScript /JS (y()) >>' }])
      .xrefStream(8, { trailer: '/Root 1 0 R /Encrypt 5 0 R' });
    const r = await analyze(b);
    expect(r.scripts.map((s) => [s.source, s.object])).toEqual([['unchecked', 4]]);
  });

  it('SCR-9: given an update that frees the object holding JavaScript, when analyzed, then it is removed', async () => {
    const b = doc('', '', (x) => x.object(4, '<< /S /JavaScript /JS (gone()) >>'));
    rawSection(b, `4 1\n${entry(0, 1, 'f')}`);
    const r = await analyze(b);
    expect(r.scripts.map((s) => [s.source, s.object, s.revision])).toEqual([['removed', 4, 0]]);
  });

  it('SCR-9: given one older copy listed by two sections, when analyzed, then it is removed once, for the newest revision', async () => {
    const b = doc('', '', (x) => x.object(4, '<< /JS (old()) >>'));
    const at = rawSection(b, `4 1\n${entry(b.offsets.get(4) as number, 0, 'n')}`);
    b.object(4, '<< >>').xrefTable({ trailer: '/Root 1 0 R', prev: at });
    const r = await analyze(b);
    expect(r.revisions).toHaveLength(3);
    expect(r.scripts.map((s) => [s.source, s.object, s.revision])).toEqual([['removed', 4, 1]]);
  });

  it('SCR-6: given a Level1 stream shared by two XObjects that is itself PostScript, when analyzed, then it is listed once', async () => {
    const r = await analyze(
      doc('', '', (b) =>
        b
          .stream(4, '/Subtype /PS /Level1 6 0 R', 'a')
          .stream(5, '/Subtype /PS /Level1 6 0 R', 'b')
          .stream(6, '/Subtype /PS', 'c'),
      ),
    );
    expect(r.scripts.map((s) => [s.object, s.label])).toEqual([
      [4, undefined],
      [6, 'Level1'],
      [5, undefined],
    ]);
  });
});

describe('order and limits', () => {
  it('REP-11: given scripts of every source, when analyzed, then 3d, xfa, postscript, unreached, removed', async () => {
    const b = doc('/AcroForm << /Fields [] /XFA 6 0 R >>', '/Annots [4 0 R]', (x) =>
      x
        .object(4, '<< /Subtype /3D /Rect [0 0 1 1] /3DD 5 0 R >>')
        .stream(5, '/Subtype /U3D /OnInstantiate (i())', 'U3D')
        .stream(6, '', '<script>x()</script>')
        .stream(7, '/Subtype /PS', 'p')
        .object(8, '<< /JS (u()) >>')
        .object(9, '<< /JS (r()) >>'),
    );
    b.object(9, '<< >>').xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(r.scripts.map((s) => s.source)).toEqual([
      '3d',
      'xfa',
      'postscript',
      'unreached',
      'removed',
    ]);
  });

  it('SCR-10: given more scripts than the limit, when analyzed, then too-many-scripts and the rest are not listed', async () => {
    const r = await analyze(
      doc('', '', (b) => b.object(4, '<< /JS (a()) >>').object(5, '<< /JS (b()) >>')),
      { maxScripts: 1 },
    );
    expect(brief(r)).toEqual([['unreached', 4, 'a()']]);
    expect(scriptIds(r)).toEqual(['pdf.script.unreached', 'pdf.too-many-scripts']);
  });

  it('SCR-10: given an encrypted file, when analyzed, then script text is not decoded', async () => {
    const r = await analyze(
      doc(
        '',
        '',
        (b) => b.object(4, '<< /JS (a()) >>').object(5, '<< /Filter /Standard >>'),
        '/Encrypt 5 0 R',
      ),
    );
    expect(r.scripts).toEqual([
      {
        source: 'unreached',
        language: 'JavaScript',
        automatic: false,
        object: 4,
        script: { text: { text: null, truncated: false }, byteLength: 3 },
      },
    ]);
  });
});

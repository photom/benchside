import { bytesSource } from '@benchside/core';
import { describe, expect, it } from 'vitest';
import { analyzePdf, type Limits } from './analyze.ts';
import { PdfBuilder, simplePdf } from './test/build-pdf.ts';
import type { PdfReport } from './types.ts';

const analyze = (b: PdfBuilder, limits: Partial<Limits> = {}) =>
  analyzePdf(bytesSource(b.bytes()), { limits });
const ids = (r: PdfReport) => r.findings.map((f) => f.id);
const pages = (r: PdfReport) =>
  r.document?.pages.map((p) => [p.index, p.object, p.mediaBox, p.rotate]);
const letter = '[0 0 612 792]';

/** Catalog 1, page tree root 2 with `kids`, and the given objects; trailer Root 1. */
function tree(rootEntries: string, kids: string, objects: [number, string][], trailer = '') {
  const b = new PdfBuilder()
    .object(1, '<< /Type /Catalog /Pages 2 0 R >>')
    .object(2, `<< /Type /Pages /Kids [${kids}] ${rootEntries} >>`);
  for (const [n, body] of objects) b.object(n, body);
  return b.xrefTable({ trailer: `/Root 1 0 R ${trailer}` });
}

describe('page tree', () => {
  it('REQ-PDF-004: given three pages, when analyzed, then they are listed in order with their media boxes', async () => {
    const r = await analyze(
      tree('/Count 3', '3 0 R 4 0 R 5 0 R', [
        [3, `<< /Type /Page /Parent 2 0 R /MediaBox ${letter} >>`],
        [4, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'],
        [5, `<< /Type /Page /Parent 2 0 R /MediaBox ${letter} >>`],
      ]),
    );
    expect(r.findings).toEqual([]);
    expect(r.document?.pageCount).toBe(3);
    expect(pages(r)).toEqual([
      [0, 3, [0, 0, 612, 792], 0],
      [1, 4, [0, 0, 595, 842], 0],
      [2, 5, [0, 0, 612, 792], 0],
    ]);
  });

  it('PG-2, PG-5: given nested nodes, when analyzed, then depth-first order and inherited MediaBox and Rotate', async () => {
    const r = await analyze(
      tree(`/Count 3 /MediaBox ${letter}`, '3 0 R 6 0 R', [
        [3, '<< /Type /Pages /Parent 2 0 R /Kids [4 0 R 5 0 R] /Count 2 /Rotate 90 >>'],
        [4, '<< /Type /Page /Parent 3 0 R >>'],
        [5, '<< /Type /Page /Parent 3 0 R /Rotate 270 /MediaBox [0 0 10 10] >>'],
        [6, '<< /Type /Page /Parent 2 0 R >>'],
      ]),
    );
    expect(r.findings).toEqual([]);
    expect(pages(r)).toEqual([
      [0, 4, [0, 0, 612, 792], 90],
      [1, 5, [0, 0, 10, 10], 270],
      [2, 6, [0, 0, 612, 792], 0],
    ]);
  });

  it('REQ-PDF-004: given catalog, pages, and annotations in an object stream, when analyzed, then the same pages', async () => {
    const b = new PdfBuilder({ version: '1.5' })
      .objectStream(9, [
        { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
        { num: 2, body: `<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox ${letter} >>` },
        { num: 3, body: '<< /Type /Page /Parent 2 0 R /Annots [4 0 R] >>' },
        { num: 4, body: '<< /Type /Annot /Subtype /Text /Rect [0 0 1 1] >>' },
      ])
      .xrefStream(10, { trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(r.findings).toEqual([]);
    expect(pages(r)).toEqual([[0, 3, [0, 0, 612, 792], 0]]);
    expect(r.document?.pages[0]?.annotations).toEqual([{ object: 4, subtype: 'Text' }]);
  });

  it('PG-1: given a catalog without Pages, when analyzed, then pages.missing and no pages', async () => {
    const b = new PdfBuilder()
      .object(1, '<< /Type /Catalog >>')
      .xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(ids(r)).toEqual(['pdf.pages.missing']);
    expect(r.document?.pages).toEqual([]);
  });

  it('PG-3: given a kid of another type, when analyzed, then pages.kid and it is read as a page', async () => {
    const r = await analyze(
      tree(`/Count 1 /MediaBox ${letter}`, '3 0 R', [[3, '<< /Type /Annot >>']]),
    );
    expect(ids(r)).toEqual(['pdf.pages.kid']);
    expect(pages(r)).toHaveLength(1);
  });

  it('PG-3: given a kid that is not a dictionary, when analyzed, then pages.kid and it is skipped', async () => {
    const r = await analyze(
      tree(`/Count 1 /MediaBox ${letter}`, '3 0 R 9 0 R', [[3, '<< /Type /Page >>']]),
    );
    expect(ids(r)).toEqual(['pdf.pages.kid']);
    expect(pages(r)).toHaveLength(1);
  });

  it('PG-4: given a node whose Kids point back to the root, when analyzed, then pages.loop and the walk ends', async () => {
    const r = await analyze(
      tree(`/Count 2 /MediaBox ${letter}`, '3 0 R 4 0 R', [
        [3, '<< /Type /Page >>'],
        [4, '<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 1 >>'],
      ]),
    );
    expect(ids(r)).toEqual(['pdf.pages.loop', 'pdf.pages.loop', 'pdf.pages.count']);
    expect(pages(r)).toHaveLength(1);
  });

  it('PG-4: given nodes nested deeper than 64, when analyzed, then tree.limit', async () => {
    const objects: [number, string][] = [];
    for (let n = 3; n < 73; n++) objects.push([n, `<< /Type /Pages /Kids [${n + 1} 0 R] >>`]);
    objects.push([73, '<< /Type /Page >>']);
    const r = await analyze(tree(`/MediaBox ${letter}`, '3 0 R', objects));
    expect(ids(r)).toContain('pdf.tree.limit');
    expect(pages(r)).toEqual([]);
  });

  it('PG-6: given no MediaBox anywhere, when analyzed, then page.mediabox and null', async () => {
    const r = await analyze(
      tree('/Count 1', '3 0 R', [[3, '<< /Type /Page /CropBox [1 1 5 5] >>']]),
    );
    expect(ids(r)).toEqual(['pdf.page.mediabox']);
    expect(r.document?.pages[0]).toMatchObject({
      mediaBox: null,
      cropBox: [1, 1, 5, 5],
      rotate: 0,
    });
  });

  it('PG-6: given no CropBox, when analyzed, then the crop box is the media box', async () => {
    const r = await analyze(
      tree(`/Count 1 /MediaBox ${letter}`, '3 0 R', [[3, '<< /Type /Page >>']]),
    );
    expect(r.document?.pages[0]?.cropBox).toEqual([0, 0, 612, 792]);
  });

  it('OST-6, CAT-1, PG-3: given an encrypted file with its catalog and pages compressed, when analyzed, then no catalog or page findings', async () => {
    const b = new PdfBuilder({ version: '1.5' })
      .objectStream(9, [
        { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
        { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
        { num: 3, body: '<< /Type /Page >>' },
      ])
      .object(4, '<< /Filter /Standard >>')
      .xrefStream(10, { trailer: '/Root 1 0 R /Encrypt 4 0 R /ID [<00> <00>]' });
    const r = await analyze(b);
    expect(ids(r)).toEqual(['pdf.encrypted']);
    expect(r.document?.catalog).toBeNull();
  });

  it('OST-6, PG-3, PG-7: given an encrypted file with compressed pages under a plain root, when analyzed, then no kid or count findings', async () => {
    const b = new PdfBuilder({ version: '1.5' })
      .object(1, '<< /Type /Catalog /Pages 2 0 R >>')
      .object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 1 1] >>')
      .objectStream(9, [{ num: 3, body: '<< /Type /Page >>' }])
      .object(4, '<< /Filter /Standard >>')
      .xrefStream(10, { trailer: '/Root 1 0 R /Encrypt 4 0 R /ID [<00> <00>]' });
    const r = await analyze(b);
    expect(ids(r)).toEqual(['pdf.encrypted']);
  });

  it('PG-7: given a Count that differs from the pages found, when analyzed, then pages.count', async () => {
    const r = await analyze(
      tree(`/Count 5 /MediaBox ${letter}`, '3 0 R', [[3, '<< /Type /Page >>']]),
    );
    expect(ids(r)).toEqual(['pdf.pages.count']);
    expect(r.document?.pageCount).toBe(5);
  });

  it('PG-8: given more pages than the limit, when analyzed, then tree.limit and the rest are not listed', async () => {
    const r = await analyze(
      tree(`/Count 3 /MediaBox ${letter}`, '3 0 R 4 0 R 5 0 R', [
        [3, '<< /Type /Page >>'],
        [4, '<< /Type /Page >>'],
        [5, '<< /Type /Page >>'],
      ]),
      { maxPages: 1 },
    );
    expect(ids(r)).toContain('pdf.tree.limit');
    expect(pages(r)).toHaveLength(1);
  });
});

describe('annotations', () => {
  it('ANN-1: given Annots, when analyzed, then each subtype, and entries that are not dictionaries are skipped', async () => {
    const r = await analyze(
      tree(`/Count 1 /MediaBox ${letter}`, '3 0 R', [
        [3, '<< /Type /Page /Annots [4 0 R << /Subtype /Link >> 9 0 R 5] >>'],
        [4, '<< /Type /Annot /Subtype /Widget >>'],
      ]),
    );
    expect(r.findings).toEqual([]);
    expect(r.document?.pages[0]?.annotations).toEqual([
      { object: 4, subtype: 'Widget' },
      { object: null, subtype: 'Link' },
    ]);
  });

  it('ANN-2: given more annotations than the limit, when analyzed, then tree.limit and the rest are not read', async () => {
    const r = await analyze(
      tree(`/Count 1 /MediaBox ${letter}`, '3 0 R', [
        [3, '<< /Type /Page /Annots [<< /Subtype /Link >> << /Subtype /Text >>] >>'],
      ]),
      { maxAnnotations: 1 },
    );
    expect(ids(r)).toEqual(['pdf.tree.limit']);
    expect(r.document?.pages[0]?.annotations).toHaveLength(1);
  });
});

describe('catalog', () => {
  it('CAT-1: given a Root that is not a dictionary, when analyzed, then catalog.missing and no pages', async () => {
    const b = new PdfBuilder().object(1, '[1 2]').xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(ids(r)).toEqual(['pdf.catalog.missing']);
    expect(r.document).toMatchObject({ catalog: null, pages: [] });
  });

  it('CAT-1: given no Root, when analyzed, then only trailer.root', async () => {
    const r = await analyze(new PdfBuilder().object(1, '<< >>').xrefTable());
    expect(ids(r)).toEqual(['pdf.trailer.root']);
  });

  it('CAT-2: given a catalog of another Type, when analyzed, then catalog.type and reading goes on', async () => {
    const b = new PdfBuilder()
      .object(1, '<< /Type /Pages /Pages 2 0 R >>')
      .object(2, '<< /Type /Pages /Kids [] /Count 0 >>')
      .xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(ids(r)).toEqual(['pdf.catalog.type']);
    expect(r.document?.pageCount).toBe(0);
  });

  it('CAT-3: given catalog entries, when analyzed, then Version, PageLayout, PageMode, Lang, and the keys', async () => {
    const b = new PdfBuilder()
      .object(
        1,
        '<< /Type /Catalog /Version /1.7 /Pages 2 0 R /PageLayout /TwoColumnLeft /PageMode /UseOutlines /Lang (en-US) >>',
      )
      .object(2, '<< /Type /Pages /Kids [] /Count 0 >>')
      .xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b);
    expect(r.document?.catalog).toEqual({
      object: 1,
      version: '1.7',
      pageLayout: 'TwoColumnLeft',
      pageMode: 'UseOutlines',
      lang: { text: 'en-US', truncated: false },
      keys: ['Type', 'Version', 'Pages', 'PageLayout', 'PageMode', 'Lang'],
    });
  });

  it('REP-8: given no trailer, when analyzed, then no document', async () => {
    const b = new PdfBuilder().object(1, '<< >>').xrefTable({ noTail: true });
    expect((await analyze(b)).document).toBeNull();
  });
});

describe('document information', () => {
  it('INF-2: given Info entries, when analyzed, then text, names, and other values in file order', async () => {
    const b = simplePdf();
    b.object(4, '<< /Title <FEFF00480069> /Author (A\\225b) /Trapped /False /Pages 3 >>');
    b.xrefTable({ trailer: '/Root 1 0 R /Info 4 0 R' });
    const r = await analyze(b);
    expect(r.document?.info).toEqual({
      object: 4,
      entries: [
        { key: 'Title', kind: 'text', value: { text: 'Hi', truncated: false } },
        {
          key: 'Author',
          kind: 'text',
          value: { text: `A${String.fromCharCode(0x0141)}b`, truncated: false },
        },
        { key: 'Trapped', kind: 'name', value: { text: 'False', truncated: false } },
        { key: 'Pages', kind: 'other', value: { text: 'number 3', truncated: false } },
      ],
    });
  });

  it('INF-1: given an Info that is not a dictionary, when analyzed, then info.invalid', async () => {
    const b = simplePdf();
    b.object(4, '(x)').xrefTable({ trailer: '/Root 1 0 R /Info 4 0 R' });
    const r = await analyze(b);
    expect(ids(r)).toEqual(['pdf.info.invalid']);
    expect(r.document?.info).toBeNull();
  });

  it('TXT-4: given an encrypted file, when analyzed, then Info text is not decoded', async () => {
    const b = simplePdf();
    b.object(4, '<< /Title (secret) >>').object(5, '<< /Filter /Standard >>');
    b.xrefTable({ trailer: '/Root 1 0 R /Info 4 0 R /Encrypt 5 0 R' });
    const r = await analyze(b);
    expect(r.document?.info?.entries).toEqual([
      { key: 'Title', kind: 'text', value: { text: null, truncated: false } },
    ]);
  });
});

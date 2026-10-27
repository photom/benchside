import { bytesSource } from '@benchside/core';
import { describe, expect, it } from 'vitest';
import { analyzePdf } from './analyze.ts';
import { EOL, latin1, PdfBuilder, simplePdf } from './test/build-pdf.ts';
import type { PdfReport } from './types.ts';

const LF = String.fromCharCode(10);
const analyze = (bytes: Uint8Array, limits = {}) => analyzePdf(bytesSource(bytes), { limits });
const ids = (r: PdfReport) => r.findings.map((f) => f.id);
const obj = (r: PdfReport, n: number) => r.objects.find((o) => o.number === n);
const kinds = (r: PdfReport) => r.regions.map((g) => [g.kind, g.offset, g.byteLength]);
const catalog = '<< /Type /Catalog /Pages 2 0 R >>';

describe('a well-formed file', () => {
  it('REQ-PDF-002: given a one-revision PDF, when analyzed, then the header, one revision, and every object, with no findings', async () => {
    const b = simplePdf();
    const r = await analyze(b.bytes());
    expect(r.findings).toEqual([]);
    expect(r.header).toEqual({ offset: 0, version: '1.7', binaryMarker: false });
    expect(r.revisions).toMatchObject([
      { index: 0, offset: b.sections[0], kind: 'table', entryCount: 4 },
    ]);
    expect(r.trailer).toMatchObject({ size: 4, root: { number: 1, generation: 0 }, prev: null });
    expect(r.objects.map((o) => [o.number, o.status, o.offset, o.type])).toEqual([
      [1, 'in-use', b.offsets.get(1), 'Catalog'],
      [2, 'in-use', b.offsets.get(2), 'Pages'],
      [3, 'in-use', b.offsets.get(3), 'Page'],
    ]);
  });
});

describe('header', () => {
  it('HDR-1: given bytes before the header, when analyzed, then header.offset and a prepended region', async () => {
    const r = await analyze(simplePdf({ prepend: 'junk' }).bytes());
    expect(r.header?.offset).toBe(4);
    expect(ids(r)).toContain('pdf.header.offset');
    expect(r.regions[0]).toEqual({ kind: 'prepended', offset: 0, byteLength: 4 });
  });

  it('HDR-1: given no header, when analyzed, then header.missing and the objects are still read', async () => {
    const r = await analyze(simplePdf({ version: null }).bytes());
    expect(r.header).toBeNull();
    expect(ids(r)).toEqual(['pdf.header.missing']);
    expect(r.objects).toHaveLength(3);
  });

  it('HDR-2: given version 2.0, when analyzed, then header.version and the version as written', async () => {
    const r = await analyze(simplePdf({ version: '2.0' }).bytes());
    expect(r.header?.version).toBe('2.0');
    expect(ids(r)).toEqual(['pdf.header.version']);
  });

  it('HDR-3: given a binary comment line, when analyzed, then the binary marker is reported', async () => {
    expect((await analyze(simplePdf({ binary: true }).bytes())).header?.binaryMarker).toBe(true);
  });
});

describe('startxref and %%EOF', () => {
  it('EOF-2: given no startxref, when analyzed, then startxref.missing, no revisions, and an unknown region', async () => {
    const b = new PdfBuilder()
      .object(1, catalog)
      .xrefTable({ trailer: '/Root 1 0 R', noTail: true });
    const r = await analyze(b.bytes());
    expect(ids(r)).toEqual(['pdf.startxref.missing']);
    expect(r.revisions).toEqual([]);
    expect(r.regions.map((g) => g.kind)).toEqual(['header', 'unknown']);
  });

  it('EOF-3: given no %%EOF, when analyzed, then eof.missing and the file is still read', async () => {
    const b = new PdfBuilder()
      .object(1, catalog)
      .xrefTable({ trailer: '/Root 1 0 R', noTail: true });
    b.raw(`startxref${LF}${b.sections[0]}${LF}`);
    const r = await analyze(b.bytes());
    expect(ids(r)).toEqual(['pdf.eof.missing']);
    expect(r.objects).toHaveLength(1);
  });

  it('EOF-3: given bytes after %%EOF, when analyzed, then a trailing region and eof.trailing', async () => {
    const b = simplePdf().raw('appended data');
    const bytes = b.bytes();
    const r = await analyze(bytes);
    expect(ids(r)).toEqual(['pdf.eof.trailing']);
    expect(r.regions.at(-1)).toEqual({
      kind: 'trailing',
      offset: bytes.length - 13,
      byteLength: 13,
    });
  });

  it('EOF-3: given only white space after %%EOF, when analyzed, then no finding', async () => {
    expect(ids(await analyze(simplePdf().raw(`${LF}${LF}  `).bytes()))).toEqual([]);
  });
});

describe('cross-reference tables', () => {
  it('XREF-1: given a startxref offset where no section is, when analyzed, then xref.not-found', async () => {
    // Offset 3 is inside the header line.
    const b = new PdfBuilder()
      .object(1, catalog)
      .xrefTable({ trailer: '/Root 1 0 R', startxref: 3 });
    expect(ids(await analyze(b.bytes()))).toContain('pdf.xref.not-found');
  });

  it('XREF-1: given a startxref offset past the end, when analyzed, then xref.out-of-range', async () => {
    const b = new PdfBuilder()
      .object(1, catalog)
      .xrefTable({ trailer: '/Root 1 0 R', startxref: 99999 });
    expect(ids(await analyze(b.bytes()))).toContain('pdf.xref.out-of-range');
  });

  it('XREF-3: given 19-byte entries, when analyzed, then one xref.entry-format and the objects are read', async () => {
    const b = new PdfBuilder()
      .object(1, catalog)
      .object(2, '<< /Type /Pages >>')
      .xrefTable({ trailer: '/Root 1 0 R', eol: EOL.LF });
    const r = await analyze(b.bytes());
    expect(ids(r)).toEqual(['pdf.xref.entry-format']);
    expect(r.objects.map((o) => o.offset)).toEqual([b.offsets.get(1), b.offsets.get(2)]);
  });

  it('XREF-4: given an object number twice in one section, when analyzed, then duplicate-entry and the first is used', async () => {
    const b = new PdfBuilder().object(1, catalog);
    const at = b.offset;
    const e = (o: number, g: number, k: string) =>
      `${String(o).padStart(10, '0')} ${String(g).padStart(5, '0')} ${k}${EOL.CRLF}`;
    b.raw(
      `xref${LF}0 2${LF}${e(0, 65535, 'f')}${e(b.offsets.get(1) as number, 0, 'n')}1 1${LF}${e(5, 0, 'n')}`,
    );
    b.raw(`trailer${LF}<< /Size 2 /Root 1 0 R >>${LF}startxref${LF}${at}${LF}%%EOF${LF}`);
    const r = await analyze(b.bytes());
    expect(ids(r)).toEqual(['pdf.xref.duplicate-entry']);
    expect(obj(r, 1)?.offset).toBe(b.offsets.get(1));
  });

  it('XREF-5: given object 0 in use in the oldest section, when analyzed, then xref.first-entry', async () => {
    const b = new PdfBuilder().object(1, catalog);
    const at = b.offset;
    const e = (o: number, g: number, k: string) =>
      `${String(o).padStart(10, '0')} ${String(g).padStart(5, '0')} ${k}${EOL.CRLF}`;
    b.raw(`xref${LF}0 2${LF}${e(0, 0, 'f')}${e(b.offsets.get(1) as number, 0, 'n')}`);
    b.raw(`trailer${LF}<< /Size 2 /Root 1 0 R >>${LF}startxref${LF}${at}${LF}%%EOF${LF}`);
    expect(ids(await analyze(b.bytes()))).toEqual(['pdf.xref.first-entry']);
  });
});

describe('trailers', () => {
  it('TRL-1: given no trailer after the table, when analyzed, then trailer.missing and the entries are used', async () => {
    const b = new PdfBuilder().object(1, catalog).xrefTable({ noTrailer: true });
    const r = await analyze(b.bytes());
    expect(ids(r)).toContain('pdf.trailer.missing');
    expect(r.objects).toHaveLength(1);
  });

  it('TRL-2: given trailer entries, when analyzed, then Size, Root, Info, ID, and Encrypt are read', async () => {
    const b = new PdfBuilder()
      .object(1, catalog)
      .object(2, '<< /Producer (x) >>')
      .object(3, '<< /Filter /Standard >>')
      .xrefTable({ trailer: '/Root 1 0 R /Info 2 0 R /Encrypt 3 0 R /ID [<0a0b> <0c0d>]' });
    const r = await analyze(b.bytes());
    expect(r.trailer).toEqual({
      size: 4,
      prev: null,
      root: { number: 1, generation: 0 },
      info: { number: 2, generation: 0 },
      encrypt: true,
      id: ['0a0b', '0c0d'],
      xrefStm: null,
    });
  });

  it('TRL-2: given no Root in the newest trailer, when analyzed, then trailer.root', async () => {
    const b = new PdfBuilder().object(1, catalog).xrefTable();
    expect(ids(await analyze(b.bytes()))).toEqual(['pdf.trailer.root']);
  });

  it('OBX-4: given Encrypt in the trailer, when analyzed, then encrypted and pdf.encrypted', async () => {
    const b = new PdfBuilder()
      .object(1, catalog)
      .object(2, '<< /Filter /Standard >>')
      .xrefTable({ trailer: '/Root 1 0 R /Encrypt 2 0 R /ID [<00> <00>]' });
    const r = await analyze(b.bytes());
    expect(r.encrypted).toBe(true);
    expect(ids(r)).toEqual(['pdf.encrypted']);
  });
});

describe('cross-reference streams', () => {
  it('XST-1, XST-2, XST-4: given a Flate-encoded cross-reference stream, when analyzed, then its entries', async () => {
    const b = new PdfBuilder({ version: '1.5' })
      .object(1, catalog)
      .object(2, '<< /Type /Pages >>')
      .xrefStream(3, { trailer: '/Root 1 0 R' });
    const r = await analyze(b.bytes());
    expect(r.findings).toEqual([]);
    expect(r.revisions).toMatchObject([{ kind: 'stream', offset: b.sections[0] }]);
    expect(r.objects.map((o) => [o.number, o.offset, o.type])).toEqual([
      [1, b.offsets.get(1), 'Catalog'],
      [2, b.offsets.get(2), 'Pages'],
      [3, b.offsets.get(3), 'XRef'],
    ]);
    expect(r.regions.find((g) => g.object === 3)?.kind).toBe('xref-stream');
  });

  it('XST-3: given a PNG Up predictor, when analyzed, then the entries are decoded', async () => {
    const b = new PdfBuilder({ version: '1.5' })
      .object(1, catalog)
      .xrefStream(2, { trailer: '/Root 1 0 R', predictor: true });
    const r = await analyze(b.bytes());
    expect(r.findings).toEqual([]);
    expect(obj(r, 1)?.offset).toBe(b.offsets.get(1));
  });

  it('XST-4, OBX-3: given compressed objects, when analyzed, then their object stream and index', async () => {
    const b = new PdfBuilder({ version: '1.5' })
      .objectStream(5, [
        { num: 1, body: catalog },
        { num: 2, body: '<< /Type /Pages >>' },
      ])
      .xrefStream(6, { trailer: '/Root 1 0 R' });
    const r = await analyze(b.bytes());
    expect(r.findings).toEqual([]);
    expect([obj(r, 1), obj(r, 2)].map((o) => [o?.status, o?.container, o?.index])).toEqual([
      ['compressed', 5, 0],
      ['compressed', 5, 1],
    ]);
    expect(obj(r, 5)?.type).toBe('ObjStm');
  });

  it('XST-1: given no W, when analyzed, then xref-stream.dict', async () => {
    const b = new PdfBuilder().object(1, catalog);
    const at = b.offset;
    b.raw(
      `2 0 obj${LF}<< /Type /XRef /Size 3 /Length 0 /Root 1 0 R >>${LF}stream${EOL.CRLF}${LF}endstream${LF}endobj${LF}`,
    );
    b.raw(`startxref${LF}${at}${LF}%%EOF${LF}`);
    expect(ids(await analyze(b.bytes()))).toContain('pdf.xref-stream.dict');
  });

  it('XST-2: given an unsupported filter, when analyzed, then xref-stream.filter', async () => {
    const b = new PdfBuilder().object(1, catalog);
    const at = b.offset;
    b.raw(
      `2 0 obj${LF}<< /Type /XRef /Size 3 /W [1 2 1] /Length 1 /Filter /LZWDecode /Root 1 0 R >>${LF}stream${EOL.CRLF}x${LF}endstream${LF}endobj${LF}`,
    );
    b.raw(`startxref${LF}${at}${LF}%%EOF${LF}`);
    expect(ids(await analyze(b.bytes()))).toContain('pdf.xref-stream.filter');
  });

  it('XST-2: given Flate data that does not decode, when analyzed, then xref-stream.decode', async () => {
    const b = new PdfBuilder().object(1, catalog);
    const at = b.offset;
    b.raw(
      `2 0 obj${LF}<< /Type /XRef /Size 3 /W [1 2 1] /Length 3 /Filter /FlateDecode /Root 1 0 R >>${LF}stream${EOL.CRLF}xyz${LF}endstream${LF}endobj${LF}`,
    );
    b.raw(`startxref${LF}${at}${LF}%%EOF${LF}`);
    expect(ids(await analyze(b.bytes()))).toContain('pdf.xref-stream.decode');
  });

  it('XST-5: given data shorter than Index declares, when analyzed, then xref-stream.short and the whole entries', async () => {
    const b = new PdfBuilder().object(1, catalog);
    const at = b.offset;
    const off = b.offsets.get(1) as number;
    // Two whole entries (free 0, in use 1) where Index declares five.
    const data = latin1(String.fromCharCode(0, 0, 0, 0xff, 1, off >> 8, off & 0xff, 0));
    b.raw(
      `2 0 obj${LF}<< /Type /XRef /Size 5 /W [1 2 1] /Index [0 5] /Length ${data.length} /Root 1 0 R >>${LF}stream${EOL.CRLF}`,
    );
    b.raw(data).raw(`${LF}endstream${LF}endobj${LF}startxref${LF}${at}${LF}%%EOF${LF}`);
    const r = await analyze(b.bytes());
    expect(ids(r)).toContain('pdf.xref-stream.short');
    expect(obj(r, 1)?.offset).toBe(off);
  });
});

describe('revisions', () => {
  it('REV-1, REV-4: given one incremental update, when analyzed, then two revisions, newest first, and the replaced object', async () => {
    const b = simplePdf();
    b.object(3, '<< /Type /Page /Parent 2 0 R /Rotate 90 >>').object(4, '<< /Type /Annot >>');
    b.xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b.bytes());
    expect(r.findings).toEqual([]);
    expect(r.revisions.map((v) => [v.index, v.offset])).toEqual([
      [1, b.sections[1]],
      [0, b.sections[0]],
    ]);
    expect(r.trailer?.prev).toBe(b.sections[0]);
    expect([1, 3, 4].map((n) => [obj(r, n)?.revision, obj(r, n)?.replaced])).toEqual([
      [0, []],
      [1, [0]],
      [1, []],
    ]);
    expect(obj(r, 3)?.offset).toBe(b.offsets.get(3));
  });

  it('REV-2: given a hybrid file with XRefStm, when analyzed, then the stream entries count in the table revision', async () => {
    const b = simplePdf();
    b.objectStream(5, [{ num: 4, body: '<< /Type /StructTreeRoot >>' }]);
    b.xrefStream(6, { trailer: '', noTail: true, prev: null });
    const stm = b.sections.at(-1) as number;
    b.sections.pop();
    b.xrefTable({ trailer: `/Root 1 0 R /XRefStm ${stm}` });
    const r = await analyze(b.bytes());
    expect(r.findings).toEqual([]);
    expect(r.revisions[0]).toMatchObject({ index: 1, kind: 'table', xrefStm: stm });
    expect(obj(r, 4)).toMatchObject({ status: 'compressed', container: 5, revision: 1 });
  });

  it('REV-3: given a Prev that points back to itself, when analyzed, then xref.loop', async () => {
    const b = new PdfBuilder().object(1, catalog);
    b.xrefTable({ trailer: '/Root 1 0 R', prev: 0 });
    const bytes = b.bytes();
    const at = b.sections[0] as number;
    const fixed = latin1(String.fromCharCode(...bytes).replace('/Prev 0', `/Prev ${at}`.padEnd(7)));
    expect(ids(await analyze(fixed))).toContain('pdf.xref.loop');
  });

  it('REV-3: given more sections than the limit, when analyzed, then xref.too-many-sections', async () => {
    const b = simplePdf();
    b.object(4, '<< >>').xrefTable({ trailer: '/Root 1 0 R' });
    b.object(5, '<< >>').xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b.bytes(), { maxSections: 2 });
    expect(ids(r)).toContain('pdf.xref.too-many-sections');
    expect(r.revisions).toHaveLength(2);
  });

  it('REV-5: given an entry at or above Size, when analyzed, then trailer.size and it is ignored', async () => {
    const b = new PdfBuilder()
      .object(1, catalog)
      .object(2, '<< >>')
      .xrefTable({ trailer: '/Root 1 0 R', size: 2 });
    const r = await analyze(b.bytes());
    // The ignored object's bytes are covered by no region (MAP-2).
    expect(ids(r)).toEqual(['pdf.trailer.size', 'pdf.gap']);
    expect(r.objects.map((o) => o.number)).toEqual([1]);
  });
});

describe('objects', () => {
  it('OBX-1: given an entry pointing at the wrong bytes, when analyzed, then object.header-mismatch', async () => {
    const b = simplePdf();
    const bytes = b.bytes();
    const text = String.fromCharCode(...bytes);
    const entry = `${String(b.offsets.get(2)).padStart(10, '0')} 00000 n`;
    const wrong = `${String((b.offsets.get(2) as number) + 1).padStart(10, '0')} 00000 n`;
    const r = await analyze(latin1(text.replace(entry, wrong)));
    expect(r.findings).toMatchObject([
      { id: 'pdf.object.header-mismatch', object: 2 },
      { id: 'pdf.gap' },
    ]);
  });

  it('OBX-1: given an entry offset past the end, when analyzed, then object.out-of-range', async () => {
    const b = simplePdf();
    const text = String.fromCharCode(...b.bytes());
    const entry = `${String(b.offsets.get(3)).padStart(10, '0')} 00000 n`;
    const r = await analyze(latin1(text.replace(entry, '0009999999 00000 n')));
    expect(ids(r)).toEqual(['pdf.object.out-of-range', 'pdf.gap']);
  });

  it('OBX-2, IND-3: given a Flate stream, when analyzed, then its data offset, length, and filters', async () => {
    const b = new PdfBuilder().object(1, catalog).stream(2, '/Filter /FlateDecode', 'abcdef');
    b.xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b.bytes());
    expect(r.findings).toEqual([]);
    const start = String.fromCharCode(...b.bytes()).indexOf('stream', b.offsets.get(2)) + 8;
    expect(obj(r, 2)?.stream).toEqual({
      dataOffset: start,
      byteLength: 6,
      filters: ['FlateDecode'],
    });
  });

  it('IND-3: given a Length that is a reference, when analyzed, then it is followed', async () => {
    const b = new PdfBuilder()
      .object(1, catalog)
      .stream(2, '', 'abcdef', { length: '3 0 R' })
      .object(3, '6');
    b.xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b.bytes());
    expect(r.findings).toEqual([]);
    expect(obj(r, 2)?.stream?.byteLength).toBe(6);
  });

  it('IND-4: given a wrong Length, when analyzed, then stream.length and the length found by endstream', async () => {
    const b = new PdfBuilder().object(1, catalog).stream(2, '', 'abcdef', { length: '2' });
    b.xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b.bytes());
    expect(r.findings).toMatchObject([{ id: 'pdf.stream.length', object: 2 }]);
    expect(obj(r, 2)?.stream?.byteLength).toBe(6);
  });

  it('IND-2: given CR alone after stream, when analyzed, then stream.eol', async () => {
    const b = new PdfBuilder().object(1, catalog).stream(2, '', 'abc', { eol: EOL.CR });
    b.xrefTable({ trailer: '/Root 1 0 R' });
    expect(ids(await analyze(b.bytes()))).toEqual(['pdf.stream.eol']);
  });

  it('IND-5: given no endobj, when analyzed, then object.endobj-missing', async () => {
    const b = new PdfBuilder().object(1, catalog);
    b.offsets.set(2, b.offset);
    b.raw(`2 0 obj${LF}<< /Type /Pages >>${LF}`);
    const at = b.offset;
    const e = (o: number, g: number, k: string) =>
      `${String(o).padStart(10, '0')} ${String(g).padStart(5, '0')} ${k}${EOL.CRLF}`;
    b.raw(
      `xref${LF}0 3${LF}${e(0, 65535, 'f')}${e(b.offsets.get(1) as number, 0, 'n')}${e(b.offsets.get(2) as number, 0, 'n')}`,
    );
    b.raw(`trailer${LF}<< /Size 3 /Root 1 0 R >>${LF}startxref${LF}${at}${LF}%%EOF${LF}`);
    expect(ids(await analyze(b.bytes()))).toEqual(['pdf.object.endobj-missing']);
  });

  it('REP-3: given a free entry that wins, when analyzed, then the object is listed as free', async () => {
    const b = simplePdf();
    const at = b.offset;
    b.raw(
      `xref${LF}3 1${LF}0000000000 00001 f${EOL.CRLF}trailer${LF}<< /Size 4 /Prev ${b.sections[0]} /Root 1 0 R >>${LF}`,
    );
    b.raw(`startxref${LF}${at}${LF}%%EOF${LF}`);
    const r = await analyze(b.bytes());
    expect(obj(r, 3)).toMatchObject({ status: 'free', generation: 1, revision: 1, replaced: [0] });
  });

  it('limits: given more objects than the limit, when analyzed, then too-many-objects', async () => {
    const r = await analyze(simplePdf().bytes(), { maxObjects: 2 });
    expect(ids(r)).toContain('pdf.too-many-objects');
    expect(r.objects).toHaveLength(2);
  });
});

describe('byte map', () => {
  it('MAP-1: given a one-revision PDF, when analyzed, then header, objects, table, trailer, and startxref in order', async () => {
    const b = simplePdf();
    const r = await analyze(b.bytes());
    expect(r.regions.map((g) => [g.kind, g.offset, g.object])).toEqual([
      ['header', 0, undefined],
      ['object', b.offsets.get(1), 1],
      ['object', b.offsets.get(2), 2],
      ['object', b.offsets.get(3), 3],
      ['xref-table', b.sections[0], undefined],
      ['trailer', expect.any(Number), undefined],
      ['startxref', expect.any(Number), undefined],
    ]);
  });

  it('MAP-1: given an incremental update, when analyzed, then a startxref region after each section', async () => {
    const b = simplePdf();
    b.object(4, '<< >>').xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b.bytes());
    expect(r.regions.filter((g) => g.kind === 'startxref')).toHaveLength(2);
    expect(ids(r)).toEqual([]);
  });

  it('MAP-2: given junk between objects, when analyzed, then a gap region and pdf.gap', async () => {
    const b = new PdfBuilder().object(1, catalog);
    const at = b.offset;
    b.raw('garbage here');
    b.object(2, '<< /Type /Pages >>').xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b.bytes());
    expect(ids(r)).toEqual(['pdf.gap']);
    expect(r.regions).toContainEqual({ kind: 'gap', offset: at, byteLength: 12 });
  });

  it('MAP-3: given an object found inside another, when analyzed, then pdf.overlap', async () => {
    const b = new PdfBuilder().object(1, '(2 0 obj (x) endobj)');
    const inner = (b.offsets.get(1) as number) + 9;
    const at = b.offset;
    const e = (o: number, g: number, k: string) =>
      `${String(o).padStart(10, '0')} ${String(g).padStart(5, '0')} ${k}${EOL.CRLF}`;
    b.raw(
      `xref${LF}0 3${LF}${e(0, 65535, 'f')}${e(b.offsets.get(1) as number, 0, 'n')}${e(inner, 0, 'n')}`,
    );
    b.raw(`trailer${LF}<< /Size 3 /Root 1 0 R >>${LF}startxref${LF}${at}${LF}%%EOF${LF}`);
    expect(kinds(await analyze(b.bytes())).length).toBeGreaterThan(0);
    expect(ids(await analyze(b.bytes()))).toContain('pdf.overlap');
  });
});

describe('review fixes', () => {
  it('MAP-2, REQ-PDF-003: given a 60 KiB blank run before junk, when analyzed, then the gap is found quickly', async () => {
    const b = new PdfBuilder().object(1, catalog);
    const at = b.offset;
    b.raw(`${' '.repeat(60_000)}junk`);
    b.object(2, '<< >>').xrefTable({ trailer: '/Root 1 0 R' });
    const started = Date.now();
    const r = await analyze(b.bytes());
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.regions).toContainEqual({ kind: 'gap', offset: at + 60_000, byteLength: 4 });
  });

  it('IND-3: given streams sharing a Length object without endobj, when analyzed, then its finding appears once', async () => {
    const b = new PdfBuilder().object(1, catalog);
    for (let n = 2; n <= 4; n++) b.stream(n, '', 'abc', { length: '9 0 R' });
    b.offsets.set(9, b.offset);
    b.raw(`9 0 obj${LF}3${LF}`);
    const at = b.offset;
    const e = (o: number) => `${String(o).padStart(10, '0')} 00000 n${EOL.CRLF}`;
    let table = `xref${LF}0 10${LF}0000000000 65535 f${EOL.CRLF}`;
    for (let n = 1; n <= 9; n++)
      table += b.offsets.has(n) ? e(b.offsets.get(n) as number) : `0000000000 00000 f${EOL.CRLF}`;
    b.raw(`${table}trailer${LF}<< /Size 10 /Root 1 0 R >>${LF}startxref${LF}${at}${LF}%%EOF${LF}`);
    const r = await analyze(b.bytes());
    expect(ids(r).filter((id) => id === 'pdf.object.endobj-missing')).toHaveLength(1);
  });

  it('IND-4, REQ-PDF-003: given many streams with a wrong Length, when analyzed, then at most 16 MiB is searched for endstream', async () => {
    const b = new PdfBuilder().object(1, catalog);
    const big = new Uint8Array(1_100_000).fill(0x41);
    for (let n = 2; n <= 40; n++) b.stream(n, '', big, { length: '0' });
    b.xrefTable({ trailer: '/Root 1 0 R' });
    const inner = bytesSource(b.bytes());
    // Each search reads 1 MiB from the data start; nothing else reads that much at once.
    let searches = 0;
    await analyzePdf({
      byteLength: inner.byteLength,
      read: (o, n) => {
        if (n >= 1024 * 1024) searches++;
        return inner.read(o, n);
      },
    });
    expect(searches).toBe(16);
  }, 30_000);

  it('EOF-3: given a comment line after %%EOF, when analyzed, then eof.trailing', async () => {
    expect(ids(await analyze(simplePdf().raw('%hidden payload').bytes()))).toEqual([
      'pdf.eof.trailing',
    ]);
  });

  it('MAP-1, MAP-3: given an older cross-reference stream whose number is reused, when analyzed, then no overlap', async () => {
    const b = new PdfBuilder({ version: '1.5' })
      .object(1, catalog)
      .xrefStream(3, { trailer: '/Root 1 0 R' });
    b.object(3, '<< /Type /Annot >>').xrefTable({ trailer: '/Root 1 0 R' });
    const r = await analyze(b.bytes());
    expect(ids(r)).not.toContain('pdf.overlap');
  });
});

describe('robustness', () => {
  it('REQ-PDF-003: given a large stream, when analyzed, then only the needed ranges are read', async () => {
    const b = new PdfBuilder()
      .object(1, catalog)
      .stream(2, '', new Uint8Array(5_000_000).fill(0x41));
    b.xrefTable({ trailer: '/Root 1 0 R' });
    const bytes = b.bytes();
    let read = 0;
    const inner = bytesSource(bytes);
    const r = await analyzePdf({
      byteLength: inner.byteLength,
      read: (o, n) => {
        read += n;
        return inner.read(o, n);
      },
    });
    expect(r.findings).toEqual([]);
    expect(read).toBeLessThan(bytes.length / 4);
  });

  it('REQ-PDF-003: given many small objects, when analyzed, then each byte is read about once', async () => {
    const b = new PdfBuilder().object(1, catalog);
    for (let n = 2; n < 2000; n++) b.object(n, `<< /Type /Annot /N ${n} >>`);
    b.xrefTable({ trailer: '/Root 1 0 R' });
    const bytes = b.bytes();
    let read = 0;
    const inner = bytesSource(bytes);
    const r = await analyzePdf({
      byteLength: inner.byteLength,
      read: (o, n) => {
        read += n;
        return inner.read(o, n);
      },
    });
    expect(r.findings).toEqual([]);
    expect(read).toBeLessThan(bytes.length * 3);
  });

  it('REQ-PDF-003: given 300 randomly damaged files, when analyzed, then none throws', async () => {
    const base = simplePdf({ binary: true });
    base.object(4, '<< /K [1 2 (x) <ab>] /N /a#20b >>').stream(5, '/Filter /FlateDecode', 'data');
    base.xrefTable({ trailer: '/Root 1 0 R /ID [<00> <01>]' });
    const original = base.bytes();
    let seed = 7;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 300; i++) {
      const bytes = original.slice(0, original.length - (i % 7 === 0 ? random() % 60 : 0));
      for (let k = 0; k < 1 + (i % 5); k++) bytes[random() % bytes.length] = random() & 0xff;
      const r = await analyze(bytes);
      expect(r.byteLength).toBe(bytes.length);
    }
  });
});

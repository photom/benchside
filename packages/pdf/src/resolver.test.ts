import { bytesSource, Reader } from '@benchside/core';
import { describe, expect, it } from 'vitest';
import { FindingList } from './findings.ts';
import { standalone } from './objects.ts';
import { asInteger, dictGet, type PdfValue } from './parser.ts';
import { Resolver } from './resolver.ts';
import { readChain } from './revisions.ts';
import { PdfBuilder } from './test/build-pdf.ts';

const LF = String.fromCharCode(10);

async function open(b: PdfBuilder, encrypted = false) {
  const reader = new Reader(bytesSource(b.bytes()));
  const findings = new FindingList();
  const chain = await readChain(reader, b.sections.at(-1) as number, findings, {
    maxSections: 10,
    maxEntries: 1000,
  });
  const resolver = new Resolver({
    reader,
    objects: chain.objects,
    findings,
    context: standalone(),
    encrypted,
  });
  return { resolver, findings, ids: () => findings.list.map((f) => f.id) };
}

const ref = (number: number): PdfValue => ({ kind: 'ref', number, generation: 0 });

describe('references', () => {
  it('RES-1: given a reference to an object in use, when resolved, then its value and number', async () => {
    const { resolver } = await open(new PdfBuilder().object(1, '<< /A 7 >>').xrefTable());
    const r = await resolver.resolve(ref(1));
    expect(asInteger(dictGet(r.value, 'A'))).toBe(7);
    expect(r.object).toBe(1);
  });

  it('RES-1: given a reference to a missing object or another generation, when resolved, then null', async () => {
    const { resolver, ids } = await open(new PdfBuilder().object(1, '5').xrefTable());
    expect((await resolver.resolve(ref(9))).value).toBeNull();
    expect((await resolver.resolve({ kind: 'ref', number: 1, generation: 3 })).value).toBeNull();
    expect(ids()).toEqual([]);
  });

  it('RES-1: given a reference with the wrong generation first, when the right one is resolved, then the object', async () => {
    const { resolver } = await open(new PdfBuilder().object(1, '(x)').xrefTable());
    expect((await resolver.resolve({ kind: 'ref', number: 1, generation: 1 })).value).toBeNull();
    expect((await resolver.resolve(ref(1))).value).toMatchObject({ kind: 'string' });
    expect((await resolver.resolve({ kind: 'ref', number: 1, generation: 1 })).value).toBeNull();
  });

  it('FLT-1, RES-1: given a stream whose Filter is a reference, when its data is read, then it is decoded', async () => {
    const b = new PdfBuilder()
      .stream(1, '/Filter 2 0 R', '6869>')
      .object(2, '/ASCIIHexDecode')
      .xrefTable();
    const { resolver } = await open(b);
    expect([...((await resolver.streamData(await resolver.resolve(ref(1)))) ?? [])]).toEqual([
      0x68, 0x69,
    ]);
  });

  it('RES-2: given a chain of references, when resolved, then the final value', async () => {
    const b = new PdfBuilder().object(1, '2 0 R').object(2, '3 0 R').object(3, '(end)').xrefTable();
    const { resolver } = await open(b);
    expect((await resolver.resolve(ref(1))).value).toMatchObject({ kind: 'string' });
  });

  it('RES-2: given a reference loop, when resolved, then null after 32 steps', async () => {
    const { resolver } = await open(
      new PdfBuilder().object(1, '2 0 R').object(2, '1 0 R').xrefTable(),
    );
    expect((await resolver.resolve(ref(1))).value).toBeNull();
  });

  it('RES-4: given a stream, when resolved, then its dictionary and its decoded data on request', async () => {
    const b = new PdfBuilder().stream(1, '/Filter /ASCIIHexDecode', '68 69>').xrefTable();
    const { resolver } = await open(b);
    const r = await resolver.resolve(ref(1));
    expect(r.stream?.byteLength).toBe(6);
    expect([...((await resolver.streamData(r)) ?? [])]).toEqual([0x68, 0x69]);
  });
});

describe('object streams', () => {
  const members = [
    { num: 1, body: '<< /Type /Catalog >>' },
    { num: 2, body: '[1 2 3]' },
  ];

  it('OST-1..4: given compressed objects, when resolved, then their values from the object stream', async () => {
    const b = new PdfBuilder({ version: '1.5' }).objectStream(5, members).xrefStream(6);
    const { resolver, ids } = await open(b);
    expect((await resolver.resolve(ref(2))).value).toMatchObject({ kind: 'array' });
    expect(dictGet((await resolver.resolve(ref(1))).value, 'Type')).toMatchObject({
      key: 'Catalog',
    });
    expect(ids()).toEqual([]);
  });

  it('OST-1: given a container that is not an object stream, when resolved, then objstm.invalid once', async () => {
    const b = new PdfBuilder({ version: '1.5' }).stream(5, '/Type /XObject', 'x');
    b.objectStream(7, members);
    // Point the compressed entries at object 5 instead of 7.
    const bytes = b.xrefStream(8, { compress: false }).bytes();
    const { resolver, ids } = await open(rewriteContainer(b, bytes, 7, 5));
    expect((await resolver.resolve(ref(1))).value).toBeNull();
    expect((await resolver.resolve(ref(2))).value).toBeNull();
    expect(ids()).toEqual(['pdf.objstm.invalid']);
  });

  it('OST-2: given fewer header pairs than N, when resolved, then objstm.invalid and the pairs read are used', async () => {
    const b = new PdfBuilder({ version: '1.5' });
    b.stream(5, '/Type /ObjStm /N 3 /First 4', '1 0 (x)');
    b.raw(`% compressed 1 at index 0${LF}`);
    const { resolver, ids } = await open(compressed(b, 5, [[1, 0]]));
    expect((await resolver.resolve(ref(1))).value).toMatchObject({ kind: 'string' });
    expect(ids()).toEqual(['pdf.objstm.invalid']);
  });

  it('OST-3: given an index whose pair names another object, when resolved, then objstm.missing and null', async () => {
    const b = new PdfBuilder({ version: '1.5' }).objectStream(5, members);
    const { resolver, ids } = await open(compressed(b, 5, [[2, 0]]));
    expect((await resolver.resolve(ref(2))).value).toBeNull();
    expect(ids()).toEqual(['pdf.objstm.missing']);
  });

  it('OST-6: given an encrypted file, when a compressed object is resolved, then null with no finding', async () => {
    const b = new PdfBuilder({ version: '1.5' }).objectStream(5, members).xrefStream(6);
    const { resolver, ids } = await open(b, true);
    expect((await resolver.resolve(ref(1))).value).toBeNull();
    expect(ids()).toEqual([]);
  });

  it('FLT-9: given an object stream used twice, when resolved, then it is decoded once', async () => {
    const b = new PdfBuilder({ version: '1.5' }).objectStream(5, members).xrefStream(6);
    const { resolver } = await open(b);
    await resolver.resolve(ref(1));
    const left = resolver.budget.left;
    await resolver.resolve(ref(2));
    expect(resolver.budget.left).toBe(left);
  });
});

/** Replaces the container number in an uncompressed cross-reference stream's type-2 rows. */
function rewriteContainer(b: PdfBuilder, bytes: Uint8Array, from: number, to: number): PdfBuilder {
  const at = b.offsets.get(8) as number;
  const start =
    bytes.indexOf(0x0a, String.fromCharCode(...bytes.subarray(at)).indexOf('stream') + at) + 1;
  // Rows are W [1 4 2]: type, field 2 (4 bytes), field 3 (2 bytes).
  for (let i = start; i + 7 <= bytes.length; i += 7) {
    if (bytes[i] === 2 && bytes[i + 4] === from) bytes[i + 4] = to;
    else if (bytes[i] !== 0 && bytes[i] !== 1) break;
  }
  const copy = new PdfBuilder({ version: null });
  copy.raw(bytes);
  copy.sections.push(...b.sections);
  return copy;
}

/** Ends `b` with a cross-reference stream that lists `entries` as compressed in `container`. */
function compressed(b: PdfBuilder, container: number, entries: [number, number][]): PdfBuilder {
  const at = b.offset;
  const off = b.offsets.get(container) as number;
  const rows = [
    [1, (off >> 8) & 0xff, off & 0xff, 0],
    ...entries.map(([, index]) => [2, 0, container, index]),
  ];
  const index = [container, 1, ...entries.flatMap(([n]) => [n, 1])];
  const data = String.fromCharCode(...rows.flat());
  b.raw(
    `9 0 obj${LF}<< /Type /XRef /Size 10 /W [1 2 1] /Index [${index.join(' ')}] /Length ${data.length} >>${LF}stream${String.fromCharCode(13, 10)}`,
  );
  b.raw(data).raw(`${LF}endstream${LF}endobj${LF}`);
  b.sections.push(at);
  return b;
}

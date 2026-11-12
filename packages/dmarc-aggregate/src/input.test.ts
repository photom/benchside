import { deflateRawSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildZip } from '../../zip/src/test/build-zip.ts';
import { type Budget, type InputEvent, type InputLimits, newBudget, readInput } from './input.ts';
import { cat, tar, tarEntry } from './test/tar-writer.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const doc = (id: string) =>
  `<feedback><report_metadata><report_id>${id}</report_id></report_metadata></feedback>`;
const gz = (s: string | Uint8Array) => new Uint8Array(gzipSync(typeof s === 'string' ? enc(s) : s));

interface Collected {
  kind: string | undefined;
  docs: { label: string; filename: string | null; id: string | undefined }[];
  findings: { id: string; severity: string; label: string }[];
  pauses: number;
  order: string[];
}

async function collect(
  name: string,
  bytes: Uint8Array,
  budget: Budget = newBudget(),
  limits?: Partial<InputLimits>,
): Promise<Collected> {
  const c: Collected = { kind: undefined, docs: [], findings: [], pauses: 0, order: [] };
  const events: InputEvent[] = [];
  for await (const e of readInput({ name, bytes }, budget, limits)) events.push(e);
  for (const e of events) {
    c.order.push(e.type);
    if (e.type === 'kind') c.kind = e.kind;
    else if (e.type === 'pause') c.pauses++;
    else if (e.type === 'finding') {
      c.findings.push({ id: e.finding.id, severity: e.finding.severity, label: e.finding.label });
    } else {
      const meta = e.document.root.children[0];
      c.docs.push({ label: e.label, filename: e.filename, id: meta?.children[0]?.text });
    }
  }
  return c;
}

describe('readInput: kinds (INP-3)', () => {
  it('INP-3: given XML, when read, then kind xml and one report labeled with the file name', async () => {
    const c = await collect('dir/r!example.com!1!2.xml', enc(doc('a')));
    expect(c.kind).toBe('xml');
    expect(c.order[0]).toBe('kind');
    expect(c.docs).toEqual([
      { label: 'dir/r!example.com!1!2.xml', filename: 'dir/r!example.com!1!2.xml', id: 'a' },
    ]);
    expect(c.findings).toEqual([]);
  });

  it('INP-3: given XML after a UTF-8 BOM and white space, when read, then kind xml', async () => {
    const c = await collect('a', cat(Uint8Array.of(0xef, 0xbb, 0xbf), enc(` \r\n\t${doc('a')}`)));
    expect(c.kind).toBe('xml');
    expect(c.docs).toHaveLength(1);
  });

  it('INP-3: given UTF-16 LE XML after a BOM and white space, when read, then kind xml', async () => {
    const text = ` \n${doc('u')}`;
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) bytes[2 + i * 2] = text.charCodeAt(i);
    const c = await collect('a', bytes);
    expect(c.kind).toBe('xml');
    expect(c.docs.map((d) => d.id)).toEqual(['u']);
  });

  it('INP-3: given 300 bytes of white space before the root, when read, then read as XML', async () => {
    const c = await collect('a', enc(' '.repeat(300) + doc('a')));
    expect(c.kind).toBe('xml');
    expect(c.docs).toHaveLength(1);
  });

  it('INP-3: given other bytes, an empty file, or short white space, when read, then unknown-type and nothing else', async () => {
    for (const bytes of [enc('Received: from x\r\n'), new Uint8Array(0), enc('  \n ')]) {
      const c = await collect('mail.eml', bytes);
      expect(c.kind).toBe('unknown');
      expect(c.findings).toEqual([
        { id: 'aggregate.input.unknown-type', severity: 'error', label: 'mail.eml' },
      ]);
      expect(c.docs).toEqual([]);
    }
  });

  it('INP-3: given XML in a file named .gz, when read, then the name does not matter', async () => {
    expect((await collect('a.xml.gz', enc(doc('a')))).kind).toBe('xml');
  });
});

describe('readInput: gzip (INP-4)', () => {
  it('INP-4: given gzip of XML, when read, then kind gzip and the report', async () => {
    const c = await collect('a.xml.gz', gz(doc('a')));
    expect(c.kind).toBe('gzip');
    expect(c.docs).toEqual([{ label: 'a.xml.gz', filename: 'a.xml.gz', id: 'a' }]);
  });

  it('INP-4, INP-7: given two members of one document each, when read, then two reports numbered from 1 and no file name', async () => {
    const c = await collect('two.gz', cat(gz(doc('a')), gz(doc('b'))));
    expect(c.docs).toEqual([
      { label: 'two.gz #1', filename: null, id: 'a' },
      { label: 'two.gz #2', filename: null, id: 'b' },
    ]);
  });

  it('INP-4: given a gzip error after a complete report, when read, then the report stays and aggregate.input.gzip', async () => {
    const second = gz(doc('b'));
    const c = await collect('a.gz', cat(gz(doc('a')), second.subarray(0, second.length >> 1)));
    expect(c.docs.map((d) => d.id)).toEqual(['a']);
    expect(c.findings).toEqual([{ id: 'aggregate.input.gzip', severity: 'error', label: 'a.gz' }]);
  });

  it('INP-4: given gzip holding something other than XML or tar, when read, then unknown-type', async () => {
    const zip = buildZip([{ name: 'a.xml', content: doc('a') }]).bytes;
    const c = await collect('a.zip.gz', gz(zip));
    expect(c.findings.map((f) => f.id)).toEqual(['aggregate.input.unknown-type']);
    expect(c.docs).toEqual([]);
  });

  it('INP-4, INP-12: given gzip holding tar, when read, then each entry is a report labeled with its name', async () => {
    const c = await collect(
      'week.tar.gz',
      gz(
        tar(
          tarEntry({ name: 'a.xml', data: doc('a') }),
          tarEntry({ name: 'b.xml', data: doc('b') }),
        ),
      ),
    );
    expect(c.kind).toBe('gzip');
    expect(c.docs.map((d) => d.label)).toEqual(['week.tar.gz › a.xml', 'week.tar.gz › b.xml']);
    expect(c.docs.map((d) => d.filename)).toEqual(['a.xml', 'b.xml']);
  });
});

describe('readInput: ZIP (INP-5)', () => {
  it('INP-5: given stored and deflated entries and a directory, when read, then each file entry is a report', async () => {
    const zip = buildZip([
      { name: 'dir/' },
      { name: 'dir/a.xml', content: doc('a') },
      { name: 'b.xml', content: doc('b'), method: 8, compressed: deflateRawSync(enc(doc('b'))) },
    ]).bytes;
    const c = await collect('r.zip', zip);
    expect(c.kind).toBe('zip');
    expect(c.docs).toEqual([
      { label: 'r.zip › dir/a.xml', filename: 'dir/a.xml', id: 'a' },
      { label: 'r.zip › b.xml', filename: 'b.xml', id: 'b' },
    ]);
    expect(c.findings).toEqual([]);
  });

  it('INP-5: given an encrypted entry and one with another method, when read, then entry-skipped for each', async () => {
    const zip = buildZip([
      { name: 'e.xml', content: doc('e'), flags: 1 },
      { name: 'm.xml', content: doc('m'), method: 12, compressed: enc('xx') },
      { name: 'ok.xml', content: doc('ok') },
    ]).bytes;
    const c = await collect('r.zip', zip);
    expect(c.findings).toEqual([
      { id: 'aggregate.zip.entry-skipped', severity: 'warning', label: 'r.zip › e.xml' },
      { id: 'aggregate.zip.entry-skipped', severity: 'warning', label: 'r.zip › m.xml' },
    ]);
    expect(c.docs.map((d) => d.id)).toEqual(['ok']);
  });

  it('INP-5: given an entry whose CRC-32 does not match, when read, then aggregate.zip.crc and the report is still read', async () => {
    const zip = buildZip([
      { name: 'a.xml', content: doc('a'), central: { crc32: 1 }, local: { crc32: 1 } },
    ]).bytes;
    const c = await collect('r.zip', zip);
    expect(c.docs.map((d) => d.id)).toEqual(['a']);
    expect(c.findings).toEqual([
      { id: 'aggregate.zip.crc', severity: 'warning', label: 'r.zip › a.xml' },
    ]);
  });

  it('INP-5: given a deflated entry that fails part way, when read, then the reports before stay and entry-skipped', async () => {
    const text = doc('a') + doc('b');
    const body = deflateRawSync(enc(text + ' '.repeat(100_000)));
    const zip = buildZip([
      { name: 'a.xml', content: text, method: 8, compressed: body.subarray(0, body.length - 5) },
    ]).bytes;
    const c = await collect('r.zip', zip);
    expect(c.docs.map((d) => d.label)).toEqual(['r.zip › a.xml #1', 'r.zip › a.xml #2']);
    expect(c.findings.map((f) => f.id)).toEqual(['aggregate.zip.entry-skipped']);
  });

  it('INP-5: given a ZIP the reader cannot open, when read, then aggregate.zip.unreadable', async () => {
    const c = await collect('r.zip', cat(Uint8Array.of(0x50, 0x4b, 3, 4), new Uint8Array(100)));
    expect(c.kind).toBe('zip');
    expect(c.findings).toEqual([
      { id: 'aggregate.zip.unreadable', severity: 'error', label: 'r.zip' },
    ]);
  });

  it('INP-5: given more file entries than the limit, when read, then too-many-entries and later entries are not read', async () => {
    const zip = buildZip([
      { name: 'd/' },
      ...['a', 'b', 'c'].map((id) => ({ name: `${id}.xml`, content: doc(id) })),
    ]).bytes;
    const c = await collect('r.zip', zip, newBudget(), { maxZipEntries: 2 });
    expect(c.docs.map((d) => d.id)).toEqual(['a', 'b']);
    expect(c.findings).toEqual([
      { id: 'aggregate.zip.too-many-entries', severity: 'warning', label: 'r.zip' },
    ]);
  });
});

describe('readInput: tar and nesting (INP-12, INP-13)', () => {
  it('INP-12: given a tar archive, when read, then kind tar and a report per entry', async () => {
    const c = await collect('t.tar', tar(tarEntry({ name: 'a.xml', data: doc('a') })));
    expect(c.kind).toBe('tar');
    expect(c.docs).toEqual([{ label: 't.tar › a.xml', filename: 'a.xml', id: 'a' }]);
  });

  it('INP-12: given a tar archive with a bad header after an entry, when read, then the report stays and tar.malformed', async () => {
    const c = await collect(
      't.tar',
      tar(tarEntry({ name: 'a.xml', data: doc('a') }), tarEntry({ name: 'b', checksum: 3 })),
    );
    expect(c.docs.map((d) => d.id)).toEqual(['a']);
    expect(c.findings).toEqual([
      { id: 'aggregate.tar.malformed', severity: 'error', label: 't.tar' },
    ]);
  });

  it('INP-12: given more file entries than the limit, when read, then tar.too-many-entries', async () => {
    const c = await collect(
      't.tar',
      tar(...['a', 'b', 'c'].map((id) => tarEntry({ name: id, data: doc(id) }))),
      newBudget(),
      {
        maxTarEntries: 2,
      },
    );
    expect(c.docs.map((d) => d.id)).toEqual(['a', 'b']);
    expect(c.findings).toEqual([
      { id: 'aggregate.tar.too-many-entries', severity: 'warning', label: 't.tar' },
    ]);
  });

  it('INP-7, INP-13: given tar.gz holding a gzip entry of two documents, when read, then labels nest and number the documents', async () => {
    const inner = cat(gz(doc('a')), gz(doc('b')));
    const c = await collect(
      'week.tar.gz',
      gz(tar(tarEntry({ name: '2026/11/a.xml.gz', data: inner }))),
    );
    expect(c.docs.map((d) => d.label)).toEqual([
      'week.tar.gz › 2026/11/a.xml.gz #1',
      'week.tar.gz › 2026/11/a.xml.gz #2',
    ]);
  });

  it('INP-13: given a ZIP entry that is gzip of XML, when read, then the report is read', async () => {
    const zip = buildZip([{ name: 'a.xml.gz', content: gz(doc('a')) }]).bytes;
    expect((await collect('r.zip', zip)).docs.map((d) => d.label)).toEqual(['r.zip › a.xml.gz']);
  });

  it('INP-13: given archives, unknown bytes, or gzip of tar inside an archive, when read, then aggregate.input.nested and skipped', async () => {
    const zip = buildZip([
      { name: 'in.zip', content: buildZip([{ name: 'a.xml', content: doc('a') }]).bytes },
      { name: 'in.tar', content: tar(tarEntry({ name: 'a.xml', data: doc('a') })) },
      { name: 'in.tar.gz', content: gz(tar(tarEntry({ name: 'a.xml', data: doc('a') }))) },
      { name: 'notes.txt', content: 'hello' },
      { name: 'ok.xml', content: doc('ok') },
    ]).bytes;
    const c = await collect('r.zip', zip);
    expect(c.findings).toEqual(
      ['in.zip', 'in.tar', 'in.tar.gz', 'notes.txt'].map((n) => ({
        id: 'aggregate.input.nested',
        severity: 'warning',
        label: `r.zip › ${n}`,
      })),
    );
    expect(c.docs.map((d) => d.id)).toEqual(['ok']);
  });

  it('INP-13: given a gzip entry over the entry limit, when read, then aggregate.input.too-large and skipped', async () => {
    const c = await collect(
      't.tar',
      tar(
        tarEntry({ name: 'a.xml.gz', data: gz(doc('a')) }),
        tarEntry({ name: 'b.xml', data: doc('b') }),
      ),
      newBudget(),
      {
        maxGzipEntry: 10,
      },
    );
    expect(c.findings).toEqual([
      { id: 'aggregate.input.too-large', severity: 'error', label: 't.tar › a.xml.gz' },
    ]);
    expect(c.docs.map((d) => d.id)).toEqual(['b']);
  });
});

describe('readInput: limits and labels (INP-6, INP-7)', () => {
  it('INP-6: given gzip output past the budget, when read, then aggregate.input.budget and the budget is exhausted', async () => {
    const budget: Budget = { remaining: 1000, exhausted: false };
    const c = await collect('big.gz', gz(' '.repeat(5000)), budget);
    expect(c.findings).toEqual([
      { id: 'aggregate.input.budget', severity: 'error', label: 'big.gz' },
    ]);
    expect(budget.exhausted).toBe(true);
  });

  it('INP-6: given decompressed bytes, when read, then they are taken from the budget', async () => {
    const budget = newBudget();
    const before = budget.remaining;
    await collect('a.gz', gz(doc('a')), budget);
    expect(before - budget.remaining).toBe(doc('a').length);
  });

  it('INP-6: given a nested gzip whose output passes the budget left, when read, then the report before stays and budget', async () => {
    const outer = tar(
      tarEntry({ name: 'a.xml', data: doc('a') }),
      tarEntry({ name: 'b.gz', data: gz(' '.repeat(50_000)) }),
    );
    const budget: Budget = { remaining: outer.length + 1000, exhausted: false };
    const c = await collect('t.tar.gz', gz(outer), budget);
    expect(c.docs.map((d) => d.id)).toEqual(['a']);
    expect(c.findings).toEqual([
      { id: 'aggregate.input.budget', severity: 'error', label: 't.tar.gz › b.gz' },
    ]);
    expect(budget.exhausted).toBe(true);
  });

  it('INP-6: given a nested gzip that uses most of the budget, when the outer stream goes on, then budget on the outer label', async () => {
    const big = `<feedback>${' '.repeat(50_000)}</feedback>`;
    const outer = tar(
      tarEntry({ name: 'a.xml.gz', data: gz(big) }),
      tarEntry({ name: 'pad', data: new Uint8Array(200_000) }),
      tarEntry({ name: 'b.xml', data: doc('b') }),
    );
    const budget: Budget = { remaining: outer.length + 10_000, exhausted: false };
    const c = await collect('t.tar.gz', gz(outer), budget);
    expect(c.docs.map((d) => d.label)).toEqual(['t.tar.gz › a.xml.gz']);
    expect(c.findings).toEqual([
      { id: 'aggregate.input.nested', severity: 'warning', label: 't.tar.gz › pad' },
      { id: 'aggregate.input.budget', severity: 'error', label: 't.tar.gz' },
    ]);
  });

  it('INP-6, INP-13: given a rejected stream with a large output, when read, then decompression stops and spends no more budget', async () => {
    const budget: Budget = { remaining: 100_000, exhausted: false };
    const c = await collect('notes.gz', gz(`hello${' '.repeat(300_000)}`), budget);
    expect(c.findings.map((f) => f.id)).toEqual(['aggregate.input.unknown-type']);
    expect(budget.exhausted).toBe(false);
    const second: Budget = { remaining: 100_000, exhausted: false };
    const x = await collect('bad.xml.gz', gz(`<feedback><a></b>${' '.repeat(300_000)}`), second);
    expect(x.findings.map((f) => f.id)).toEqual(['aggregate.xml.malformed']);
    expect(second.exhausted).toBe(false);
    const t = tar(tarEntry({ name: 'a.xml', data: doc('a') }));
    const third: Budget = { remaining: 100_000, exhausted: false };
    const y = await collect('t.tar.gz', gz(cat(t, new Uint8Array(300_000))), third);
    expect(y.docs.map((d) => d.id)).toEqual(['a']);
    expect(third.exhausted).toBe(false);
  });

  it('INP-6: given a budget already exhausted, when a later file is read, then nothing is read', async () => {
    const c = await collect('a.xml', enc(doc('a')), { remaining: 0, exhausted: true });
    expect(c.order).toEqual([]);
  });

  it('INP-6: given a document over the document limit, when read, then aggregate.input.too-large', async () => {
    const c = await collect('a.xml', enc(doc('x'.repeat(2000))), newBudget(), {
      maxDocument: 1000,
    });
    expect(c.findings).toEqual([
      { id: 'aggregate.input.too-large', severity: 'error', label: 'a.xml' },
    ]);
    expect(c.docs).toEqual([]);
  });

  it('XML-6, INP-7: given malformed XML after a complete document, when read, then the document keeps its number and the finding carries the input label', async () => {
    const c = await collect('a.xml', enc(`${doc('a')}${doc('b')}<feedback><x></feedback>`));
    expect(c.docs.map((d) => d.label)).toEqual(['a.xml #1', 'a.xml #2']);
    expect(c.findings).toEqual([
      { id: 'aggregate.xml.malformed', severity: 'error', label: 'a.xml' },
    ]);
  });

  it('PRG-8: given a large XML file, when read, then it pauses more than once', async () => {
    const big = `<feedback>${'<record><row><count>1</count></row></record>'.repeat(10_000)}</feedback>`;
    expect((await collect('a.xml', enc(big))).pauses).toBeGreaterThan(2);
  });

  it('INP-4, INP-12: given mutated tar.gz input, when read, then it never throws', async () => {
    const base = gz(
      tar(
        tarEntry({ name: 'a.xml.gz', data: gz(doc('a')) }),
        tarEntry({ name: 'b.xml', data: doc('b') }),
      ),
    );
    let seed = 9;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let n = 0; n < 100; n++) {
      const bytes = base.slice(0, rand() % (base.length + 1));
      for (let k = 0; k < 3; k++)
        if (bytes.length > 2) bytes[2 + (rand() % (bytes.length - 2))] = rand() & 255;
      await expect(collect('m.tar.gz', bytes)).resolves.toBeDefined();
    }
  });
});

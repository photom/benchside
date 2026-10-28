/** Analyzes one PDF (structure.md). */
import { type ByteSource, Reader } from '@benchside/core';
import { ActionCollector } from './actions.ts';
import { byteMap } from './byte-map.ts';
import { readDocument } from './document.ts';
import { FindingList } from './findings.ts';
import { readHeader } from './header.ts';
import { LARGE_BUDGET, type ReadContext, readObject, SEARCH_BUDGET, typeOf } from './objects.ts';
import { asInteger } from './parser.ts';
import { Resolver } from './resolver.ts';
import { readChain } from './revisions.ts';
import { ScriptCollector } from './scripts.ts';
import { readTail } from './tail.ts';
import type { PdfDocument, PdfObject, PdfReport, Ref, Region, Revision } from './types.ts';

export interface Limits {
  readonly maxSections: number;
  readonly maxObjects: number;
  readonly maxFindings: number;
  readonly maxPages: number;
  readonly maxAnnotations: number;
  readonly maxTreeItems: number;
  readonly maxActions: number;
  readonly maxScripts: number;
}

const READ_WINDOW = 256 * 1024;
/** The document walk jumps around the file; small windows keep each jump cheap (ADR 0011). */
const WALK_WINDOW = 8 * 1024;
/** IND-3: Length references followed inside one another. */
const MAX_LENGTH_NESTING = 8;

/** README.md#limits */
export const LIMITS: Limits = {
  maxSections: 256,
  maxObjects: 500_000,
  maxFindings: 1000,
  maxPages: 100_000,
  maxAnnotations: 100_000,
  maxTreeItems: 100_000,
  maxActions: 10_000,
  maxScripts: 10_000,
};

export async function analyzePdf(
  source: ByteSource,
  options: { limits?: Partial<Limits> } = {},
): Promise<PdfReport> {
  const limits = { ...LIMITS, ...options.limits };
  const findings = new FindingList(limits.maxFindings);
  // REQ-PDF-003: windows small enough that the header or one object never pulls in a MiB,
  // large enough that neighbouring objects come from one read.
  const reader = new Reader(source, READ_WINDOW);
  // Objects have their own reader, so section reads do not drop the object window.
  const objectReader = new Reader(source, READ_WINDOW);
  const size = source.byteLength;

  const { header, regions: headerRegions } = await readHeader(reader, findings);
  const tail = await readTail(reader, findings);
  const regions: Region[] = [...headerRegions, ...tail.regions];
  const base = { byteLength: size, header };

  if (tail.startxref === null) {
    // EOF-2
    const from = headerRegions.reduce((end, r) => Math.max(end, r.offset + r.byteLength), 0);
    if (from < size) regions.push({ kind: 'unknown', offset: from, byteLength: size - from });
    return {
      ...base,
      revisions: [],
      objects: [],
      trailer: null,
      encrypted: false,
      regions,
      document: null,
      actions: [],
      scripts: [],
      findings: findings.list,
    };
  }

  const chain = await readChain(reader, tail.startxref, findings, {
    maxSections: limits.maxSections,
    maxEntries: limits.maxObjects * 2,
  });
  const streamSections = new Set<number>();
  const revisions: Revision[] = chain.sections.map((s, i) => {
    regions.push(...s.regions);
    if (s.kind === 'stream') streamSections.add(s.offset);
    if (s.xrefStm) {
      regions.push(...s.xrefStm.regions);
      streamSections.add(s.xrefStm.offset);
    }
    return {
      index: chain.sections.length - 1 - i,
      offset: s.offset,
      kind: s.kind,
      trailer: s.trailer,
      xrefStm: s.xrefStm?.offset ?? null,
      entryCount: s.entries.size + (s.xrefStm?.entries.size ?? 0),
    };
  });
  const trailer = chain.sections[0]?.trailer ?? null;
  const newest = chain.sections[0];
  if (newest && !newest.trailer.root) {
    findings.add('pdf.trailer.root', 'The newest trailer has no Root.', { offset: newest.offset });
  }
  const encrypted = trailer?.encrypt ?? false;
  if (encrypted) {
    findings.add(
      'pdf.encrypted',
      'The file is encrypted: strings and stream data are shown as stored.',
    );
  }

  // IND-3: an indirect Length is read through the resolver (RES-1), so it may be compressed.
  // Its own findings come from the objects list. `pending` stops a Length that leads back
  // to a stream still being read.
  const pending = new Set<number>();
  const resolveLength = async (ref: Ref) => {
    if (pending.has(ref.number) || pending.size >= MAX_LENGTH_NESTING) return null;
    pending.add(ref.number);
    try {
      return asInteger((await resolver.load(ref.number, ref.generation, { cache: false })).value);
    } finally {
      pending.delete(ref.number);
    }
  };
  // IND-4: one endstream search budget for the whole file.
  const context: ReadContext = {
    resolveLength,
    search: { left: SEARCH_BUDGET },
    large: { left: LARGE_BUDGET },
  };
  const resolver = new Resolver({
    reader: new Reader(source, WALK_WINDOW),
    objects: chain.objects,
    findings,
    context,
    encrypted,
  });
  // SCR-6..9: the objects list and the byte map hand each object over as they read it.
  const scripts = new ScriptCollector(resolver, findings, {
    encrypted,
    maxScripts: limits.maxScripts,
  });

  // OBX-1..3, REP-3
  const objects: PdfObject[] = [];
  const numbers = [...chain.objects.keys()].filter((n) => n !== 0).sort((a, b) => a - b);
  for (const number of numbers) {
    if (objects.length >= limits.maxObjects) {
      findings.add(
        'pdf.too-many-objects',
        `Only the first ${limits.maxObjects} objects are listed.`,
      );
      break;
    }
    const { entry, revision, replaced } = chain.objects.get(number) as NonNullable<
      ReturnType<typeof chain.objects.get>
    >;
    const common = { number, revision, replaced };
    if (entry.type === 'free') {
      scripts.freed(number);
      objects.push({ ...common, generation: entry.generation, status: 'free' });
      continue;
    }
    if (entry.type === 'compressed') {
      // OBX-3: read once for its type, and not kept.
      const { value } = await resolver.load(number, 0, { findings, cache: false });
      scripts.object(number, 0, value, false);
      objects.push({
        ...common,
        generation: 0,
        status: 'compressed',
        container: entry.container,
        index: entry.index,
        ...typeOf(value),
      });
      continue;
    }
    const ref = { number, generation: entry.generation };
    const at = { offset: entry.offset, object: number };
    const listed = {
      ...common,
      generation: entry.generation,
      status: 'in-use' as const,
      offset: entry.offset,
    };
    const outcome = await readObject(objectReader, entry.offset, findings, ref, context);
    if (outcome.kind === 'out-of-range') {
      findings.add(
        'pdf.object.out-of-range',
        `Object ${number} is at offset ${entry.offset}, outside the file.`,
        at,
      );
      objects.push(listed);
      continue;
    }
    if (outcome.kind === 'mismatch') {
      findings.add(
        'pdf.object.header-mismatch',
        `Offset ${entry.offset} does not start "${number} ${entry.generation} obj".`,
        at,
      );
      objects.push(listed);
      continue;
    }
    if (outcome.kind === 'too-large') {
      // RES-1: read again, larger, through the resolver so the walk reuses it (SCR-7).
      const whole = await resolver.load(number, entry.generation);
      scripts.object(number, entry.generation, whole.value, whole.stream !== null);
      findings.add(
        'pdf.object.too-large',
        `Object ${number} is larger than the 64 KiB read for it.`,
        at,
      );
      objects.push(listed);
      continue;
    }
    const { indirect, end, stream } = outcome.object;
    scripts.object(number, entry.generation, indirect.value, stream !== null);
    if (!streamSections.has(entry.offset)) {
      regions.push({
        kind: 'object',
        offset: entry.offset,
        byteLength: end - entry.offset,
        object: number,
      });
    }
    objects.push({ ...listed, ...typeOf(indirect.value), ...(stream ? { stream } : {}) });
  }

  // MAP-1: older copies of replaced objects, read for their extent only.
  let budget = limits.maxObjects - objects.length;
  for (const [i, s] of chain.sections.entries()) {
    const revision = revisions[i]?.index ?? 0;
    for (const list of s.xrefStm ? [s.entries, s.xrefStm.entries] : [s.entries]) {
      for (const [number, entry] of list) {
        const winner = chain.objects.get(number)?.entry;
        // Only replaced objects: an entry ignored by REV-5 has no winner. A cross-reference
        // stream already has its own region.
        if (!winner || entry.type !== 'in-use' || winner === entry) continue;
        if (winner.type === 'in-use' && winner.offset === entry.offset) continue;
        if (streamSections.has(entry.offset) || budget-- <= 0) continue;
        const ref = { number, generation: entry.generation };
        const old = await readObject(objectReader, entry.offset, new FindingList(), ref, context);
        if (old.kind === 'read') {
          scripts.olderCopy(number, entry.offset, revision, old.object.indirect.value);
          regions.push({
            kind: 'object',
            offset: entry.offset,
            byteLength: old.object.end - entry.offset,
            object: number,
          });
        }
      }
    }
  }

  // REP-8, REP-10, REP-11: the document walk (CAT, INF, PG, ANN), and the actions (ACT) and
  // 3D scripts (SCR-2) it reaches.
  const actions = new ActionCollector(resolver, findings, { encrypted, limits });
  const missesBefore = resolver.misses;
  const read = trailer
    ? await readDocument(
        resolver,
        trailer,
        findings,
        { encrypted, limits },
        {
          catalog: async (dict, object) => {
            await actions.catalog(dict, object);
            await actions.names(dict);
          },
          page: ({ index, object, dict }) => actions.page(index, object, dict),
          annotation: async ({ page, object, dict }) => {
            await actions.annotation(page, object, dict);
            await scripts.annotation(page, object, dict);
          },
        },
      )
    : null;
  if (read?.catalogDict) {
    await actions.fields(read.catalogDict);
    await actions.outline(read.catalogDict);
    await scripts.xfa(read.catalogDict);
  }
  // SCR-8: a walk that stopped at a limit, or met an object it could not read, may have
  // missed places.
  const cut = Boolean(read?.cut) || actions.cut || resolver.misses > missesBefore;
  await scripts.finish(actions.dicts, cut);
  const document: PdfDocument | null = read && {
    catalog: read.catalog,
    info: read.info,
    pageCount: read.pageCount,
    pages: read.pages,
    outlineItems: actions.outlineItems,
    fields: actions.fieldItems,
  };

  return {
    ...base,
    revisions,
    objects,
    trailer,
    encrypted,
    regions: await byteMap(reader, regions, findings),
    document,
    actions: actions.actions,
    scripts: scripts.scripts,
    findings: findings.list,
  };
}

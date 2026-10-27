/** Analyzes one PDF (structure.md). */
import { type ByteSource, Reader } from '@benchside/core';
import { byteMap } from './byte-map.ts';
import { FindingList } from './findings.ts';
import { readHeader } from './header.ts';
import { type ReadContext, readObject, SEARCH_BUDGET, standalone, typeOf } from './objects.ts';
import { asInteger } from './parser.ts';
import { readChain } from './revisions.ts';
import { readTail } from './tail.ts';
import type { PdfObject, PdfReport, Ref, Region, Revision } from './types.ts';

export interface Limits {
  readonly maxSections: number;
  readonly maxObjects: number;
  readonly maxFindings: number;
}

const READ_WINDOW = 256 * 1024;

/** README.md#limits */
export const LIMITS: Limits = { maxSections: 256, maxObjects: 500_000, maxFindings: 1000 };

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

  // IND-3: an indirect Length is read through the merged entries. Its own findings come
  // from the objects loop, once; here they would repeat for every stream using it.
  const resolveLength = async (ref: Ref) => {
    const m = chain.objects.get(ref.number);
    if (m?.entry.type !== 'in-use' || m.entry.generation !== ref.generation) return null;
    const o = await readObject(objectReader, m.entry.offset, new FindingList(), ref, standalone());
    return o.kind === 'read' ? asInteger(o.object.indirect.value) : null;
  };
  // IND-4: one endstream search budget for the whole file.
  const context: ReadContext = { resolveLength, search: { left: SEARCH_BUDGET } };

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
      objects.push({ ...common, generation: entry.generation, status: 'free' });
      continue;
    }
    if (entry.type === 'compressed') {
      objects.push({
        ...common,
        generation: 0,
        status: 'compressed',
        container: entry.container,
        index: entry.index,
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
      findings.add(
        'pdf.object.too-large',
        `Object ${number} is larger than the 64 KiB read for it.`,
        at,
      );
      objects.push(listed);
      continue;
    }
    const { indirect, end, stream } = outcome.object;
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
  for (const s of chain.sections) {
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

  return {
    ...base,
    revisions,
    objects,
    trailer,
    encrypted,
    regions: await byteMap(reader, regions, findings),
    findings: findings.list,
  };
}

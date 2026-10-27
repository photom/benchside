/** The chain of sections and the merged entries (structure.md: XREF-1, XREF-5, REV-1..5). */
import type { Reader } from '@benchside/core';
import type { FindingList } from './findings.ts';
import { Lexer } from './lexer.ts';
import type { Entry, Section } from './section.ts';
import { readStreamSection } from './xref-stream.ts';
import { readTable } from './xref-table.ts';

export interface Merged {
  readonly entry: Entry;
  /** REV-4: the revision of the section that wins. */
  readonly revision: number;
  /** REV-4: older revisions that also list the object. */
  readonly replaced: number[];
}

export interface Chain {
  /** Newest first; index 0 of a revision is the oldest (REP-1). */
  readonly sections: readonly (Section & { readonly xrefStm: Section | null })[];
  readonly objects: Map<number, Merged>;
}

/** REV-1..3 */
export async function readChain(
  reader: Reader,
  startxref: number,
  findings: FindingList,
  limits: { maxSections: number; maxEntries: number },
): Promise<Chain> {
  const seen = new Set<number>();
  const sections: (Section & { xrefStm: Section | null })[] = [];
  let next: number | null = startxref;
  while (next !== null) {
    if (seen.has(next)) {
      findings.add(
        'pdf.xref.loop',
        `The section at offset ${next} was already read; reading stops.`,
        {
          offset: next,
        },
      );
      break;
    }
    if (sections.length >= limits.maxSections) {
      findings.add(
        'pdf.xref.too-many-sections',
        `More than ${limits.maxSections} sections; older ones are not read.`,
        { offset: next },
      );
      break;
    }
    seen.add(next);
    const section = await readSection(reader, next, findings, limits.maxEntries);
    if (!section) break;
    // REV-2: a hybrid file's XRefStm belongs to this table's revision.
    let xrefStm: Section | null = null;
    const stm = section.kind === 'table' ? section.trailer.xrefStm : null;
    if (stm !== null && !seen.has(stm)) {
      seen.add(stm);
      xrefStm = await readSection(reader, stm, findings, limits.maxEntries, 'stream');
    }
    sections.push({ ...section, xrefStm });
    next = section.trailer.prev;
  }
  return { sections, objects: merge(sections, findings) };
}

/** XREF-1: a table at `xref`, a stream at `n g obj`; null with a finding otherwise. */
async function readSection(
  reader: Reader,
  offset: number,
  findings: FindingList,
  maxEntries: number,
  only?: 'stream',
): Promise<Section | null> {
  if (offset < 0 || offset >= reader.byteLength) {
    findings.add(
      'pdf.xref.out-of-range',
      `The cross-reference offset ${offset} is outside the file.`,
      { offset },
    );
    return null;
  }
  const bytes =
    (await reader.bytes(offset, Math.min(64, reader.byteLength - offset))) ?? new Uint8Array();
  const lexer = new Lexer(bytes, offset);
  const first = lexer.next();
  if (first.kind === 'keyword' && first.text === 'xref' && only !== 'stream') {
    return readTable(reader, first.start, findings, maxEntries);
  }
  const g = lexer.next();
  const obj = lexer.next();
  if (
    first.kind === 'number' &&
    g.kind === 'number' &&
    obj.kind === 'keyword' &&
    obj.text === 'obj'
  ) {
    return readStreamSection(reader, first.start, findings, maxEntries);
  }
  findings.add(
    'pdf.xref.not-found',
    `No cross-reference table or stream starts at offset ${offset}.`,
    { offset },
  );
  return null;
}

/** REV-4, REV-5, XREF-5 */
function merge(sections: Chain['sections'], findings: FindingList): Map<number, Merged> {
  const objects = new Map<number, Merged>();
  const size = sections[0]?.trailer.size ?? null;
  let ignored = false;
  sections.forEach((section, i) => {
    const revision = sections.length - 1 - i;
    // REV-2: the table's own entries first, then its XRefStm for numbers it does not list.
    const lists = section.xrefStm ? [section.entries, section.xrefStm.entries] : [section.entries];
    const here = new Map<number, Entry>();
    for (const list of lists) for (const [n, e] of list) if (!here.has(n)) here.set(n, e);
    for (const [number, entry] of here) {
      if (size !== null && number >= size) {
        ignored = true;
        continue;
      }
      const known = objects.get(number);
      if (known) known.replaced.push(revision);
      else objects.set(number, { entry, revision, replaced: [] });
    }
  });
  const sizeMissing = sections.some((s) => s.trailer.size === null);
  if (ignored || sizeMissing) {
    findings.add(
      'pdf.trailer.size',
      ignored
        ? `Entries for object numbers at or above Size ${size} are ignored.`
        : 'A trailer has no integer Size.',
    );
  }
  // XREF-5: object 0 in the oldest section.
  const oldest = sections.at(-1);
  const zero = oldest?.entries.get(0);
  if (oldest?.kind === 'table' && zero && !(zero.type === 'free' && zero.generation === 65535)) {
    findings.add(
      'pdf.xref.first-entry',
      'Object 0 in the oldest section is not free with generation 65535.',
      { offset: oldest.offset },
    );
  }
  return objects;
}

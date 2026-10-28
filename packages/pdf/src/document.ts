/** Catalog, document information, page tree, annotations (document.md: CAT, INF, PG, ANN). */
import type { FindingList } from './findings.ts';
import { asInteger, asName, dictGet, type PdfValue } from './parser.ts';
import type { Resolved, Resolver } from './resolver.ts';
import { plain, textOf } from './text.ts';
import type { Annotation, Catalog, Info, InfoEntry, Page, Ref, Trailer } from './types.ts';

/** PG-4 */
const MAX_DEPTH = 64;

export interface DocumentLimits {
  readonly maxPages: number;
  readonly maxAnnotations: number;
}

/** Called as the walk reaches each page and annotation, so actions are found in page order. */
export interface DocumentVisitor {
  catalog(dict: PdfValue, object: number | null): Promise<void>;
  page(page: { index: number; object: number | null; dict: PdfValue }): Promise<void>;
  annotation(annotation: { page: number; object: number | null; dict: PdfValue }): Promise<void>;
}

export interface DocumentResult {
  readonly catalog: Catalog | null;
  /** The catalog dictionary, for the action search. */
  readonly catalogDict: PdfValue | null;
  readonly info: Info | null;
  readonly pageCount: number | null;
  readonly pages: Page[];
}

const refValue = (r: Ref): PdfValue => ({
  kind: 'ref',
  number: r.number,
  generation: r.generation,
});

export async function readDocument(
  resolver: Resolver,
  trailer: Trailer,
  findings: FindingList,
  options: { encrypted: boolean; limits: DocumentLimits },
  visitor: DocumentVisitor,
): Promise<DocumentResult> {
  const info = await readInfo(resolver, trailer, findings, options.encrypted);
  // CAT-1
  if (!trailer.root) return { catalog: null, catalogDict: null, info, pageCount: null, pages: [] };
  const root = await resolver.resolve(refValue(trailer.root));
  if (root.value?.kind !== 'dict') {
    // OST-6: an encrypted object stream hides the catalog; that is not a broken file.
    if (root.unavailable) {
      return { catalog: null, catalogDict: null, info, pageCount: null, pages: [] };
    }
    findings.add('pdf.catalog.missing', 'The trailer Root does not lead to a catalog dictionary.', {
      object: trailer.root.number,
    });
    return { catalog: null, catalogDict: null, info, pageCount: null, pages: [] };
  }
  const dict = root.value;
  const at = root.object === null ? {} : { object: root.object };
  // CAT-2
  if (asName(dictGet(dict, 'Type')) !== 'Catalog') {
    findings.add('pdf.catalog.type', 'The catalog Type is not /Catalog.', at);
  }
  // CAT-3
  const name = (key: string) => {
    const v = dictGet(dict, key);
    return v?.kind === 'name' ? v.text : null;
  };
  const catalog: Catalog = {
    object: root.object,
    version: name('Version'),
    pageLayout: name('PageLayout'),
    pageMode: name('PageMode'),
    lang: textOf((await resolver.resolve(dictGet(dict, 'Lang'))).value, options.encrypted),
    keys: [...dict.entries.keys()],
  };
  await visitor.catalog(dict, root.object);
  const walk = new PageWalk(resolver, findings, options.limits, visitor);
  const pageCount = await walk.run(dictGet(dict, 'Pages'));
  return { catalog, catalogDict: dict, info, pageCount, pages: walk.pages };
}

/** INF-1, INF-2 */
async function readInfo(
  resolver: Resolver,
  trailer: Trailer,
  findings: FindingList,
  encrypted: boolean,
): Promise<Info | null> {
  if (!trailer.info) return null;
  const r = await resolver.resolve(refValue(trailer.info));
  if (r.value?.kind !== 'dict') {
    findings.add('pdf.info.invalid', 'The trailer Info does not lead to a dictionary.', {
      object: trailer.info.number,
    });
    return null;
  }
  const entries: InfoEntry[] = [];
  for (const [key, raw] of r.value.entries) {
    const v = (await resolver.resolve(raw)).value;
    const text = textOf(v, encrypted);
    if (text) entries.push({ key, kind: 'text', value: text });
    else if (v?.kind === 'name') entries.push({ key, kind: 'name', value: plain(v.text) });
    else entries.push({ key, kind: 'other', value: plain(describe(v)) });
  }
  return { object: r.object, entries };
}

/** INF-2: a value that is not text, by kind. */
function describe(v: PdfValue | null): string {
  if (!v) return 'null';
  switch (v.kind) {
    case 'null':
      return 'null';
    case 'number':
      return `number ${v.value}`;
    case 'boolean':
      return `boolean ${v.value}`;
    case 'array':
      return `array of ${v.items.length}`;
    case 'dict':
      return 'dictionary';
    default:
      return v.kind;
  }
}

interface Inherited {
  readonly mediaBox: PdfValue | undefined;
  readonly cropBox: PdfValue | undefined;
  readonly rotate: PdfValue | undefined;
}

/** PG-1..8, ANN-1, ANN-2 */
class PageWalk {
  readonly pages: Page[] = [];
  private readonly seen = new Set<number>();
  private readonly limited = new Set<string>();
  private annotations = 0;
  private stopped = false;
  /** OST-6: a kid could not be read because the file is encrypted. */
  private incomplete = false;
  private readonly resolver: Resolver;
  private readonly findings: FindingList;
  private readonly limits: DocumentLimits;
  private readonly visitor: DocumentVisitor;

  constructor(
    resolver: Resolver,
    findings: FindingList,
    limits: DocumentLimits,
    visitor: DocumentVisitor,
  ) {
    this.resolver = resolver;
    this.findings = findings;
    this.limits = limits;
    this.visitor = visitor;
  }

  /** Walks the tree from the catalog's `Pages`; returns the root's Count. */
  async run(pages: PdfValue | undefined): Promise<number | null> {
    const root = await this.resolver.resolve(pages);
    if (root.value?.kind !== 'dict') {
      if (root.unavailable) return null; // OST-6
      this.findings.add('pdf.pages.missing', 'The catalog has no page tree dictionary in Pages.');
      return null;
    }
    const none = { mediaBox: undefined, cropBox: undefined, rotate: undefined };
    await this.visit(root, 0, none);
    // PG-7
    const count = asInteger(dictGet(root.value, 'Count'));
    if (count !== null && !this.stopped && !this.incomplete && count !== this.pages.length) {
      this.findings.add(
        'pdf.pages.count',
        `The page tree Count is ${count}, but ${this.pages.length} pages were found.`,
        root.object === null ? {} : { object: root.object },
      );
    }
    return count;
  }

  private limit(kind: string, message: string) {
    if (this.limited.has(kind)) return;
    this.limited.add(kind);
    this.findings.add('pdf.tree.limit', message);
  }

  private async visit(r: Resolved, depth: number, inherited: Inherited): Promise<void> {
    if (this.stopped) return;
    const dict = r.value as PdfValue & { kind: 'dict' };
    const at = r.object === null ? {} : { object: r.object };
    // PG-4
    if (r.object !== null) {
      if (this.seen.has(r.object)) {
        this.findings.add(
          'pdf.pages.loop',
          `Object ${r.object} is reached twice in the page tree.`,
          at,
        );
        return;
      }
      this.seen.add(r.object);
    }
    // PG-2, PG-3
    const type = asName(dictGet(dict, 'Type'));
    const kids = (await this.resolver.resolve(dictGet(dict, 'Kids'))).value;
    if (type !== 'Pages' && type !== 'Page') {
      this.findings.add('pdf.pages.kid', 'A page tree entry is neither /Pages nor /Page.', at);
    }
    // PG-5
    const own = {
      mediaBox: dictGet(dict, 'MediaBox') ?? inherited.mediaBox,
      cropBox: dictGet(dict, 'CropBox') ?? inherited.cropBox,
      rotate: dictGet(dict, 'Rotate') ?? inherited.rotate,
    };
    const isNode = type === 'Pages' || (type !== 'Page' && kids?.kind === 'array');
    if (!isNode) return this.page(r, own);
    for (const kid of kids?.kind === 'array' ? kids.items : []) {
      if (this.stopped) return;
      const child = await this.resolver.resolve(kid);
      if (child.value?.kind !== 'dict') {
        if (child.unavailable) {
          this.incomplete = true;
          continue;
        }
        this.findings.add('pdf.pages.kid', 'A Kids entry does not lead to a dictionary.', at);
        continue;
      }
      if (depth + 1 > MAX_DEPTH) {
        this.limit(
          'depth',
          `The page tree is nested deeper than ${MAX_DEPTH}; deeper nodes are skipped.`,
        );
        continue;
      }
      await this.visit(child, depth + 1, own);
    }
  }

  /** PG-6, PG-8, ANN */
  private async page(r: Resolved, attrs: Inherited) {
    if (this.pages.length >= this.limits.maxPages) {
      this.stopped = true;
      this.limit('pages', `More than ${this.limits.maxPages} pages; the rest are not listed.`);
      return;
    }
    const dict = r.value as PdfValue;
    const index = this.pages.length;
    const mediaBox = rectangle((await this.resolver.resolve(attrs.mediaBox)).value);
    if (!mediaBox) {
      this.findings.add(
        'pdf.page.mediabox',
        `Page ${index + 1} has no MediaBox rectangle, even inherited.`,
        r.object === null ? {} : { object: r.object },
      );
    }
    const rotate = asInteger((await this.resolver.resolve(attrs.rotate)).value) ?? 0;
    // REP-10: a page's own actions come before its annotations'.
    await this.visitor.page({ index, object: r.object, dict });
    const page: Page = {
      index,
      object: r.object,
      mediaBox,
      // PG-6: the crop box defaults to the media box.
      cropBox: rectangle((await this.resolver.resolve(attrs.cropBox)).value) ?? mediaBox,
      rotate,
      annotations: await this.annots(index, dictGet(dict, 'Annots')),
    };
    this.pages.push(page);
  }

  /** ANN-1, ANN-2 */
  private async annots(page: number, value: PdfValue | undefined): Promise<Annotation[]> {
    const list = (await this.resolver.resolve(value)).value;
    const out: Annotation[] = [];
    for (const item of list?.kind === 'array' ? list.items : []) {
      const a = await this.resolver.resolve(item);
      if (a.value?.kind !== 'dict') continue;
      if (this.annotations >= this.limits.maxAnnotations) {
        this.limit(
          'annotations',
          `More than ${this.limits.maxAnnotations} annotations; the rest are not read.`,
        );
        break;
      }
      this.annotations++;
      out.push({ object: a.object, subtype: asName(dictGet(a.value, 'Subtype')) });
      await this.visitor.annotation({ page, object: a.object, dict: a.value });
    }
    return out;
  }
}

/** PG-6: an array of four numbers (7.9.5). */
function rectangle(v: PdfValue | null): number[] | null {
  if (v?.kind !== 'array' || v.items.length !== 4) return null;
  const out: number[] = [];
  for (const x of v.items) {
    if (x.kind !== 'number') return null;
    out.push(x.value);
  }
  return out;
}

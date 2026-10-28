/** Actions at every place ISO 32000-1 defines (actions.md: ACT-1..15). Never performed. */
import type { FindingList } from './findings.ts';
import { asName, dictGet, type PdfValue } from './parser.ts';
import type { Resolved, Resolver } from './resolver.ts';
import { decodeText, ENCRYPTED_TEXT, plain, textOf } from './text.ts';
import type { Action, ActionSource, Script, Text } from './types.ts';

/** ACT-4, ACT-15 */
const MAX_DEPTH = 64;

/** Table 198 */
const TYPES = new Set([
  'GoTo',
  'GoToR',
  'GoToE',
  'Launch',
  'Thread',
  'URI',
  'Sound',
  'Movie',
  'Hide',
  'Named',
  'SubmitForm',
  'ResetForm',
  'ImportData',
  'JavaScript',
  'SetOCGState',
  'Rendition',
  'Trans',
  'GoTo3DView',
]);

/** ACT-1: additional-actions keys by source, and the ones that run without a click. */
const CATALOG_EVENTS = ['WC', 'WS', 'DS', 'WP', 'DP'];
const PAGE_EVENTS = ['O', 'C'];
const ANNOTATION_EVENTS = ['E', 'X', 'D', 'U', 'Fo', 'Bl', 'PO', 'PC', 'PV', 'PI'];
const FIELD_EVENTS = ['K', 'F', 'V', 'C'];
const AUTOMATIC: Record<ActionSource, ReadonlySet<string>> = {
  catalog: new Set(['OpenAction']),
  names: new Set(['JavaScript']),
  page: new Set(['O']),
  annotation: new Set(['PO', 'PV']),
  field: new Set(),
  outline: new Set(),
};

interface Place {
  readonly source: ActionSource;
  readonly event: string;
  readonly page?: number;
  readonly holder?: number | null;
  readonly label?: string;
}

export interface ActionLimits {
  readonly maxActions: number;
  readonly maxTreeItems: number;
}

export class ActionCollector {
  readonly actions: Action[] = [];
  /** SCR-8: every action dictionary listed, by identity. */
  readonly dicts = new Set<PdfValue>();
  outlineItems = 0;
  fieldItems = 0;
  private readonly resolver: Resolver;
  private readonly findings: FindingList;
  private readonly encrypted: boolean;
  private readonly limits: ActionLimits;
  /** ACT-5: holder and event already read. */
  private readonly places = new Set<string>();
  private readonly limited = new Set<string>();
  private full = false;

  constructor(
    resolver: Resolver,
    findings: FindingList,
    options: { encrypted: boolean; limits: ActionLimits },
  ) {
    this.resolver = resolver;
    this.findings = findings;
    this.encrypted = options.encrypted;
    this.limits = options.limits;
  }

  /** ACT-1: OpenAction and the catalog's AA. */
  async catalog(dict: PdfValue, object: number | null) {
    await this.take(dictGet(dict, 'OpenAction'), {
      source: 'catalog',
      event: 'OpenAction',
      holder: object,
    });
    await this.additional(dict, CATALOG_EVENTS, { source: 'catalog', holder: object });
  }

  /** ACT-1: a page's AA. */
  async page(index: number, object: number | null, dict: PdfValue) {
    await this.additional(dict, PAGE_EVENTS, { source: 'page', page: index, holder: object });
  }

  /** ACT-1: an annotation's A and AA. */
  async annotation(
    page: number | undefined,
    object: number | null,
    dict: PdfValue,
    label?: string,
  ) {
    const place = {
      source: 'annotation' as const,
      holder: object,
      ...(page === undefined ? {} : { page }),
      ...(label === undefined ? {} : { label }),
    };
    await this.take(dictGet(dict, 'A'), { ...place, event: 'A' });
    await this.additional(dict, ANNOTATION_EVENTS, place);
  }

  /** ACT-14: the JavaScript name tree. */
  async names(catalog: PdfValue) {
    const names = (await this.resolver.resolve(dictGet(catalog, 'Names'))).value;
    const root = await this.resolver.resolve(dictGet(names, 'JavaScript'));
    const tree = new TreeWalk(this, this.resolver, 'names');
    await tree.visit(root, 0, async (node) => {
      const pairs = (await this.resolver.resolve(dictGet(node.value, 'Names'))).value;
      const items = pairs?.kind === 'array' ? pairs.items : [];
      for (let i = 0; i + 1 < items.length; i += 2) {
        const key = textOf((await this.resolver.resolve(items[i])).value, this.encrypted);
        await this.take(items[i + 1], {
          source: 'names',
          event: 'JavaScript',
          ...(key?.text == null ? {} : { label: key.text }),
        });
      }
      return dictGet(node.value, 'Kids');
    });
  }

  /** ACT-13: the form field tree. */
  async fields(catalog: PdfValue) {
    const form = (await this.resolver.resolve(dictGet(catalog, 'AcroForm'))).value;
    const tree = new TreeWalk(this, this.resolver, 'fields');
    const names = new Map<Resolved, string>();
    await tree.visitAll(dictGet(form, 'Fields'), 0, async (node, parent) => {
      this.fieldItems++;
      const partial = textOf(
        (await this.resolver.resolve(dictGet(node.value, 'T'))).value,
        this.encrypted,
      );
      const inherited = parent ? names.get(parent) : undefined;
      const name =
        partial?.text == null
          ? inherited
          : inherited
            ? `${inherited}.${partial.text}`
            : partial.text;
      if (name !== undefined) names.set(node, name);
      const place = { holder: node.object, ...(name === undefined ? {} : { label: name }) };
      await this.additional(node.value, FIELD_EVENTS, { ...place, source: 'field' });
      await this.annotation(undefined, node.object, node.value as PdfValue, name);
      return dictGet(node.value, 'Kids');
    });
  }

  /** ACT-12: the outline. */
  async outline(catalog: PdfValue) {
    const outlines = (await this.resolver.resolve(dictGet(catalog, 'Outlines'))).value;
    const tree = new TreeWalk(this, this.resolver, 'outline');
    await tree.visitSiblings(dictGet(outlines, 'First'), 0, async (item) => {
      this.outlineItems++;
      const title = textOf(
        (await this.resolver.resolve(dictGet(item.value, 'Title'))).value,
        this.encrypted,
      );
      await this.take(dictGet(item.value, 'A'), {
        source: 'outline',
        event: 'A',
        holder: item.object,
        ...(title?.text == null ? {} : { label: title.text }),
      });
    });
  }

  /** SCR-8: some actions were not listed, or some places not read. */
  get cut() {
    return this.full || this.limited.size > 0;
  }

  /** Once per kind (ACT-15, ACT-4). */
  limit(kind: string, message: string) {
    if (this.limited.has(kind)) return;
    this.limited.add(kind);
    this.findings.add('pdf.tree.limit', message);
  }

  loop(object: number | null, where: string) {
    this.findings.add(
      'pdf.tree.loop',
      `An item of the ${where} is reached twice; it is skipped.`,
      object === null ? {} : { object },
    );
  }

  get maxTreeItems() {
    return this.limits.maxTreeItems;
  }

  private async additional(
    dict: PdfValue | null,
    events: readonly string[],
    place: Omit<Place, 'event'>,
  ) {
    const aa = (await this.resolver.resolve(dictGet(dict, 'AA'))).value;
    if (aa?.kind !== 'dict') return;
    for (const event of events) {
      if (aa.entries.has(event)) await this.take(aa.entries.get(event), { ...place, event });
    }
  }

  /** ACT-2, ACT-5: the action at one place, with its Next chain. */
  private async take(value: PdfValue | undefined, place: Place) {
    if (value === undefined) return;
    if (place.holder !== undefined && place.holder !== null) {
      const key = `${place.holder}:${place.event}`;
      if (this.places.has(key)) return;
      this.places.add(key);
    }
    const r = await this.resolver.resolve(value);
    if (r.value?.kind !== 'dict') return;
    await this.chain(r, place, AUTOMATIC[place.source].has(place.event), 0, new Set());
  }

  /** ACT-3, ACT-4, ACT-6..11 */
  private async chain(
    r: Resolved,
    place: Place,
    automatic: boolean,
    depth: number,
    seen: Set<unknown>,
  ) {
    if (this.full) return;
    const identity = r.object ?? r.value;
    if (seen.has(identity)) {
      this.findings.add(
        'pdf.action.loop',
        'A Next chain reaches an action a second time; it is not followed again.',
        r.object === null ? {} : { object: r.object },
      );
      return;
    }
    seen.add(identity);
    if (depth > MAX_DEPTH) {
      this.limit('next', `A Next chain is deeper than ${MAX_DEPTH}; the rest is skipped.`);
      return;
    }
    if (this.actions.length >= this.limits.maxActions) {
      this.full = true;
      this.findings.add(
        'pdf.too-many-actions',
        `More than ${this.limits.maxActions} actions; the rest are not listed.`,
      );
      return;
    }
    const dict = r.value as PdfValue;
    this.dicts.add(dict);
    const s = dictGet(dict, 'S');
    const type = s?.kind === 'name' ? s.text : '';
    const at =
      r.object === null ? (place.holder ? { object: place.holder } : {}) : { object: r.object };
    if (!TYPES.has(type)) {
      this.findings.add('pdf.action.unknown', `The action type "${type}" is not in Table 198.`, at);
    }
    const target = await this.target(type, dict);
    const script =
      type === 'JavaScript' || type === 'Rendition'
        ? await readScript(this.resolver, dict, 'JS', this.encrypted)
        : undefined;
    const action: Action = {
      type,
      source: place.source,
      event: place.event,
      automatic,
      depth,
      ...(place.page === undefined ? {} : { page: place.page }),
      ...(place.holder === undefined || place.holder === null ? {} : { holder: place.holder }),
      ...(r.object === null ? {} : { object: r.object }),
      ...(place.label === undefined ? {} : { label: place.label }),
      ...(target ? { target } : {}),
      ...(script ? { script } : {}),
    };
    this.actions.push(action);
    this.report(action, at, dictGet(dict, 'JS') !== undefined);
    // ACT-4
    const next = await this.resolver.resolve(dictGet(dict, 'Next'));
    const links =
      next.value?.kind === 'array'
        ? next.value.items
        : next.value?.kind === 'dict'
          ? [dictGet(dict, 'Next') as PdfValue]
          : [];
    for (const link of links) {
      const n = await this.resolver.resolve(link);
      if (n.value?.kind === 'dict') await this.chain(n, place, automatic, depth + 1, seen);
    }
  }

  /** ACT-9, ACT-10 */
  private report(a: Action, at: { object?: number }, hasScript: boolean) {
    const where = `${a.source} ${a.event}${a.page === undefined ? '' : ` on page ${a.page + 1}`}`;
    if (a.type === 'JavaScript' || (a.type === 'Rendition' && hasScript)) {
      this.findings.add('pdf.action.javascript', `A JavaScript action (${where}).`, at);
    } else if (a.type === 'Launch') {
      this.findings.add('pdf.action.launch', `A launch action (${where}).`, at);
    } else if (a.type === 'SubmitForm') {
      this.findings.add('pdf.action.submit-form', `A submit-form action (${where}).`, at);
    } else if (a.type === 'ImportData') {
      this.findings.add('pdf.action.import-data', `An import-data action (${where}).`, at);
    } else if (a.type === 'GoToR' || a.type === 'GoToE') {
      this.findings.add(
        'pdf.action.remote',
        `A ${a.type} action opens another file (${where}).`,
        at,
      );
    }
    if (a.automatic) {
      this.findings.add(
        'pdf.action.automatic',
        `A ${a.type || 'typeless'} action runs without a click (${where}).`,
        at,
      );
    }
  }

  /** ACT-6 */
  private async target(type: string, dict: PdfValue): Promise<Text | undefined> {
    const value = async (key: string, from: PdfValue | null = dict) =>
      (await this.resolver.resolve(dictGet(from, key))).value;
    switch (type) {
      case 'URI':
        return textOf(await value('URI'), this.encrypted) ?? undefined;
      case 'Launch': {
        const file = await this.file(await value('F'));
        if (file) return file;
        const win = await value('Win');
        const name = textOf(await value('F', win), this.encrypted);
        const parms = textOf(await value('P', win), this.encrypted);
        if (!name || name.text === null) return name ?? undefined;
        return parms?.text
          ? { text: `${name.text} ${parms.text}`, truncated: name.truncated || parms.truncated }
          : name;
      }
      case 'GoToR':
      case 'GoToE':
      case 'SubmitForm':
      case 'ImportData':
        return this.file(await value('F'));
      case 'Named': {
        const n = await value('N');
        return n?.kind === 'name' ? plain(n.text) : undefined;
      }
      case 'GoTo': {
        const d = await value('D');
        if (d?.kind === 'name') return plain(d.text);
        return textOf(d, this.encrypted) ?? undefined;
      }
      default:
        return undefined;
    }
  }

  /** ACT-6: a file specification (7.11, Table 44). */
  private async file(v: PdfValue | null): Promise<Text | undefined> {
    const text = textOf(v, this.encrypted);
    if (text) return text;
    if (v?.kind !== 'dict') return undefined;
    for (const key of ['UF', 'F', 'Unix', 'Mac', 'DOS']) {
      const t = textOf((await this.resolver.resolve(dictGet(v, key))).value, this.encrypted);
      if (t) return t;
    }
    return undefined;
  }
}

/** ACT-7, ACT-8: the script under `key` of `dict`: a string, or a stream decoded (FLT). */
export async function readScript(
  resolver: Resolver,
  dict: PdfValue | null,
  key: string,
  encrypted: boolean,
): Promise<Script | undefined> {
  const r = await resolver.resolve(dictGet(dict, key));
  return stringScript(r.value, encrypted) ?? streamScript(resolver, r, encrypted);
}

/** ACT-7, ACT-8: a string value as script text, or undefined. */
export function stringScript(
  v: PdfValue | null | undefined,
  encrypted: boolean,
): Script | undefined {
  if (v?.kind !== 'string') return undefined;
  return { text: textOf(v, encrypted) ?? ENCRYPTED_TEXT, byteLength: v.bytes.length };
}

/** ACT-7, ACT-8: a stream's data as script text. */
export async function streamScript(
  resolver: Resolver,
  r: Resolved,
  encrypted: boolean,
): Promise<Script | undefined> {
  if (!r.stream) return undefined;
  if (encrypted) return { text: ENCRYPTED_TEXT, byteLength: r.stream.byteLength };
  const data = await resolver.streamData(r);
  return data ? { text: decodeText(data), byteLength: data.length } : undefined;
}

/** ACT-15: one tree walk with its visited set, item count, and depth limit. */
class TreeWalk {
  private readonly seen = new Set<number>();
  private items = 0;
  private readonly collector: ActionCollector;
  private readonly resolver: Resolver;
  private readonly name: string;

  constructor(collector: ActionCollector, resolver: Resolver, name: string) {
    this.collector = collector;
    this.resolver = resolver;
    this.name = name;
  }

  /** False when the item was seen or the limits are reached. */
  private enter(r: Resolved, depth: number): boolean {
    if (depth > MAX_DEPTH) {
      this.collector.limit(
        `${this.name}-depth`,
        `The ${this.name} tree is deeper than ${MAX_DEPTH}; the rest is skipped.`,
      );
      return false;
    }
    if (r.object !== null) {
      if (this.seen.has(r.object)) {
        this.collector.loop(r.object, `${this.name} tree`);
        return false;
      }
      this.seen.add(r.object);
    }
    if (this.items >= this.collector.maxTreeItems) {
      this.collector.limit(
        this.name,
        `The ${this.name} tree has more than ${this.collector.maxTreeItems} items; the rest is skipped.`,
      );
      return false;
    }
    this.items++;
    return true;
  }

  /** A node, then its kids (name trees). `each` returns the kids. */
  async visit(r: Resolved, depth: number, each: (node: Resolved) => Promise<PdfValue | undefined>) {
    if (r.value?.kind !== 'dict' || !this.enter(r, depth)) return;
    const kids = (await this.resolver.resolve(await each(r))).value;
    for (const kid of kids?.kind === 'array' ? kids.items : []) {
      await this.visit(await this.resolver.resolve(kid), depth + 1, each);
    }
  }

  /** Each node of an array, then its kids (field trees). */
  async visitAll(
    list: PdfValue | undefined,
    depth: number,
    each: (node: Resolved, parent: Resolved | null) => Promise<PdfValue | undefined>,
    parent: Resolved | null = null,
  ) {
    const items = (await this.resolver.resolve(list)).value;
    for (const item of items?.kind === 'array' ? items.items : []) {
      const node = await this.resolver.resolve(item);
      if (node.value?.kind !== 'dict' || !this.enter(node, depth)) continue;
      const kids = await each(node, parent);
      await this.visitAll(kids, depth + 1, each, node);
    }
  }

  /** Items linked by First and Next (outlines); siblings in a loop, children one level down. */
  async visitSiblings(
    first: PdfValue | undefined,
    depth: number,
    each: (item: Resolved) => Promise<void>,
  ) {
    let next = first;
    while (next !== undefined) {
      const item = await this.resolver.resolve(next);
      if (item.value?.kind !== 'dict' || !this.enter(item, depth)) return;
      await each(item);
      await this.visitSiblings(dictGet(item.value, 'First'), depth + 1, each);
      next = dictGet(item.value, 'Next');
    }
  }
}

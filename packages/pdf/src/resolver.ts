/** References and object streams (streams.md: RES-1..4, OST-1..6; ADR 0011). */
import type { Reader } from '@benchside/core';
import { DECODE_BUDGET, decodeStream, MAX_DECODED } from './filters.ts';
import { FindingList } from './findings.ts';
import { Lexer } from './lexer.ts';
import { type ReadContext, readLarge } from './objects.ts';
import { asInteger, asName, dictGet, Parser, type PdfValue } from './parser.ts';
import type { Merged } from './revisions.ts';
import type { StreamInfo } from './types.ts';

export interface Resolved {
  readonly value: PdfValue | null;
  /** The object the value came from; null for a direct value. */
  readonly object: number | null;
  readonly stream: StreamInfo | null;
  /** OST-6: a compressed object of an encrypted file, which cannot be read. */
  readonly unavailable?: true;
}

/** RES-2 */
const MAX_HOPS = 32;
const NONE: Resolved = { value: null, object: null, stream: null };
const UNAVAILABLE: Resolved = { ...NONE, unavailable: true };

/** OST-1, OST-2: a decoded object stream and its header. */
type Container =
  | {
      readonly kind: 'ok';
      readonly data: Uint8Array;
      readonly first: number;
      readonly pairs: [number, number][];
    }
  | { readonly kind: 'failed' };

export interface ResolverOptions {
  readonly reader: Reader;
  readonly objects: ReadonlyMap<number, Merged>;
  readonly findings: FindingList;
  readonly context: ReadContext;
  readonly encrypted: boolean;
}

export class Resolver {
  /**
   * SCR-8: references that led to an object that exists but could not be read, or to a chain
   * longer than RES-2. A walk compares it before and after.
   */
  misses = 0;
  /** FLT-9: decoding left for this analysis. */
  readonly budget = { left: DECODE_BUDGET };
  private readonly options: ResolverOptions;
  /** Keyed by object number and generation (RES-1). */
  private readonly cache = new Map<string, Resolved>();
  private readonly containers = new Map<number, Container>();
  /** Object streams and objects already reported, so each finding appears once. */
  private readonly reported = new Set<string>();

  constructor(options: ResolverOptions) {
    this.options = options;
  }

  /** RES-1, RES-2: a value with every reference followed. */
  async resolve(v: PdfValue | null | undefined): Promise<Resolved> {
    let current: Resolved = { value: v ?? null, object: null, stream: null };
    for (let hops = 0; current.value?.kind === 'ref'; hops++) {
      if (hops >= MAX_HOPS) {
        this.misses++;
        return NONE;
      }
      current = await this.load(current.value.number, current.value.generation);
    }
    return current;
  }

  /** A value already in the cache, or undefined. */
  cached(number: number, generation: number): Resolved | undefined {
    return this.cache.get(`${number} ${generation}`);
  }

  /**
   * RES-1: the object `number` with `generation`, or null. `findings` receives the syntax
   * findings of a compressed object; `cache: false` keeps a one-off read out of memory.
   */
  async load(
    number: number,
    generation: number,
    { findings, cache = true }: { findings?: FindingList; cache?: boolean } = {},
  ): Promise<Resolved> {
    const key = `${number} ${generation}`;
    const known = this.cache.get(key);
    if (known) return known;
    const merged = this.options.objects.get(number);
    let result = NONE;
    if (merged?.entry.type === 'in-use' && merged.entry.generation === generation) {
      result = await this.readInUse(number, merged.entry.offset, generation);
    } else if (merged?.entry.type === 'compressed' && generation === 0) {
      result = await this.readCompressed(
        number,
        merged.entry.container,
        merged.entry.index,
        findings,
      );
    }
    const exists =
      (merged?.entry.type === 'in-use' && merged.entry.generation === generation) ||
      (merged?.entry.type === 'compressed' && generation === 0);
    if (exists && result.value === null) this.misses++;
    if (cache) this.cache.set(key, result);
    return result;
  }

  /** RES-4, FLT: a stream's decoded data, or null with a finding. */
  async streamData(r: Resolved): Promise<Uint8Array | null> {
    if (!r.stream || this.options.encrypted) return null;
    const at = { offset: r.stream.dataOffset, ...(r.object === null ? {} : { object: r.object }) };
    if (r.stream.byteLength > MAX_DECODED) {
      this.options.findings.add('pdf.filter.limit', 'The stream is larger than 32 MiB.', at);
      return null;
    }
    const raw = await this.options.reader.bytes(r.stream.dataOffset, r.stream.byteLength);
    if (!raw) return null;
    const out = await decodeStream(raw, await this.direct(r.value), this.budget);
    const findings = this.options.findings;
    switch (out.kind) {
      case 'ok':
        return out.bytes;
      case 'unsupported':
        findings.add(
          'pdf.filter.unsupported',
          `The stream uses ${out.filter || 'an unnamed filter'}, which is not decoded.`,
          at,
        );
        return null;
      case 'limit':
        findings.add('pdf.filter.limit', 'Decoding the stream passes the decoding limit.', at);
        return null;
      case 'error':
        findings.add(
          'pdf.filter.error',
          `The stream does not decode with ${out.filter}: ${out.message}.`,
          at,
        );
        return null;
    }
  }

  /** FLT-1: the stream dictionary with Filter and DecodeParms, and their items, made direct. */
  private async direct(dict: PdfValue | null): Promise<PdfValue | null> {
    if (dict?.kind !== 'dict') return dict;
    const entries = new Map(dict.entries);
    for (const key of ['Filter', 'DecodeParms']) {
      const v = (await this.resolve(dict.entries.get(key))).value;
      if (v === null) continue;
      const items =
        v.kind === 'array'
          ? await Promise.all(v.items.map(async (x) => (await this.resolve(x)).value ?? x))
          : null;
      entries.set(key, items ? { kind: 'array', items } : v);
    }
    return { kind: 'dict', entries };
  }

  /** RES-3: findings for in-use objects come from the objects list, so this read keeps none. */
  private async readInUse(number: number, offset: number, generation: number): Promise<Resolved> {
    const ref = { number, generation };
    const o = await readLarge(
      this.options.reader,
      offset,
      new FindingList(),
      ref,
      this.options.context,
    );
    if (o.kind !== 'read') return NONE;
    return { value: o.object.indirect.value, object: number, stream: o.object.stream };
  }

  /** OST-3, OST-4 */
  private async readCompressed(
    number: number,
    containerNumber: number,
    index: number,
    findings: FindingList | undefined,
  ): Promise<Resolved> {
    if (this.options.encrypted) return UNAVAILABLE; // OST-6
    const container = await this.container(containerNumber);
    if (container.kind === 'failed') return NONE;
    const pair = container.pairs[index];
    if (!pair || pair[0] !== number) {
      this.once(`m${number}`, () =>
        this.options.findings.add(
          'pdf.objstm.missing',
          `Object ${number} is not at index ${index} of object stream ${containerNumber}.`,
          { object: number },
        ),
      );
      return NONE;
    }
    const start = container.first + pair[1];
    if (start >= container.data.length) return NONE;
    const parsed = new FindingList(Number.POSITIVE_INFINITY);
    const value = new Parser(new Lexer(container.data.subarray(start)), parsed).parseValue();
    // Offsets inside decoded data are not file offsets; the findings name the object instead.
    for (const f of parsed.list) findings?.add(f.id, f.message, { object: number });
    return { value, object: number, stream: null };
  }

  /** OST-1, OST-2: decodes object stream `number` once. */
  private async container(number: number): Promise<Container> {
    const known = this.containers.get(number);
    if (known) return known;
    const result = await this.openContainer(number);
    this.containers.set(number, result);
    return result;
  }

  private async openContainer(number: number): Promise<Container> {
    const failed: Container = { kind: 'failed' };
    const invalid = (why: string) => {
      this.options.findings.add('pdf.objstm.invalid', `Object stream ${number} ${why}.`, {
        object: number,
      });
      return failed;
    };
    const merged = this.options.objects.get(number);
    if (merged?.entry.type !== 'in-use') return invalid('is not an object in use');
    const r = await this.readInUse(number, merged.entry.offset, merged.entry.generation);
    const n = asInteger(dictGet(r.value, 'N'));
    const first = asInteger(dictGet(r.value, 'First'));
    if (
      !r.stream ||
      asName(dictGet(r.value, 'Type')) !== 'ObjStm' ||
      n === null ||
      n < 0 ||
      first === null ||
      first < 0
    ) {
      return invalid('is not a stream with Type /ObjStm, N, and First');
    }
    const data = await this.streamData(r);
    if (!data) return failed;
    const lexer = new Lexer(data.subarray(0, first));
    const pairs: [number, number][] = [];
    while (pairs.length < n) {
      const a = lexer.next();
      const b = lexer.next();
      if (a.kind !== 'number' || b.kind !== 'number' || !a.integer || !b.integer) break;
      pairs.push([a.value, b.value]);
    }
    if (pairs.length < n) invalid(`has ${pairs.length} of its ${n} header pairs`);
    return { kind: 'ok', data, first, pairs };
  }

  private once(key: string, report: () => void) {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    report();
  }
}

/** Scripts outside actions (scripts.md: SCR-1..10; ADR 0012). Never run. */
import { readScript, streamScript, stringScript } from './actions.ts';
import { FindingList } from './findings.ts';
import { asName, dictGet, MAX_DEPTH, type PdfValue } from './parser.ts';
import type { Resolved, Resolver } from './resolver.ts';
import { textOf } from './text.ts';
import type { FindingId, ScriptItem } from './types.ts';
import { findXfaScripts } from './xfa.ts';

const utf8 = new TextDecoder('utf-8');

/** SCR-7: JavaScript dictionaries in a value, without following references. */
export function javaScriptDicts(
  value: PdfValue | null | undefined,
  found: PdfValue[] = [],
  depth = 0,
): PdfValue[] {
  if (!value || depth > MAX_DEPTH) return found;
  if (value.kind === 'dict') {
    if (value.entries.has('JS') || value.entries.has('OnInstantiate')) found.push(value);
    for (const v of value.entries.values()) javaScriptDicts(v, found, depth + 1);
  } else if (value.kind === 'array') {
    for (const v of value.items) javaScriptDicts(v, found, depth + 1);
  }
  return found;
}

/** SCR-6: Table 88. */
function isPostScript(dict: PdfValue | null) {
  const subtype = asName(dictGet(dict, 'Subtype'));
  return subtype === 'PS' || (subtype === 'Form' && asName(dictGet(dict, 'Subtype2')) === 'PS');
}

const scriptKey = (dict: PdfValue) => (dictGet(dict, 'JS') === undefined ? 'OnInstantiate' : 'JS');

interface Listed {
  readonly number: number;
  readonly generation: number;
}

export class ScriptCollector {
  readonly scripts: ScriptItem[] = [];
  private readonly resolver: Resolver;
  private readonly findings: FindingList;
  private readonly encrypted: boolean;
  private readonly maxScripts: number;
  private full = false;
  /** SCR-2: 3D streams listed, by object or value. */
  private readonly streams3d = new Set<unknown>();
  /** SCR-8: 3D stream dictionaries the walk reached, by identity. */
  private readonly reached3d = new Set<PdfValue>();
  /** SCR-7: newest copies that hold a JavaScript dictionary, with the value read. */
  private readonly candidates: (Listed & { readonly value: PdfValue })[] = [];
  private readonly holders = new Set<number>();
  /** SCR-9: objects whose newest copy was read, or is free. */
  private readonly read = new Set<number>();
  /** SCR-9: older copies already searched, by number and offset. */
  private readonly olderSeen = new Set<string>();
  /** SCR-6: PostScript streams listed, by object or value. */
  private readonly psListed = new Set<unknown>();
  private readonly postscript: Listed[] = [];
  /** SCR-9: older copies that hold one, newest revision first. */
  private readonly older: { number: number; revision: number; dicts: PdfValue[] }[] = [];

  constructor(
    resolver: Resolver,
    findings: FindingList,
    options: { encrypted: boolean; maxScripts: number },
  ) {
    this.resolver = resolver;
    this.findings = findings;
    this.encrypted = options.encrypted;
    this.maxScripts = options.maxScripts;
  }

  /** OBX: each object as it is listed. */
  object(number: number, generation: number, value: PdfValue | null, stream: boolean) {
    if (!value) return;
    this.read.add(number);
    if (javaScriptDicts(value).length > 0) {
      this.candidates.push({ number, generation, value });
      this.holders.add(number);
    }
    if (stream && isPostScript(value)) this.postscript.push({ number, generation });
  }

  /** SCR-9: an object whose newest entry is free holds no JavaScript. */
  freed(number: number) {
    this.read.add(number);
  }

  /** MAP-1: each older copy, newest revision first. */
  olderCopy(number: number, offset: number, revision: number, value: PdfValue | null) {
    const key = `${number} ${offset}`;
    if (this.olderSeen.has(key)) return;
    this.olderSeen.add(key);
    const dicts = javaScriptDicts(value);
    if (dicts.length > 0) this.older.push({ number, revision, dicts });
  }

  /** SCR-2: a 3D annotation's stream and its OnInstantiate script. */
  async annotation(page: number, object: number | null, dict: PdfValue) {
    if (asName(dictGet(dict, 'Subtype')) !== '3D') return;
    let s = await this.resolver.resolve(dictGet(dict, '3DD'));
    if (!s.stream && s.value?.kind === 'dict') {
      s = await this.resolver.resolve(dictGet(s.value, '3DD'));
    }
    if (!s.stream || s.value?.kind !== 'dict') return;
    const identity = s.object ?? s.value;
    if (this.streams3d.has(identity)) return;
    this.streams3d.add(identity);
    this.reached3d.add(s.value);
    if (dictGet(s.value, 'OnInstantiate') === undefined) return;
    const activation = (await this.resolver.resolve(dictGet(dict, '3DA'))).value;
    const event = asName(dictGet(activation, 'A')) ?? 'XA';
    const automatic = event === 'PO' || event === 'PV';
    const script = await readScript(this.resolver, s.value, 'OnInstantiate', this.encrypted);
    const at = s.object === null ? {} : { object: s.object };
    this.add(
      {
        source: '3d',
        language: 'JavaScript',
        automatic,
        ...at,
        ...(object === null ? {} : { holder: object }),
        page,
        event,
        ...(script ? { script } : {}),
      },
      'pdf.script.3d',
      `A 3D stream on page ${page + 1} runs JavaScript when instantiated${
        automatic ? ', without a click' : ''
      }.`,
      at,
    );
  }

  /** SCR-3, SCR-4: script elements in the XFA resource. */
  async xfa(catalog: PdfValue) {
    const form = (await this.resolver.resolve(dictGet(catalog, 'AcroForm'))).value;
    const entry = dictGet(form, 'XFA');
    if (entry === undefined) return;
    if (this.encrypted) {
      this.findings.add(
        'pdf.xfa',
        'The form has an XFA resource. The file is encrypted, so its scripts were not searched.',
      );
      return;
    }
    this.findings.add('pdf.xfa', 'The form has an XFA resource: an XML form with its own scripts.');
    const x = await this.resolver.resolve(entry);
    const packets: { label?: string; stream: Resolved }[] = [];
    if (x.stream) packets.push({ stream: x });
    const items = x.value?.kind === 'array' ? x.value.items : [];
    for (let i = 0; i + 1 < items.length; i += 2) {
      const name = textOf((await this.resolver.resolve(items[i])).value, false);
      const stream = await this.resolver.resolve(items[i + 1]);
      if (!name || !stream.stream) continue;
      packets.push({ ...(name.text === null ? {} : { label: name.text }), stream });
    }
    // SCR-3: the packets make up one resource, so their texts are searched joined.
    const parts: { start: number; label?: string; at: { object?: number } }[] = [];
    let xml = '';
    for (const { label, stream } of packets) {
      const data = await this.resolver.streamData(stream);
      if (!data) continue;
      parts.push({
        start: xml.length,
        ...(label === undefined ? {} : { label }),
        at: stream.object === null ? {} : { object: stream.object },
      });
      xml += utf8.decode(data);
    }
    const scan = findXfaScripts(xml, this.maxScripts - this.scripts.length + 1);
    for (const s of scan.scripts) {
      const { label, at } = parts.findLast((p) => p.start <= s.offset) ?? { at: {} };
      this.add(
        {
          source: 'xfa',
          language: s.language,
          automatic: false,
          ...at,
          ...(s.event === undefined ? {} : { event: s.event }),
          ...(label === undefined ? {} : { label }),
          script: { text: s.text, byteLength: s.byteLength },
        },
        'pdf.script.xfa',
        `An XFA script${s.event === undefined ? '' : ` in the ${s.event} event`}${
          label === undefined ? '' : ` (packet ${label})`
        }.`,
        at,
      );
    }
    if (!scan.complete && !this.full) {
      this.findings.add(
        'pdf.xfa.incomplete',
        'The XFA search stopped at its work limit; later scripts are not listed.',
      );
    }
  }

  /**
   * SCR-6..9, after the walk: `actions` holds every action dictionary ACT listed; `cut` says
   * that the walk stopped at a limit or could not read an object.
   */
  async finish(actions: ReadonlySet<PdfValue>, cut: boolean) {
    const quiet = { findings: new FindingList(), cache: false };
    for (const { number, generation } of this.postscript) {
      if (this.full) return;
      const r = await this.resolver.load(number, generation, quiet);
      await this.postScript(r, number);
      const level1 = await this.resolver.resolve(dictGet(r.value, 'Level1'));
      if (level1.stream) await this.postScript(level1, level1.object, 'Level1');
    }
    for (const { number, generation, value } of this.candidates) {
      if (this.full) return;
      // A walked object is in the cache, so its dictionaries are the ones ACT saw. One the walk
      // never reached is not, and the value the objects list read is as good.
      const current = this.resolver.cached(number, generation)?.value ?? value;
      for (const dict of javaScriptDicts(current)) {
        if (actions.has(dict) || this.reached3d.has(dict)) continue;
        const script = await readScript(this.resolver, dict, scriptKey(dict), this.encrypted);
        this.add(
          {
            source: cut ? 'unchecked' : 'unreached',
            language: 'JavaScript',
            automatic: false,
            object: number,
            ...(script ? { script } : {}),
          },
          cut ? 'pdf.script.unchecked' : 'pdf.script.unreached',
          cut
            ? `Object ${number} holds JavaScript the walk did not reach, but the walk was cut short, so it may be reached.`
            : `Object ${number} holds JavaScript that no action place or 3D annotation reaches. Readers do not run it from the document; other tools or scripts might.`,
          { object: number },
        );
      }
    }
    for (const { number, revision, dicts } of this.older) {
      if (this.full) return;
      if (!this.read.has(number) || this.holders.has(number)) continue;
      for (const dict of dicts) {
        this.add(
          {
            source: 'removed',
            language: 'JavaScript',
            automatic: false,
            object: number,
            revision,
            ...this.directScript(dict),
          },
          'pdf.script.removed',
          `Revision ${revision} held JavaScript in object ${number}; a later revision removed it.`,
          { object: number },
        );
      }
    }
  }

  private async postScript(r: Resolved, object: number | null, label?: string) {
    const identity = r.object ?? r.value;
    if (this.full || this.psListed.has(identity)) return;
    this.psListed.add(identity);
    const script = await streamScript(this.resolver, r, this.encrypted);
    const at = object === null ? {} : { object };
    this.add(
      {
        source: 'postscript',
        language: 'PostScript',
        automatic: false,
        ...at,
        ...(label === undefined ? {} : { label }),
        ...(script ? { script } : {}),
      },
      'pdf.script.postscript',
      `${object === null ? 'A' : `Object ${object} is a`} PostScript XObject${
        label === undefined ? '' : ` ${label} stream`
      }: code for PostScript printers.`,
      at,
    );
  }

  /** SCR-9: only a string; a reference would be read in the newest revision. */
  private directScript(dict: PdfValue) {
    const script = stringScript(dictGet(dict, scriptKey(dict)), this.encrypted);
    return script ? { script } : {};
  }

  /** SCR-10 */
  private add(item: ScriptItem, id: FindingId, message: string, at: { object?: number }) {
    if (this.full) return;
    if (this.scripts.length >= this.maxScripts) {
      this.full = true;
      this.findings.add(
        'pdf.too-many-scripts',
        `More than ${this.maxScripts} scripts; the rest are not listed.`,
      );
      return;
    }
    this.scripts.push(item);
    this.findings.add(id, message, at);
  }
}

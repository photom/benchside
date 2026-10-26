import {
  analyzeZip,
  type ByteSource,
  blobSource,
  type NestedResult,
  openNested,
  type ParameterInput,
  type ZipReport,
} from '@benchside/zip';
import { MAX_READ } from './protocol.ts';

interface Opened {
  readonly source: ByteSource;
  readonly report: ZipReport;
}

const keyOf = (path: readonly number[]) => path.join('/');

/** The open file and the chain of nested archives being viewed (0007). */
export class ArchiveChain {
  // By path; '' is the top level.
  private readonly cache = new Map<string, Opened>();
  // Bumped by every new file, so work for an older file never fills the cache.
  private generation = 0;
  // Bumped by every open; only the latest open fills the cache.
  private opens = 0;

  async analyze(file: Blob, parameters: ParameterInput = {}): Promise<ZipReport> {
    const mine = ++this.generation;
    this.cache.clear();
    const source = blobSource(file);
    // PAR-13: nested archives reuse the report's parameters.
    const report = await analyzeZip(source, { parameters });
    if (mine === this.generation) this.cache.set('', { source, report });
    return report;
  }

  async open(path: readonly number[]): Promise<NestedResult> {
    const mine = this.generation;
    const myOpen = ++this.opens;
    this.keepOnly(path);
    let current = this.cache.get('');
    if (!current) throw new Error('No archive is open.');
    for (let depth = 1; depth <= path.length; depth++) {
      const key = keyOf(path.slice(0, depth));
      const cached = this.cache.get(key);
      if (cached) {
        current = cached;
        continue;
      }
      const opened = await openNested(current.source, current.report, path[depth - 1] as number);
      if (opened.kind === 'refused') return opened;
      current = { source: opened.source, report: opened.report };
      if (mine === this.generation && myOpen === this.opens) this.cache.set(key, current);
    }
    return { kind: 'report', report: current.report };
  }

  /** HEX-3, HEX-9: at most MAX_READ bytes of the archive cached for `path`. */
  async read(path: readonly number[], offset: number, byteLength: number): Promise<Uint8Array> {
    const opened = this.cache.get(keyOf(path));
    if (!opened) throw new Error('That archive is not open.');
    const size = opened.source.byteLength;
    const start = Math.min(Math.max(0, offset), size);
    const length = Math.max(0, Math.min(byteLength, MAX_READ, size - start));
    // A copy: a view into a nested archive would post its whole buffer (HEX-3).
    return (await opened.source.read(start, length)).slice();
  }

  /** For tests. */
  cachedPaths(): string[] {
    return [...this.cache.keys()];
  }

  /** Drops cached archives that are not on `path`. */
  private keepOnly(path: readonly number[]) {
    for (const key of this.cache.keys()) {
      const keyPath = key === '' ? [] : key.split('/').map(Number);
      if (!keyPath.every((index, i) => path[i] === index)) this.cache.delete(key);
    }
  }
}

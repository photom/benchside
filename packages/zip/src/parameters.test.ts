import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS, resolveParameters, SECURITY_CHECKS } from './parameters.ts';

const MiB = 1024 * 1024;

describe('parameters', () => {
  it('PAR-1..10: given nothing, when resolved, then every default from parameters.md', () => {
    expect(resolveParameters()).toEqual({
      maxNestingDepth: 8,
      maxNestedBytes: 256 * MiB,
      ratioThreshold: 100,
      ratioMinBytes: MiB,
      totalBytesThreshold: 1024 * MiB,
      maxFiles: 10_000,
      targetFileSystem: 'all',
      maxPathBytes: 4096,
      maxPathDepth: 64,
      checks: Object.fromEntries(SECURITY_CHECKS.map((c) => [c, true])),
    });
    expect(DEFAULT_PARAMETERS).toEqual(resolveParameters());
  });

  it('PAR-11: given numbers outside their ranges, when resolved, then clamped to the nearest end', () => {
    const p = resolveParameters({
      maxNestingDepth: 0,
      maxNestedBytes: 10 * 1024 * MiB,
      ratioThreshold: 5,
      ratioMinBytes: -1,
      totalBytesThreshold: 1,
      maxFiles: 1e9,
      maxPathBytes: 0,
      maxPathDepth: 5000,
    });
    expect(p).toMatchObject({
      maxNestingDepth: 1,
      maxNestedBytes: 1024 * MiB,
      ratioThreshold: 10,
      ratioMinBytes: 0,
      totalBytesThreshold: MiB,
      maxFiles: 100_000,
      maxPathBytes: 1,
      maxPathDepth: 1024,
    });
  });

  it('PAR-11: given a number that is not finite, when resolved, then its default', () => {
    expect(resolveParameters({ ratioThreshold: Number.NaN, maxFiles: Infinity })).toMatchObject({
      ratioThreshold: 100,
      maxFiles: 10_000,
    });
  });

  it('PAR-11: given fractional byte values, when resolved, then rounded down', () => {
    expect(resolveParameters({ ratioMinBytes: 1000.9 }).ratioMinBytes).toBe(1000);
  });

  it('PAR-10: given one check turned off, when resolved, then the others stay on', () => {
    const { checks } = resolveParameters({ checks: { symlink: false } });
    expect(checks.symlink).toBe(false);
    expect(checks['path-traversal']).toBe(true);
  });

  it('PAR-7: given an unknown target file system, when resolved, then all', () => {
    expect(resolveParameters({ targetFileSystem: 'beos' as never }).targetFileSystem).toBe('all');
  });
});

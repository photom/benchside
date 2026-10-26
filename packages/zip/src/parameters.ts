/** User-adjustable parameters (parameters.md). */

export type TargetFileSystem = 'all' | 'windows' | 'macos' | 'linux';

export const SECURITY_CHECKS = [
  'path-traversal',
  'absolute-path',
  'backslash',
  'duplicate-name',
  'name-collision',
  'reserved-name',
  'symlink',
  'control-character',
  'bidi-character',
  'long-path',
  'compression-ratio',
  'total-size',
  'file-count',
  'overlapping-entries',
] as const;

export type SecurityCheck = (typeof SECURITY_CHECKS)[number];

export interface Parameters {
  readonly maxNestingDepth: number;
  readonly maxNestedBytes: number;
  readonly ratioThreshold: number;
  readonly ratioMinBytes: number;
  readonly totalBytesThreshold: number;
  readonly maxFiles: number;
  readonly targetFileSystem: TargetFileSystem;
  readonly maxPathBytes: number;
  readonly maxPathDepth: number;
  readonly checks: Readonly<Record<SecurityCheck, boolean>>;
}

export type ParameterInput = Partial<Omit<Parameters, 'checks'>> & {
  readonly checks?: Partial<Record<SecurityCheck, boolean>>;
};

const MiB = 1024 * 1024;

export type NumberParameter = Exclude<keyof Parameters, 'targetFileSystem' | 'checks'>;
type NumberKey = NumberParameter;

// parameters.md: default, minimum, maximum; bytes are whole numbers.
const RANGES: Record<NumberKey, { value: number; min: number; max: number; bytes?: true }> = {
  maxNestingDepth: { value: 8, min: 1, max: 32 },
  maxNestedBytes: { value: 256 * MiB, min: MiB, max: 1024 * MiB, bytes: true },
  ratioThreshold: { value: 100, min: 10, max: 10_000 },
  ratioMinBytes: { value: MiB, min: 0, max: 1024 * MiB, bytes: true },
  totalBytesThreshold: { value: 1024 * MiB, min: MiB, max: 1024 * 1024 * MiB, bytes: true },
  maxFiles: { value: 10_000, min: 1, max: 100_000 },
  maxPathBytes: { value: 4096, min: 1, max: 65_535, bytes: true },
  maxPathDepth: { value: 64, min: 1, max: 1024 },
};

export const TARGET_FILE_SYSTEMS: readonly TargetFileSystem[] = [
  'all',
  'windows',
  'macos',
  'linux',
];
const TARGETS = TARGET_FILE_SYSTEMS;

/** PAR-11: defaults for missing values, clamping for out-of-range ones. */
export function resolveParameters(input: ParameterInput = {}): Parameters {
  const numbers = {} as Record<NumberKey, number>;
  for (const [key, range] of Object.entries(RANGES) as [NumberKey, (typeof RANGES)[NumberKey]][]) {
    const given = input[key];
    let value = typeof given === 'number' && Number.isFinite(given) ? given : range.value;
    value = Math.min(range.max, Math.max(range.min, value));
    numbers[key] = range.bytes ? Math.floor(value) : value;
  }
  const target = input.targetFileSystem;
  return {
    ...numbers,
    targetFileSystem: target && TARGETS.includes(target) ? target : 'all',
    checks: Object.fromEntries(
      SECURITY_CHECKS.map((check) => [check, input.checks?.[check] ?? true]),
    ) as Record<SecurityCheck, boolean>,
  };
}

export const DEFAULT_PARAMETERS: Parameters = resolveParameters();

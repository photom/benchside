/** Names shown for parameters and security checks (parameters.md, security.md). */
import {
  type NumberParameter,
  type SecurityCheck,
  TARGET_FILE_SYSTEMS,
  type TargetFileSystem,
} from '@benchside/zip';

export const MiB = 1024 * 1024;

type Group = 'Nested archives' | 'Zip bombs' | 'Names';

// A Record, so a parameter added to the package without a label fails to compile.
const NUMBER_LABELS: Record<
  NumberParameter,
  { label: string; unit?: 'MiB' | 'bytes'; group: Group }
> = {
  maxNestingDepth: { label: 'Max nesting depth', group: 'Nested archives' },
  maxNestedBytes: { label: 'Max nested size', unit: 'MiB', group: 'Nested archives' },
  ratioThreshold: { label: 'Compression ratio threshold', group: 'Zip bombs' },
  ratioMinBytes: { label: 'Minimum size for the ratio check', unit: 'MiB', group: 'Zip bombs' },
  totalBytesThreshold: { label: 'Total size threshold', unit: 'MiB', group: 'Zip bombs' },
  maxFiles: { label: 'Max number of files', group: 'Zip bombs' },
  maxPathBytes: { label: 'Max path length', unit: 'bytes', group: 'Names' },
  maxPathDepth: { label: 'Max path depth', group: 'Names' },
};

export const NUMBER_PARAMETERS = (Object.keys(NUMBER_LABELS) as NumberParameter[]).map((key) => ({
  key,
  ...NUMBER_LABELS[key],
}));

const TARGET_LABELS: Record<TargetFileSystem, string> = {
  all: 'All',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

export const TARGETS = TARGET_FILE_SYSTEMS.map((value) => ({ value, label: TARGET_LABELS[value] }));

export const CHECK_LABELS: Record<SecurityCheck, string> = {
  'path-traversal': 'Path traversal (..)',
  'absolute-path': 'Absolute paths',
  backslash: 'Backslashes',
  'duplicate-name': 'Duplicate names',
  'name-collision': 'Name collisions',
  'reserved-name': 'Reserved Windows names',
  symlink: 'Symbolic links',
  'control-character': 'Control characters',
  'bidi-character': 'Bidirectional characters',
  'long-path': 'Long paths',
  'compression-ratio': 'Compression ratio',
  'total-size': 'Total size',
  'file-count': 'Number of files',
  'overlapping-entries': 'Overlapping entries',
};

/** A parameter value as shown: sizes in MiB. */
export const shown = (key: NumberParameter, value: number) =>
  NUMBER_PARAMETERS.find((p) => p.key === key)?.unit === 'MiB' ? value / MiB : value;

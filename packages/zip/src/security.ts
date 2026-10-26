/** Security checks (security.md). */
import type { FindingList } from './findings.ts';
import type { Parameters, SecurityCheck } from './parameters.ts';
import type { EndRecords, Entry, FindingId } from './types.ts';

// Built from its code point, so this file holds no backslash escapes.
const BACKSLASH = String.fromCharCode(0x5c);
const DRIVE = /^[A-Za-z]:/;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/;
const FORBIDDEN = ['<', '>', ':', '"', '|', '?', '*'];
const UNIX_HOST = 3;
const SYMLINK_TYPE = 0xa; // mode >>> 12 (S_IFLNK)
const encoder = new TextEncoder();

/** Components: the name split on "/" and backslash, empty parts dropped. */
const components = (name: string) =>
  name
    .split('/')
    .flatMap((part) => part.split(BACKSLASH))
    .filter((part) => part !== '');

export function securityFindings(
  entries: readonly Entry[],
  end: EndRecords | null,
  params: Parameters,
  findings: FindingList,
): void {
  const on = (check: SecurityCheck) => params.checks[check];
  const add = (id: FindingId, entry: Entry, message: string) =>
    findings.add(id, message, { offset: entry.central.offset, entry: entry.index });

  for (const entry of entries) {
    const name = entry.name.text;
    const parts = components(name);
    const quoted = JSON.stringify(name);
    if (on('path-traversal') && parts.includes('..')) {
      add(
        'sec.path-traversal',
        entry,
        `${quoted} has a ".." component and can escape the target folder.`,
      );
    }
    if (
      on('absolute-path') &&
      (name.startsWith('/') || name.startsWith(BACKSLASH) || DRIVE.test(name))
    ) {
      add('sec.absolute-path', entry, `${quoted} is an absolute path.`);
    }
    if (on('backslash') && name.includes(BACKSLASH)) {
      add(
        'sec.backslash',
        entry,
        `${quoted} uses a backslash; some extractors treat it as a folder separator.`,
      );
    }
    if (
      on('reserved-name') &&
      (params.targetFileSystem === 'windows' || params.targetFileSystem === 'all')
    ) {
      const bad = parts.find(windowsProblem);
      if (bad !== undefined) {
        add(
          'sec.reserved-name',
          entry,
          `${quoted}: ${JSON.stringify(bad)} ${windowsProblem(bad)} on Windows.`,
        );
      }
    }
    if (on('symlink') && isSymlink(entry)) {
      add(
        'sec.symlink',
        entry,
        `${quoted} is a symbolic link; extracting it can redirect later entries.`,
      );
    }
    const codes = [...name].map((c) => c.codePointAt(0) as number);
    if (on('control-character') && codes.some(isControl)) {
      add('sec.control-character', entry, `${quoted} contains control characters.`);
    }
    if (on('bidi-character') && codes.some(isBidi)) {
      add(
        'sec.bidi-character',
        entry,
        `${quoted} contains bidirectional control characters that can disguise its extension.`,
      );
    }
    if (on('long-path')) {
      const bytes = encoder.encode(name).length;
      if (bytes > params.maxPathBytes || parts.length > params.maxPathDepth) {
        add(
          'sec.long-path',
          entry,
          `${quoted} is ${bytes} bytes and ${parts.length} levels deep; the limits are ${params.maxPathBytes} bytes and ${params.maxPathDepth} levels.`,
        );
      }
    }
    if (on('compression-ratio') && entry.kind === 'file') {
      const ratio = ratioAbove(entry.uncompressedSize, entry.compressedSize, params);
      if (ratio !== null) {
        add(
          'sec.compression-ratio',
          entry,
          `${quoted} expands from ${entry.compressedSize} to ${entry.uncompressedSize} bytes: ratio ${ratio} is above ${params.ratioThreshold}.`,
        );
      }
    }
  }

  if (on('duplicate-name')) {
    for (const group of groups(entries, (e) => e.name.text)) {
      groupFinding(findings, 'sec.duplicate-name', group, 'have the same name');
    }
  }
  if (on('name-collision') && params.targetFileSystem !== 'linux') {
    const key = collisionKey(params.targetFileSystem);
    for (const group of groups(entries, (e) => key(e.name.text))) {
      // Exact duplicates are SEC-4's.
      if (new Set(group.map((e) => e.name.text)).size > 1) {
        groupFinding(
          findings,
          'sec.name-collision',
          group,
          `are the same file on ${params.targetFileSystem === 'all' ? 'Windows or macOS' : params.targetFileSystem}`,
        );
      }
    }
  }

  const files = entries.filter((e) => e.kind === 'file');
  const total = files.reduce((n, e) => n + e.uncompressedSize, 0);
  const compressed = files.reduce((n, e) => n + e.compressedSize, 0);
  if (on('compression-ratio') && files[0]) {
    const ratio = ratioAbove(total, compressed, params);
    if (ratio !== null) {
      findings.add(
        'sec.archive-ratio',
        `The archive expands from ${compressed} to ${total} bytes: ratio ${ratio} is above ${params.ratioThreshold}.`,
      );
    }
  }
  if (on('total-size') && total > params.totalBytesThreshold) {
    findings.add(
      'sec.total-size',
      `The entries add up to ${total} bytes, above ${params.totalBytesThreshold}.`,
    );
  }
  if (on('file-count') && end && end.entryCount > params.maxFiles) {
    findings.add(
      'sec.file-count',
      `The archive declares ${end.entryCount} entries, above ${params.maxFiles}.`,
      { offset: end.eocd.offset },
    );
  }
  if (on('overlapping-entries')) overlaps(entries, findings);
}

/** SEC-10, SEC-11: the ratio, rounded, when it is above the threshold; else null. */
function ratioAbove(uncompressed: number, compressed: number, params: Parameters): string | null {
  if (uncompressed < params.ratioMinBytes || uncompressed === 0) return null;
  if (compressed === 0) return 'infinite';
  const ratio = uncompressed / compressed;
  return ratio > params.ratioThreshold ? String(Number(ratio.toFixed(1))) : null;
}

/** SEC-6a: what is wrong with a component on Windows, or undefined. */
function windowsProblem(part: string): string | undefined {
  if (part === '.' || part === '..') return undefined;
  if (RESERVED.test((part.split('.')[0] ?? '').toUpperCase())) return 'is a reserved device name';
  if (FORBIDDEN.some((c) => part.includes(c))) return 'has a character Windows forbids';
  if (part.endsWith('.') || part.endsWith(' ')) return 'ends with a dot or space';
  return undefined;
}

function isSymlink(entry: Entry): boolean {
  const c = entry.central;
  return (
    c.versionMadeBy.raw >>> 8 === UNIX_HOST && c.externalAttributes.raw >>> 28 === SYMLINK_TYPE
  );
}

const isControl = (c: number) => c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f);
const isBidi = (c: number) =>
  c === 0x61c ||
  c === 0x200e ||
  c === 0x200f ||
  (c >= 0x202a && c <= 0x202e) ||
  (c >= 0x2066 && c <= 0x2069);

/** SEC-5a */
function collisionKey(target: Parameters['targetFileSystem']): (name: string) => string {
  const fold = (s: string) => s.toUpperCase().toLowerCase();
  const mac = target === 'macos' || target === 'all';
  const win = target === 'windows' || target === 'all';
  return (name) => {
    let parts = components(name);
    if (mac) parts = parts.map((p) => p.normalize('NFC'));
    if (win) parts = parts.map((p) => p.replace(/[. ]+$/, ''));
    return fold(parts.join('/'));
  };
}

/** Groups of two or more entries with the same key, in entry order. */
function groups(entries: readonly Entry[], key: (e: Entry) => string): Entry[][] {
  const map = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = key(e);
    const group = map.get(k);
    if (group) group.push(e);
    else map.set(k, [e]);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

/** SEC-15: the first entry carries the finding; the message names them all. */
function groupFinding(findings: FindingList, id: FindingId, group: Entry[], what: string) {
  const first = group[0] as Entry;
  const list = group.map((e) => `${e.index} ${JSON.stringify(e.name.text)}`).join(', ');
  findings.add(id, `Entries ${list} ${what}.`, {
    offset: first.central.offset,
    entry: first.index,
  });
}

/** SEC-14: each entry whose local header and data share bytes with an earlier-starting one. */
function overlaps(entries: readonly Entry[], findings: FindingList) {
  const spans = entries
    .filter((e) => e.local && e.data)
    .map((e) => ({
      entry: e,
      start: e.local?.offset as number,
      end: (e.data?.offset as number) + (e.data?.byteLength as number),
    }))
    .sort((a, b) => a.start - b.start || a.entry.index - b.entry.index);
  let furthest: (typeof spans)[number] | null = null;
  for (const span of spans) {
    if (furthest && span.start < furthest.end) {
      const [a, b] =
        furthest.entry.index < span.entry.index
          ? [furthest.entry, span.entry]
          : [span.entry, furthest.entry];
      findings.add(
        'sec.overlapping-entries',
        `Entries ${a.index} ${JSON.stringify(a.name.text)} and ${b.index} ${JSON.stringify(b.name.text)} share bytes; extracting both reads the same data twice.`,
        { offset: a.central.offset, entry: a.index },
      );
    }
    if (!furthest || span.end > furthest.end) furthest = span;
  }
}

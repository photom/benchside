import {
  type DecodedExtra,
  decodeCp437,
  decodeUtf8,
  type Entry,
  type ExtraBlock,
  type MismatchField,
  type RefusalReason,
} from '@benchside/zip';
import type { ComponentChildren } from 'preact';
import { bytesHex, crc, hex, offset } from './format.ts';

export const REFUSALS: Record<RefusalReason, string> = {
  directory: 'It is a directory.',
  'too-deep': 'Nesting is limited to 8 levels.',
  encrypted: 'The entry is encrypted.',
  'unsupported-method': 'Only stored and deflated entries can be opened.',
  unreadable: "The entry's local header or data could not be read.",
  'too-large': 'The entry is larger than 256 MiB.',
  'size-exceeded': 'The content is larger than the central directory says.',
  'inflate-failed': 'The deflated data is damaged.',
};

export type OpenState =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'refused'; reason: RefusalReason }
  | { kind: 'failed'; message: string };

const NAME_SOURCES = {
  'utf-8-flag': 'UTF-8 (flag bit 11)',
  'unicode-path': 'UTF-8 (Unicode Path extra field)',
  cp437: 'Code Page 437',
} as const;

export function EntryDetail({
  entry,
  open,
  onOpen,
}: {
  entry: Entry;
  open: OpenState;
  onOpen: () => void;
}) {
  const c = entry.central;
  const l = entry.local;
  const differs = (...fields: MismatchField[]) => fields.some((f) => entry.mismatches.includes(f));
  const localName = l
    ? entry.name.source === 'utf-8-flag'
      ? decodeUtf8(l.nameBytes).text
      : decodeCp437(l.nameBytes)
    : null;
  return (
    <section aria-label="Entry detail">
      <h3>{entry.name.text}</h3>
      <p>
        Name read as {NAME_SOURCES[entry.name.source]}. Raw bytes:{' '}
        <code>{bytesHex(entry.name.bytes)}</code>
      </p>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Central directory</th>
            <th>Local header</th>
            <th>Compared</th>
          </tr>
        </thead>
        <tbody>
          <Row
            name="File name"
            central={entry.name.text}
            local={localName}
            differs={differs('name')}
          />
          <Row
            name="Version needed"
            central={c.versionNeeded.spec}
            local={l?.versionNeeded.spec}
            differs={differs('versionNeeded')}
          />
          <Row
            name="Flags"
            central={flagText(c.flags.raw, c.flags.bits)}
            local={l && flagText(l.flags.raw, l.flags.bits)}
            differs={differs('flags')}
          />
          <Row
            name="Method"
            central={`${c.method.code} ${c.method.name}`}
            local={l && `${l.method.code} ${l.method.name}`}
            differs={differs('method')}
          />
          <Row
            name="Modified"
            central={
              c.modified.text ?? `invalid (${hex(c.modified.date, 4)} ${hex(c.modified.time, 4)})`
            }
            local={
              l &&
              (l.modified.text ?? `invalid (${hex(l.modified.date, 4)} ${hex(l.modified.time, 4)})`)
            }
            differs={differs('time', 'date')}
          />
          <Row
            name="CRC-32"
            central={crc(c.crc32)}
            local={l && crc(l.crc32)}
            differs={differs('crc32')}
          />
          <Row
            name="Compressed size"
            central={sizeText(c.compressedSize, entry.compressedSize)}
            local={l && sizeText(l.compressedSize, l.effectiveCompressedSize)}
            differs={differs('compressedSize')}
          />
          <Row
            name="Uncompressed size"
            central={sizeText(c.uncompressedSize, entry.uncompressedSize)}
            local={l && sizeText(l.uncompressedSize, l.effectiveUncompressedSize)}
            differs={differs('uncompressedSize')}
          />
          <Row
            name="Version made by"
            central={`${c.versionMadeBy.host}, ${c.versionMadeBy.spec}`}
          />
          <Row name="Disk number start" central={String(c.diskStart)} />
          <Row
            name="Internal attributes"
            central={`0x${hex(c.internalAttributes.raw, 4)}${c.internalAttributes.text ? ' text' : ''}`}
          />
          <Row
            name="External attributes"
            central={[
              `0x${hex(c.externalAttributes.raw, 8)}`,
              ...c.externalAttributes.dos,
              c.externalAttributes.unixMode,
            ]
              .filter(Boolean)
              .join(' ')}
          />
          <Row name="Local header offset" central={offset(entry.localHeaderOffset)} />
          <Row name="Header offset" central={offset(c.offset)} local={l && offset(l.offset)} />
          {entry.comment.text !== '' && <Row name="Comment" central={entry.comment.text} />}
        </tbody>
      </table>
      <p>
        File data:{' '}
        {entry.data ? `${offset(entry.data.offset)}, ${entry.data.byteLength} bytes` : 'not found'}
        {entry.descriptor &&
          `. Data descriptor at ${offset(entry.descriptor.offset)}, ${entry.descriptor.byteLength} bytes${entry.descriptor.signature ? ' with signature' : ''}: CRC-32 ${crc(entry.descriptor.crc32)}, sizes ${entry.descriptor.compressedSize} / ${entry.descriptor.uncompressedSize}`}
      </p>
      <h4>Extra fields</h4>
      <ExtraList title="Central directory" blocks={c.extra} />
      {l && <ExtraList title="Local header" blocks={l.extra} />}
      {entry.kind === 'file' && (
        <p>
          <button type="button" onClick={onOpen} disabled={open.kind === 'opening'}>
            Open as archive
          </button>{' '}
          <span role="status">
            {open.kind === 'opening' && 'Opening…'}
            {open.kind === 'refused' && `Cannot open: ${REFUSALS[open.reason]}`}
            {open.kind === 'failed' && `Cannot open: ${open.message}`}
          </span>
        </p>
      )}
    </section>
  );
}

function Row({
  name,
  central,
  local,
  differs = false,
}: {
  name: string;
  central: ComponentChildren;
  local?: ComponentChildren;
  differs?: boolean;
}) {
  return (
    <tr data-differs={differs}>
      <th scope="row">{name}</th>
      <td>{central}</td>
      <td>{local ?? '—'}</td>
      <td>{local === undefined ? '' : differs ? 'differs' : ''}</td>
    </tr>
  );
}

const flagText = (raw: number, bits: readonly { bit: number; name: string }[]) =>
  [`0x${hex(raw, 4)}`, ...bits.map((b) => `bit ${b.bit}: ${b.name}`)].join('; ');

const sizeText = (raw: number, effective: number) =>
  raw === effective ? String(raw) : `${effective} (field ${raw}, from ZIP64)`;

function ExtraList({ title, blocks }: { title: string; blocks: readonly ExtraBlock[] }) {
  return (
    <>
      <h5>{title}</h5>
      {blocks.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {blocks.map((b) => (
            <li key={b.offset}>
              {b.id !== null && `0x${hex(b.id, 4)} `}
              {b.name}, {b.byteLength} bytes at {offset(b.offset)}: {decoded(b)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function decoded(b: ExtraBlock): string {
  if (b.zip64) {
    const v = b.zip64;
    return [
      v.uncompressedSize !== undefined && `uncompressed size ${v.uncompressedSize}`,
      v.compressedSize !== undefined && `compressed size ${v.compressedSize}`,
      v.localHeaderOffset !== undefined && `local header offset ${v.localHeaderOffset}`,
      v.diskStart !== undefined && `disk ${v.diskStart}`,
    ]
      .filter(Boolean)
      .join(', ');
  }
  if (b.unicodePath) {
    const u = b.unicodePath;
    return `version ${u.version}, name "${u.name}", CRC-32 ${u.matches ? 'matches' : 'does not match'}`;
  }
  const preview = bytesHex(b.preview) + (b.byteLength > b.preview.length ? ' …' : '');
  // The bytes stay visible next to decoded values, so a malformed block can be checked.
  if (b.decoded) return `${decodedText(b.decoded)}; bytes ${preview}`;
  return preview;
}

const times = (t: Partial<Record<'modified' | 'accessed' | 'created', { text: string | null }>>) =>
  (['modified', 'accessed', 'created'] as const)
    .filter((k) => t[k])
    .map((k) => `${k} ${t[k]?.text ?? 'not set'}`);

/** EXT-5..9 */
function decodedText(d: DecodedExtra): string {
  switch (d.kind) {
    case 'timestamp':
      return [`flags 0x${hex(d.flags, 2)}`, ...times(d)].join(', ');
    case 'unix-owner':
      if (d.version !== 1) return `version ${d.version}, not decoded`;
      return (
        [d.uid !== undefined && `UID ${d.uid}`, d.gid !== undefined && `GID ${d.gid}`]
          .filter(Boolean)
          .join(', ') || 'no UID or GID'
      );
    case 'ntfs':
      return [
        ...times(d),
        ...d.attributes
          .filter((a) => a.tag !== 1)
          .map((a) => `attribute 0x${hex(a.tag, 4)}, ${a.byteLength} bytes`),
      ].join(', ');
    case 'aes':
      return [
        d.version === 'unknown' ? `vendor version ${d.vendorVersion} (unknown)` : d.version,
        `vendor ID ${JSON.stringify(d.vendorId)}`,
        d.keyBits === null ? `strength ${d.strength} (unknown)` : `${d.keyBits}-bit key`,
        `real method ${d.method.name} (${d.method.code})`,
      ].join(', ');
    case 'alignment':
      return [
        `alignment ${d.alignment} bytes`,
        `${d.paddingBytes} padding bytes`,
        d.aligned !== null && `file data ${d.aligned ? '' : 'not '}aligned`,
      ]
        .filter(Boolean)
        .join(', ');
    default: {
      const never: never = d;
      return never;
    }
  }
}

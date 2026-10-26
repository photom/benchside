import { type FieldSpan, type Region, regionFields, type ZipReport } from '@benchside/zip';
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ZipHost } from '../worker/host.ts';
import { MAX_READ } from '../worker/protocol.ts';
import { hex, offset } from './format.ts';
import { REGION_NAMES } from './labels.ts';

/** HEX-1: what to show; `mark` is a finding's offset (HEX-8). */
export interface HexTarget {
  readonly region: Region;
  readonly mark?: number;
}

// HEX-2
const PAGE = MAX_READ;
const ROW = 16;

type Span = { readonly offset: number; readonly byteLength: number };
type Page =
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly bytes: Uint8Array }
  | { readonly kind: 'failed'; readonly message: string };

const holds = (span: Span, at: number) => at >= span.offset && at < span.offset + span.byteLength;
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** HEX-5 */
const ascii = (b: number) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.');

export function HexView({
  report,
  target,
  host,
}: {
  report: ZipReport;
  target: HexTarget;
  host: ZipHost;
}) {
  const { region, mark } = target;
  const fields = useMemo(() => regionFields(report, region), [report, region]);
  const pages = Math.max(1, Math.ceil(region.byteLength / PAGE));
  const pageOf = (at: number) =>
    Math.min(pages - 1, Math.max(0, Math.floor((at - region.offset) / PAGE)));
  const [page, setPage] = useState(mark === undefined ? 0 : pageOf(mark));
  // HEX-8: a finding marks the field holding its offset, or that one byte.
  const [selected, setSelected] = useState<Span | null>(
    mark === undefined
      ? null
      : (fields.find((f) => holds(f, mark)) ?? { offset: mark, byteLength: 1 }),
  );
  const [state, setState] = useState<Page>({ kind: 'reading' });
  const start = region.offset + page * PAGE;
  const length = Math.min(PAGE, region.offset + region.byteLength - start);
  const pathKey = report.path.join('/');

  // HEX-3: read only this page.
  useEffect(() => {
    let live = true;
    setState({ kind: 'reading' });
    host.read(report.path, start, length).then(
      (bytes) => live && setState({ kind: 'read', bytes }),
      (error: unknown) => {
        if (live && !isAbort(error)) setState({ kind: 'failed', message: String(error) });
      },
    );
    return () => {
      live = false;
    };
    // report.path is compared by its key.
  }, [host, pathKey, start, length]);

  const section = useRef<HTMLElement>(null);
  useEffect(() => section.current?.scrollIntoView?.({ block: 'nearest' }), []);

  const bytes = state.kind === 'read' ? state.bytes : null;
  const isMarked = (at: number) => selected !== null && holds(selected, at);

  return (
    <section aria-label="Hex view" ref={section}>
      <h2>Bytes</h2>
      <p>
        {REGION_NAMES[region.kind]}
        {region.entry !== undefined && `, entry ${region.entry}`}: {region.byteLength} bytes at{' '}
        {offset(region.offset)}
      </p>
      <p>
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </button>{' '}
        Page {page + 1} of {pages}{' '}
        <button type="button" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </p>
      {state.kind === 'reading' && <p role="status">Reading…</p>}
      {state.kind === 'failed' && <p role="alert">The bytes could not be read: {state.message}</p>}
      {bytes && (
        <table aria-label="Bytes" class="hex">
          <thead>
            <tr>
              <th>Offset</th>
              <th>Hex</th>
              <th>ASCII</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            {rowStarts(bytes.length).map((from) => {
              const row = bytes.subarray(from, from + ROW);
              const at = start + from;
              return (
                <tr key={at}>
                  <td>{offset(at)}</td>
                  <td>{cells(row, at, (b) => hex(b, 2), isMarked, ' ')}</td>
                  <td>{cells(row, at, ascii, isMarked, '')}</td>
                  <td>
                    {fields
                      .filter((f) => f.offset >= at && f.offset < at + row.length)
                      .map((f) => f.name)
                      .join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {fields.length > 0 && (
        <table aria-label="Fields">
          <thead>
            <tr>
              <th>Field</th>
              <th>Offset</th>
              <th>Length</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f.offset} data-selected={selected === f}>
                <th scope="row">
                  <button
                    type="button"
                    class="link"
                    onClick={() => {
                      // HEX-7
                      setSelected(f);
                      setPage(pageOf(f.offset));
                    }}
                  >
                    {f.name}
                  </button>
                </th>
                <td>{offset(f.offset)}</td>
                <td>{f.byteLength}</td>
                <td>{bytes ? value(f, bytes, start) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const rowStarts = (length: number) =>
  Array.from({ length: Math.ceil(length / ROW) }, (_, i) => i * ROW);

/** HEX-8: marked bytes sit in `mark`, so the marking does not rely on color. */
function cells(
  row: Uint8Array,
  at: number,
  text: (b: number) => string,
  isMarked: (at: number) => boolean,
  gap: string,
): ComponentChildren[] {
  return [...row].flatMap((b, i) => {
    const cell = isMarked(at + i) ? <mark key={i}>{text(b)}</mark> : text(b);
    return i > 0 && gap ? [gap, cell] : [cell];
  });
}

/** HEX-7: little-endian value of a number field of 1–8 bytes, all on the page. */
function value(field: FieldSpan, bytes: Uint8Array, start: number): string {
  const from = field.offset - start;
  if (!field.numeric || field.byteLength > 8) return '';
  if (from < 0 || from + field.byteLength > bytes.length) return '';
  let n = 0n;
  for (let i = field.byteLength - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[from + i] as number);
  return `${n} (0x${n.toString(16)})`;
}

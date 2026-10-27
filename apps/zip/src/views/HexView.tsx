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
type Status =
  | { readonly kind: 'reading' }
  | { readonly kind: 'read' }
  | { readonly kind: 'failed'; readonly message: string };
/** The page on screen: its first offset and its bytes. */
type Shown = { readonly start: number; readonly bytes: Uint8Array };
/** One state, so the bytes on screen and the read status change together. */
type Screen = { readonly shown: Shown | null; readonly status: Status };

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
  // HEX-4: the last page read stays on screen while the next is read, so the view never blanks.
  const [screen, setScreen] = useState<Screen>({ shown: null, status: { kind: 'reading' } });
  const start = region.offset + page * PAGE;
  const length = Math.min(PAGE, region.offset + region.byteLength - start);
  const pathKey = report.path.join('/');

  // HEX-3: read only this page.
  useEffect(() => {
    let live = true;
    setScreen((s) => ({ ...s, status: { kind: 'reading' } }));
    host.read(report.path, start, length).then(
      (bytes) => {
        if (live) setScreen({ shown: { start, bytes }, status: { kind: 'read' } });
      },
      (error: unknown) => {
        // HEX-9: a failed read leaves no old bytes that could pass for this page.
        if (live && !isAbort(error)) {
          setScreen({ shown: null, status: { kind: 'failed', message: String(error) } });
        }
      },
    );
    return () => {
      live = false;
    };
    // report.path is compared by its key.
  }, [host, pathKey, start, length]);

  const section = useRef<HTMLElement>(null);
  useEffect(() => section.current?.scrollIntoView?.({ block: 'nearest' }), []);

  const { shown, status } = screen;
  const bytes = shown?.bytes ?? null;
  const shownStart = shown?.start ?? start;
  // HEX-4: the number of the page on screen, not of the one being read.
  const shownPage = Math.floor((shownStart - region.offset) / PAGE) + 1;
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
        Page {shownPage} of {pages}{' '}
        <button type="button" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>
          Next
        </button>{' '}
        <span role="status">{status.kind === 'reading' && `Reading page ${page + 1}…`}</span>
      </p>
      {status.kind === 'failed' && (
        <p role="alert">The bytes could not be read: {status.message}</p>
      )}
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
              const at = shownStart + from;
              return (
                <tr key={from}>
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
                <td>{bytes ? value(f, bytes, shownStart) : ''}</td>
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

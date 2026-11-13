/** The charts of ui.md (Chart forms), as hand-written SVG; see ui.md, Charts in code. */
import type { Day, Focus, Path, ReporterRow, Totals } from '@benchside/dmarc-aggregate';
import { TableScroll } from '@benchside/ui';
import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { count, percent } from '../format.ts';
import { CAUSES, PATH_NAME, PATHS } from '../labels.ts';

/** WAI-ARIA Graphics: a focusable mark that is not a button. Preact's role type lacks it. */
const SYMBOL: Record<string, string> = { role: 'graphics-symbol' };
/** WAI-ARIA Graphics: the chart itself; unlike `img`, it keeps its parts reachable. */
const DOCUMENT: Record<string, string> = { role: 'graphics-document' };

/** Widest drawing; a figure lays out at its own width up to this, so one unit is one pixel (SITE-11). */
const MAX_W = 640;
/** Below this the figure is not laid out yet; keep the last width. */
const MIN_W = 80;
/** A figure must grow this much before the chart lays out again, so a page scrollbar that comes
    and goes with the chart's height cannot make the layout flip back and forth. */
const GROW = 24;
/** The width the current chart lays out at; 640 without layout (tests). */
const ChartWidth = createContext(MAX_W);

/** Measures the figure and returns the width to draw at (ui.md, Charts in code). */
function useChartWidth() {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(MAX_W);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // ResizeObserver reports once on observe, so no first call is needed.
    const observer = new ResizeObserver(() => {
      const w = Math.min(MAX_W, Math.floor(el.clientWidth));
      if (w < MIN_W) return;
      // Shrink at once, so nothing spills; grow only by a clear step (GROW).
      setWidth((now) => (w < now || w >= now + GROW ? w : now));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Words of `text` in lines of at most `chars` characters. A longer word, such as a domain, is cut
    into pieces of `chars` (SITE-11). */
function wrap(text: string, chars: number): string[] {
  const n = Math.max(chars, 1);
  const words = text
    .split(' ')
    .flatMap((w) => (w.length <= n ? [w] : (w.match(new RegExp(`.{1,${n}}`, 'g')) ?? [w])));
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > chars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Line height of a wrapped label, in units (= px). */
const LINE = 14;
/** Upper estimate of a 12 px character's width, for every fit, wrap, and tooltip size; the browser
    test (SITE-11) checks it against real fonts. */
const CHAR = 7.5;
const GAP = 2;
const MAX_BAR = 24;
const RADIUS = 4;

/** A rectangle rounded at one end only: the data end (dataviz marks). */
function roundedEnd(
  x: number,
  y: number,
  w: number,
  h: number,
  end: 'top' | 'right' | 'none',
): string {
  const r = Math.min(RADIUS, w / 2, h / 2);
  if (end === 'none' || r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  if (end === 'top') {
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

/** A clean axis top: 1, 2, or 5 times a power of ten. */
function niceMax(n: number): number {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  const m = n / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

const tick = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : count(n));

/** Activate on click, Enter, or Space (ui.md, Interaction). */
function pressable(onPress: () => void) {
  return {
    role: 'button' as const,
    tabindex: 0,
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPress();
      }
    },
  };
}

/** Hover and keyboard focus both show the tooltip. */
function hoverable(i: number, set: (i: number | null) => void) {
  return {
    onMouseEnter: () => set(i),
    onMouseLeave: () => set(null),
    onFocus: () => set(i),
    onBlur: () => set(null),
  };
}

/** A tooltip drawn in the SVG and placed by attributes, since the CSP allows no style attributes. */
function Tooltip({
  x,
  y,
  lines,
  below = false,
}: {
  x: number;
  y: number;
  lines: readonly string[];
  /** Open under `y` instead of above it. */
  below?: boolean;
}) {
  const W = useContext(ChartWidth);
  const fit = Math.floor((W - 16) / CHAR);
  const shown = lines.flatMap((l) => wrap(l, fit));
  const w = Math.min(Math.max(...shown.map((l) => l.length)) * CHAR + 16, W);
  const h = shown.length * 16 + 8;
  const left = Math.max(Math.min(x - w / 2, W - w), 0);
  const top = below ? y + 8 : Math.max(y - h - 8, 0);
  return (
    <g class="tooltip" pointer-events="none">
      <rect x={left} y={top} width={w} height={h} rx={4} />
      {shown.map((l, i) => (
        <text key={i} x={left + 8} y={top + 18 + i * 16}>
          {l}
        </text>
      ))}
    </g>
  );
}

function Legend({ paths = PATHS }: { paths?: readonly Path[] }) {
  return (
    <ul class="legend">
      {paths.map((p) => (
        <li key={p}>
          <span class={`swatch path-${p}`} aria-hidden="true" />
          {PATH_NAME[p]}
        </li>
      ))}
    </ul>
  );
}

/** Title, the chart or its table, the legend, and notes (ui.md, Interaction: every chart has a Table toggle). */
function ChartFigure({
  title,
  table,
  legend,
  notes,
  measure,
  width,
  children,
}: {
  title: string;
  table: ComponentChildren;
  legend?: ComponentChildren;
  notes?: ComponentChildren;
  /** From useChartWidth: the figure is what gets measured. */
  measure: preact.Ref<HTMLElement>;
  width: number;
  children: ComponentChildren;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure class="chart" ref={measure}>
      <figcaption>
        {title}{' '}
        <button
          type="button"
          class="table-toggle"
          aria-pressed={asTable}
          onClick={() => setAsTable(!asTable)}
        >
          {asTable ? 'Chart' : 'Table'}
        </button>
      </figcaption>
      {asTable ? table : <ChartWidth.Provider value={width}>{children}</ChartWidth.Provider>}
      {!asTable && legend}
      {notes}
    </figure>
  );
}

const PLOT = { left: 44, right: 8, top: 12, bottom: 24 };

/** Hairline grid at 0, half, and the top, with muted labels; y starts at 0 (ui.md, Marks). */
function YGrid({
  max,
  height,
  format,
}: {
  max: number;
  height: number;
  format: (n: number) => string;
}) {
  const W = useContext(ChartWidth);
  const plotH = height - PLOT.top - PLOT.bottom;
  return (
    <g class="grid">
      {[0, 0.5, 1].map((f) => {
        const y = PLOT.top + plotH * (1 - f);
        return (
          <g key={f}>
            <line x1={PLOT.left} x2={W - PLOT.right} y1={y} y2={y} />
            <text x={PLOT.left - 6} y={y + 4} text-anchor="end">
              {format(max * f)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XLabels({ days, height }: { days: readonly Day[]; height: number }) {
  const W = useContext(ChartWidth);
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return null;
  return (
    <g class="grid">
      <text x={PLOT.left} y={height - 6}>
        {first.date}
      </text>
      {last !== first && (
        <text x={W - PLOT.right} y={height - 6} text-anchor="end">
          {last.date}
        </text>
      )}
    </g>
  );
}

const dayTotal = (d: Day) =>
  d.messages ? d.messages.direct + d.messages.forwarded + d.messages.other : 0;

/** CMB-10: stacked columns, one per UTC day, three paths. */
export function DailyColumns({
  days,
  undated,
  earlier,
}: {
  days: readonly Day[];
  undated: number;
  earlier: number;
}) {
  const [measure, W] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 220;
  const plotW = W - PLOT.left - PLOT.right;
  const plotH = H - PLOT.top - PLOT.bottom;
  const band = plotW / Math.max(days.length, 1);
  const bw = Math.min(MAX_BAR, band * 0.8);
  const max = niceMax(Math.max(0, ...days.map(dayTotal)));
  const k = plotH / max;
  const byPath = PATHS.map((p) => days.reduce((n, d) => n + (d.messages?.[p] ?? 0), 0));
  const top = Math.max(...byPath);
  const main = PATHS[byPath.indexOf(top)] as Path;
  const span = `${days.length} day${days.length === 1 ? '' : 's'}`;
  const summary = `Messages per day, ${span}, ${top > 0 ? `mostly ${PATH_NAME[main].toLowerCase()}` : 'no messages'}`;
  const hovered = hover === null ? null : days[hover];
  return (
    <ChartFigure
      measure={measure}
      width={W}
      title="Messages per day by path"
      legend={<Legend />}
      notes={
        <>
          {undated > 0 && (
            <p class="note">{count(undated)} undated messages are not on the time axis.</p>
          )}
          {earlier > 0 && (
            <p class="note">{count(earlier)} messages from earlier days are not shown.</p>
          )}
        </>
      }
      table={
        <TableScroll label="Messages per day by path">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Messages</th>
                {PATHS.map((p) => (
                  <th key={p}>{PATH_NAME[p]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <td class="nowrap">{d.date}</td>
                  <td class="num">{d.messages ? count(dayTotal(d)) : '—'}</td>
                  {PATHS.map((p) => (
                    <td key={p} class="num">
                      {d.messages ? count(d.messages[p]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} {...DOCUMENT} aria-label={summary}>
        <YGrid max={max} height={H} format={tick} />
        <XLabels days={days} height={H} />
        {days.map((d, i) => {
          if (!d.messages) return null;
          const m = d.messages;
          const x = PLOT.left + i * band + (band - bw) / 2;
          let cursor = PLOT.top + plotH;
          const shown = PATHS.filter((p) => m[p] > 0);
          const label = `${d.date}: ${count(dayTotal(d))} messages. ${PATHS.map((p) => `${PATH_NAME[p]} ${count(m[p])}`).join(', ')}`;
          return (
            <g key={d.date} tabindex={0} {...SYMBOL} aria-label={label} {...hoverable(i, setHover)}>
              <rect class="hit" x={PLOT.left + i * band} y={PLOT.top} width={band} height={plotH} />
              {shown.map((p, j) => {
                const h = Math.max(m[p] * k - (j > 0 ? GAP : 0), 0.5);
                const y = cursor - h;
                cursor = y - GAP;
                const top = j === shown.length - 1;
                return (
                  <path
                    key={p}
                    class={`seg path-${p}`}
                    data-box={`${x} ${y} ${bw} ${h}`}
                    d={roundedEnd(x, y, bw, h, top ? 'top' : 'none')}
                  />
                );
              })}
            </g>
          );
        })}
        {hovered?.messages && hover !== null && (
          <Tooltip
            x={PLOT.left + (hover + 0.5) * band}
            y={PLOT.top + plotH - dayTotal(hovered) * k}
            lines={[
              hovered.date,
              `${count(dayTotal(hovered))} messages`,
              ...PATHS.map((p) => `${PATH_NAME[p]}: ${count(hovered.messages?.[p] ?? 0)}`),
            ]}
          />
        )}
      </svg>
    </ChartFigure>
  );
}

/** CMB-10: the DMARC pass rate per day on the same time axis, a second chart, never a second y-axis. */
export function PassRate({ days }: { days: readonly Day[] }) {
  const [measure, W] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 160;
  const plotW = W - PLOT.left - PLOT.right;
  const plotH = H - PLOT.top - PLOT.bottom;
  const band = plotW / Math.max(days.length, 1);
  const x = (i: number) => PLOT.left + (i + 0.5) * band;
  const y = (rate: number) => PLOT.top + plotH * (1 - rate);
  let d = '';
  let pen = false;
  days.forEach((day, i) => {
    if (day.passRate === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(i)},${y(day.passRate)}`;
    pen = true;
  });
  const rated = days.map((day, i) => ({ day, i })).filter((r) => r.day.passRate !== null);
  const first = rated[0];
  const last = rated[rated.length - 1];
  const summary =
    first && last
      ? `DMARC pass rate per day, from ${percent(first.day.passRate)} to ${percent(last.day.passRate)}`
      : 'DMARC pass rate per day, no messages';
  const hovered = hover === null ? null : days[hover];
  return (
    <ChartFigure
      measure={measure}
      width={W}
      title="DMARC pass rate per day"
      table={
        <TableScroll label="DMARC pass rate per day">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td class="nowrap">{day.date}</td>
                  <td class="num">{percent(day.passRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} {...DOCUMENT} aria-label={summary}>
        <YGrid max={1} height={H} format={(n) => `${Math.round(n * 100)}%`} />
        <XLabels days={days} height={H} />
        <path class="line" d={d} />
        {last && <circle class="end" cx={x(last.i)} cy={y(last.day.passRate as number)} r={4} />}
        {hovered && hover !== null && hovered.passRate !== null && (
          <>
            <line
              class="crosshair"
              x1={x(hover)}
              x2={x(hover)}
              y1={PLOT.top}
              y2={PLOT.top + plotH}
            />
            <circle class="end" cx={x(hover)} cy={y(hovered.passRate)} r={4} />
            <Tooltip
              x={x(hover)}
              y={y(hovered.passRate)}
              lines={[
                hovered.date,
                `${percent(hovered.passRate)} pass`,
                `${count(dayTotal(hovered))} messages`,
              ]}
            />
          </>
        )}
        {rated.map(({ day, i }) => (
          <g
            key={day.date}
            tabindex={0}
            {...SYMBOL}
            aria-label={`${day.date}: ${percent(day.passRate)} pass`}
            {...hoverable(i, setHover)}
          >
            <rect class="hit" x={PLOT.left + i * band} y={PLOT.top} width={band} height={plotH} />
          </g>
        ))}
      </svg>
    </ChartFigure>
  );
}

/** Rough text width in viewBox units, for "does the label fit" (dataviz: measure first). */
const textWidth = (s: string) => s.length * CHAR;

/** CMB-9: one whole, three parts, the share printed inside each block that fits. */
export function PathBar({ totals, onFocus }: { totals: Totals; onFocus: (f: Focus) => void }) {
  const [measure, W] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 28;
  const shown = PATHS.filter((p) => totals.byPath[p] > 0);
  const free = W - GAP * Math.max(shown.length - 1, 0);
  const sum = shown.reduce((n, p) => n + totals.byPath[p], 0);
  const share = (p: Path) => (totals.messages > 0 ? totals.byPath[p] / totals.messages : null);
  let cursor = 0;
  const blocks = shown.map((p) => {
    const w = sum > 0 ? (totals.byPath[p] / sum) * free : 0;
    const b = { p, x: cursor, w };
    cursor += w + GAP;
    return b;
  });
  const summary = `Delivery path: ${PATHS.map((p) => `${PATH_NAME[p]} ${percent(share(p))}`).join(', ')}`;
  const hovered = hover === null ? null : blocks[hover];
  return (
    <ChartFigure
      measure={measure}
      width={W}
      title="Delivery path"
      legend={<Legend paths={shown} />}
      table={
        <TableScroll label="Delivery path">
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th>Messages</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {PATHS.map((p) => (
                <tr key={p} data-path={p}>
                  <td>
                    <button type="button" class="link" onClick={() => onFocus({ path: p })}>
                      {PATH_NAME[p]}
                    </button>
                  </td>
                  <td class="num">{count(totals.byPath[p])}</td>
                  <td class="num">{percent(share(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      }
    >
      <svg viewBox={`0 0 ${W} ${H}`} {...DOCUMENT} aria-label={summary}>
        {blocks.map((b, i) => {
          const label = percent(share(b.p));
          return (
            <g
              key={b.p}
              aria-label={`${PATH_NAME[b.p]}: ${count(totals.byPath[b.p])} messages, ${label}`}
              {...pressable(() => onFocus({ path: b.p }))}
              {...hoverable(i, setHover)}
            >
              <rect class={`block path-${b.p}`} x={b.x} y={0} width={b.w} height={H} rx={RADIUS} />
              {textWidth(label) + 12 <= b.w && (
                <text class={`inside on-${b.p}`} x={b.x + 6} y={H / 2 + 5}>
                  {label}
                </text>
              )}
            </g>
          );
        })}
        {hovered && (
          <Tooltip
            x={hovered.x + hovered.w / 2}
            y={H}
            below
            lines={[
              `${PATH_NAME[hovered.p]}: ${count(totals.byPath[hovered.p])} messages, ${percent(share(hovered.p))}`,
            ]}
          />
        )}
      </svg>
    </ChartFigure>
  );
}

const ROW = 40;
const LABEL_W = 0;

/** Rows of wrapped labels stacked down the chart: each row's top, its lines, and the height its
    extra lines add. `before` is space above a row (a group heading). */
function stackRows<T>(
  items: readonly T[],
  label: (t: T) => string,
  W: number,
  before: (t: T) => number = () => 0,
) {
  let y = 0;
  const rows = items.map((item) => {
    y += before(item);
    const lines = wrap(label(item), Math.floor(W / CHAR));
    const extra = (lines.length - 1) * LINE;
    const row = { item, top: y, lines, extra };
    y += ROW + extra;
    return row;
  });
  return { rows, height: y };
}

/** A label above a bar, wrapped to the chart width. Each line but the last keeps its trailing space,
    so the text reads as the unwrapped label. */
function BarLabel({ lines, top }: { lines: readonly string[]; top: number }) {
  return (
    <text class="label" x={0} y={top + 10}>
      {lines.map((l, k) => (
        <tspan key={k} x={0} dy={k === 0 ? 0 : LINE}>
          {k < lines.length - 1 ? `${l} ` : l}
        </tspan>
      ))}
    </text>
  );
}

/** Horizontal bars, label above, value at the tip (dataviz: bars -> value at the tip). */
/** `room`: width kept free at the right for the longest value at a tip, so no text is clipped. */
function barRow(y: number, value: number, max: number, cls: string, room: number, W: number) {
  const plotW = W - room;
  const w = max > 0 ? Math.max((value / max) * plotW, 1) : 0;
  return {
    w,
    path: <path class={cls} data-width={String(w)} d={roundedEnd(LABEL_W, y, w, 14, 'right')} />,
  };
}

/** CAUSE-1..9: ranked within each path group, rule order; a click sets the focus (SRC-5). */
export function CauseBars({ totals, onFocus }: { totals: Totals; onFocus: (f: Focus) => void }) {
  const [measure, W] = useChartWidth();
  const byCause = new Map(totals.byCause.map((c) => [c.cause, c.messages]));
  const list = CAUSES.filter((c) => byCause.has(c.cause));
  const max = Math.max(0, ...list.map((c) => byCause.get(c.cause) ?? 0));
  const room = Math.max(0, ...list.map((c) => textWidth(count(byCause.get(c.cause) ?? 0)))) + 12;
  // A group heading (the path name) goes above the first cause of each path.
  const headed = new Set(PATHS.map((p) => list.find((c) => c.path === p)).filter(Boolean));
  const { rows, height } = stackRows(
    list,
    (c) => c.label,
    W,
    (c) => (headed.has(c) ? 24 : 0),
  );
  const H = Math.max(height, 24);
  return (
    <ChartFigure
      measure={measure}
      width={W}
      title="Causes of failure"
      legend={<Legend paths={PATHS.filter((p) => list.some((c) => c.path === p))} />}
      table={
        <TableScroll label="Causes of failure">
          <table>
            <thead>
              <tr>
                <th>Path</th>
                <th>Cause</th>
                <th>Failing messages</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.cause} data-path={c.path}>
                  <td>{PATH_NAME[c.path]}</td>
                  <td>
                    <button type="button" class="link" onClick={() => onFocus({ cause: c.cause })}>
                      {c.label}
                    </button>
                  </td>
                  <td class="num">{count(byCause.get(c.cause) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        {...DOCUMENT}
        aria-label={`Causes of failure: ${list.length} causes, most ${list.length ? list.reduce((a, b) => ((byCause.get(b.cause) ?? 0) > (byCause.get(a.cause) ?? 0) ? b : a)).label : 'none'}`}
      >
        {rows.map(({ item: c, top, lines, extra }) => {
          const heading = headed.has(c);
          const n = byCause.get(c.cause) ?? 0;
          const bar = barRow(top + 14 + extra, n, max, `bar path-${c.path}`, room, W);
          return (
            <g key={c.cause}>
              {heading && (
                <text class="group" x={0} y={top - 8}>
                  {PATH_NAME[c.path]}
                </text>
              )}
              <g
                data-cause={c.cause}
                aria-label={`${c.label}: ${count(n)} failing messages`}
                {...pressable(() => onFocus({ cause: c.cause }))}
              >
                <rect class="hit" x={0} y={top} width={W} height={ROW - 4 + extra} />
                <BarLabel lines={lines} top={top} />
                {bar.path}
                <text class="value" x={bar.w + 6} y={top + 25 + extra}>
                  {count(n)}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </ChartFigure>
  );
}

/** CMB-11: reporters by messages, the pass rate as text at the tip. */
export function ReporterBars({ rows }: { rows: readonly ReporterRow[] }) {
  const [measure, W] = useChartWidth();
  const max = Math.max(0, ...rows.map((r) => r.messages));
  const tip = (r: ReporterRow) => `${count(r.messages)}, ${percent(r.passRate)} pass`;
  const room = Math.max(0, ...rows.map((r) => textWidth(tip(r)))) + 12;
  const { rows: laid, height } = stackRows(rows, (r) => r.reporter, W);
  const H = Math.max(height, ROW);
  return (
    <ChartFigure
      measure={measure}
      width={W}
      title="Messages by reporter"
      table={
        <TableScroll label="Messages by reporter">
          <table>
            <thead>
              <tr>
                <th>Reporter</th>
                <th>Messages</th>
                <th>Pass rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.reporter}>
                  <td>{r.reporter}</td>
                  <td class="num">{count(r.messages)}</td>
                  <td class="num">{percent(r.passRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        {...DOCUMENT}
        aria-label={`Messages by reporter, ${rows.length} reporters`}
      >
        {laid.map(({ item: r, top, lines, extra }) => {
          const bar = barRow(top + 14 + extra, r.messages, max, 'bar neutral', room, W);
          return (
            <g
              key={r.reporter}
              tabindex={0}
              {...SYMBOL}
              aria-label={`${r.reporter}: ${count(r.messages)} messages, ${percent(r.passRate)} pass`}
            >
              <BarLabel lines={lines} top={top} />
              {bar.path}
              <text class="value" x={bar.w + 6} y={top + 25 + extra}>
                {tip(r)}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFigure>
  );
}

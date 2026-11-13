import type { Day, ReporterRow, Totals } from '@benchside/dmarc-aggregate';
import { type ComponentChild, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CauseBars, DailyColumns, PassRate, PathBar, ReporterBars } from './charts.tsx';

let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
});
const show = (node: ComponentChild) => {
  root = document.createElement('div');
  document.body.append(root);
  act(() => render(node, root));
};
const svg = () => root.querySelector('svg[role="graphics-document"]') as SVGElement;
/** Marks that take keyboard focus: buttons when clickable, graphics symbols otherwise. */
const parts = () => [...root.querySelectorAll('g[tabindex="0"]')] as SVGGElement[];
const part = (name: string) =>
  parts().find((g) => g.getAttribute('aria-label')?.startsWith(name)) as SVGGElement;

const days: Day[] = [
  { date: '2023-11-14', messages: { direct: 6, forwarded: 2, other: 2 }, passRate: 0.8 },
  { date: '2023-11-15', messages: null, passRate: null },
  { date: '2023-11-16', messages: { direct: 3, forwarded: 0, other: 1 }, passRate: 0.75 },
];
const totals = (o: Partial<Totals> = {}): Totals => ({
  messages: 100,
  passing: 70,
  failing: 30,
  passRate: 0.7,
  byDisposition: [],
  byPath: { direct: 60, forwarded: 30, other: 10 },
  byCause: [
    { cause: 'unauthenticated', messages: 4 },
    { cause: 'dkim-broken', messages: 20 },
    { cause: 'no-dkim', messages: 6 },
  ],
  reports: 3,
  reporters: 2,
  sourceIps: 5,
  authorDomains: 1,
  period: null,
  ...o,
});

describe('Charts: messages per day (CMB-10, ui.md)', () => {
  it('CMB-10: given a day without reports, when drawn, then it has no column; each day with mail has its path segments', () => {
    show(<DailyColumns days={days} undated={0} earlier={0} />);
    expect(parts().every((g) => g.getAttribute('role') === 'graphics-symbol')).toBe(true);
    expect(parts().map((g) => g.getAttribute('aria-label'))).toEqual([
      '2023-11-14: 10 messages. Direct 6, Forwarded 2, Other 2',
      '2023-11-16: 4 messages. Direct 3, Forwarded 0, Other 1',
    ]);
    // A part at zero draws nothing: 3 segments, then 2.
    expect(parts().map((g) => g.querySelectorAll('path.seg').length)).toEqual([3, 2]);
    expect(svg().getAttribute('aria-label')).toBe('Messages per day, 3 days, mostly direct');
  });

  it('ui.md: given days with no messages, when drawn, then the summary says so instead of naming a path', () => {
    show(
      <DailyColumns
        days={[{ date: '2023-11-14', messages: null, passRate: null }]}
        undated={0}
        earlier={0}
      />,
    );
    expect(svg().getAttribute('aria-label')).toBe('Messages per day, 1 day, no messages');
  });

  it('ui.md: given the columns, when drawn, then no column is wider than 24 units and segments leave a 2 unit gap', () => {
    show(<DailyColumns days={days.slice(0, 1)} undated={0} earlier={0} />);
    const boxes = [...root.querySelectorAll('path.seg')].map(
      (p) => p.getAttribute('data-box')?.split(' ').map(Number) as number[],
    );
    for (const [, , w] of boxes) expect(w).toBeLessThanOrEqual(24);
    const sorted = boxes.sort((a, b) => (a[1] as number) - (b[1] as number));
    for (let i = 1; i < sorted.length; i++) {
      const [, y0, , h0] = sorted[i - 1] as number[];
      expect((sorted[i] as number[])[1] as number).toBeCloseTo(
        (y0 as number) + (h0 as number) + 2,
        5,
      );
    }
  });

  it('ui.md: given two or more series, when drawn, then a legend names the paths, and undated and earlier messages are noted', () => {
    show(<DailyColumns days={days} undated={7} earlier={3} />);
    expect([...root.querySelectorAll('.legend li')].map((l) => l.textContent)).toEqual([
      'Direct',
      'Forwarded',
      'Other',
    ]);
    expect(root.textContent).toContain('7 undated messages are not on the time axis');
    expect(root.textContent).toContain('3 messages from earlier days');
  });

  it('ui.md: given a column hovered or focused, when shown, then a tooltip gives the day and messages', () => {
    show(<DailyColumns days={days} undated={0} earlier={0} />);
    act(() => {
      part('2023-11-16').dispatchEvent(new Event('focus'));
    });
    expect(root.querySelector('g.tooltip')?.textContent).toContain('2023-11-16');
    expect(root.querySelector('g.tooltip')?.textContent).toContain('4 messages');
    act(() => {
      part('2023-11-16').dispatchEvent(new Event('blur'));
    });
    expect(root.querySelector('g.tooltip')).toBeNull();
  });

  it('ui.md: given the Table toggle, when pressed, then the same numbers show as a table instead of the chart', () => {
    show(<DailyColumns days={days} undated={0} earlier={0} />);
    act(() => (root.querySelector('button.table-toggle') as HTMLButtonElement).click());
    expect(svg()).toBeNull();
    const rows = [...root.querySelectorAll('tbody tr')].map((r) => r.textContent);
    expect(rows).toEqual(['2023-11-1410622', '2023-11-15————', '2023-11-164301']);
  });
});

describe('Charts: pass rate (CMB-10)', () => {
  it('CMB-10: given a day without reports, when drawn, then the line breaks there', () => {
    show(<PassRate days={days} />);
    const d = root.querySelector('path.line')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)).toHaveLength(2);
    expect(svg().getAttribute('aria-label')).toBe('DMARC pass rate per day, from 80% to 75%');
  });

  it('ui.md: given a day focused, when shown, then a crosshair and the rate of that day', () => {
    show(<PassRate days={days} />);
    act(() => {
      part('2023-11-14').dispatchEvent(new Event('focus'));
    });
    expect(root.querySelector('line.crosshair')).not.toBeNull();
    expect(root.querySelector('g.tooltip')?.textContent).toContain('80%');
  });
});

describe('Charts: delivery path and causes (CMB-9, SRC-5)', () => {
  it('ui.md: given the paths, when drawn, then three blocks sized by share, with the share inside when it fits', () => {
    show(<PathBar totals={totals()} onFocus={() => {}} />);
    const widths = [...root.querySelectorAll('rect.block')].map((r) =>
      Number(r.getAttribute('width')),
    );
    expect(widths[0] as number).toBeGreaterThan(widths[1] as number);
    expect(widths[1] as number).toBeGreaterThan(widths[2] as number);
    expect([...root.querySelectorAll('text.inside')].map((t) => t.textContent)).toContain('60%');
    expect(svg().getAttribute('aria-label')).toBe(
      'Delivery path: Direct 60%, Forwarded 30%, Other 10%',
    );
  });

  it('SRC-5: given a block clicked or Enter pressed, when chosen, then that path is the focus', () => {
    const onFocus = vi.fn();
    show(<PathBar totals={totals()} onFocus={onFocus} />);
    expect(parts().every((g) => g.getAttribute('role') === 'button')).toBe(true);
    act(() => {
      part('Forwarded').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    act(() => {
      part('Other').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onFocus.mock.calls).toEqual([[{ path: 'forwarded' }], [{ path: 'other' }]]);
  });

  it('dataviz: given a block too narrow for its share, when drawn, then it prints none; the table keeps the value', () => {
    show(
      <PathBar
        totals={totals({ byPath: { direct: 95, forwarded: 3, other: 2 } })}
        onFocus={() => {}}
      />,
    );
    expect([...root.querySelectorAll('text.inside')].map((t) => t.textContent)).toEqual(['95%']);
  });

  it('ui.md: given a path with no messages, when drawn, then it draws no block', () => {
    show(
      <PathBar
        totals={totals({ byPath: { direct: 60, forwarded: 0, other: 40 } })}
        onFocus={() => {}}
      />,
    );
    expect(root.querySelectorAll('rect.block')).toHaveLength(2);
  });

  it('ui.md: given causes, when drawn, then bars grouped under their path in rule order, and a click focuses the cause', () => {
    const onFocus = vi.fn();
    show(<CauseBars totals={totals()} onFocus={onFocus} />);
    expect(parts().map((g) => g.getAttribute('data-cause'))).toEqual([
      'dkim-broken',
      'no-dkim',
      'unauthenticated',
    ]);
    expect([...root.querySelectorAll('text.group')].map((t) => t.textContent)).toEqual([
      'Forwarded',
      'Other',
    ]);
    act(() => {
      part('Nothing authenticates').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onFocus).toHaveBeenCalledWith({ cause: 'unauthenticated' });
  });
});

describe('Charts: label in name (SITE-10)', () => {
  /** Lower case, punctuation as spaces, padded: so `includes` matches whole words only. */
  const words = (t: string | null) =>
    ` ${(t ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}%.]+/gu, ' ')
      .trim()} `;

  it.each([
    ['cause bars', () => <CauseBars totals={totals()} onFocus={() => {}} />],
    ['path bar', () => <PathBar totals={totals()} onFocus={() => {}} />],
  ])(
    'SITE-10: given the pressable parts of the %s, when drawn, then each name holds the words shown on it, in order',
    (_, chart) => {
      show(chart());
      const checked = parts()
        .filter((g) => g.getAttribute('role') === 'button')
        .map(
          (g) =>
            [
              words(g.getAttribute('aria-label')),
              [...g.querySelectorAll('text')].map((t) => words(t.textContent)),
            ] as const,
        )
        .filter(([, shown]) => shown.length > 0);
      expect(checked.length).toBeGreaterThan(0);
      for (const [name, shown] of checked) {
        let from = 0;
        for (const piece of shown) {
          const at = name.indexOf(piece, from);
          expect(at, `${piece.trim()} in ${name.trim()}`).toBeGreaterThanOrEqual(0);
          from = at + piece.length - 1;
        }
      }
    },
  );
});

describe('Charts: layout seen in renders', () => {
  it('dataviz: given the longest cause label, when drawn, then it is shown whole, not cut', () => {
    show(
      <CauseBars
        totals={totals({ byCause: [{ cause: 'dkim-broken', messages: 1 }] })}
        onFocus={() => {}}
      />,
    );
    expect(root.querySelector('text.label')?.textContent).toBe(
      'A DKIM signature of the domain did not verify. The message was likely changed on the way',
    );
  });

  it('dataviz: given the path bar, when drawn, then no empty band above it; its tooltip opens below the bar', () => {
    show(<PathBar totals={totals()} onFocus={() => {}} />);
    expect(svg().getAttribute('viewBox')?.split(' ')[1]).toBe('0');
    act(() => {
      part('Direct').dispatchEvent(new Event('focus'));
    });
    expect(Number(root.querySelector('g.tooltip rect')?.getAttribute('y'))).toBeGreaterThanOrEqual(
      28,
    );
  });
});

describe('Charts: wrapped labels (SITE-11)', () => {
  const reporter = (name: string, messages: number): ReporterRow => ({
    reporter: name,
    reports: 1,
    messages,
    passing: messages,
    passRate: 1,
    days: 1,
    firstDay: null,
    lastDay: null,
    formats: [],
  });

  it('SITE-11: given a domain wider than the chart, when wrapped, then it is cut over lines but its text is unchanged', () => {
    const long = `${'reports.'.repeat(12)}example.com`;
    show(<ReporterBars rows={[reporter(long, 5)]} />);
    const label = root.querySelector('text.label') as SVGTextElement;
    expect(label.querySelectorAll('tspan').length).toBeGreaterThan(1);
    expect(label.textContent).toBe(long);
  });

  it('SITE-11: given a name joined by no-break spaces, when wrapped, then it never breaks there and its text is unchanged', () => {
    const nbsp = String.fromCharCode(0xa0);
    const name = Array.from({ length: 30 }, (_, i) => `Word${i}`).join(nbsp);
    show(<ReporterBars rows={[reporter(name, 5)]} />);
    const label = root.querySelector('text.label') as SVGTextElement;
    expect(label.textContent).toBe(name);
    // Cut as one long word: no line ends at a space.
    for (const t of label.querySelectorAll('tspan'))
      expect(t.textContent?.endsWith(' ')).toBe(false);
  });

  it('SITE-11: given a reporter with no name, when drawn, then its row keeps its full height', () => {
    show(<ReporterBars rows={[reporter('', 5), reporter('Next', 3)]} />);
    const ys = [...root.querySelectorAll('text.label')].map((t) => Number(t.getAttribute('y')));
    expect((ys[1] as number) - (ys[0] as number)).toBe(40);
  });
});

describe('Charts: reporters (CMB-11)', () => {
  it('CMB-11: given reporters, when drawn, then bars by messages with the pass rate as text', () => {
    const row = (reporter: string, messages: number, passRate: number): ReporterRow => ({
      reporter,
      reports: 1,
      messages,
      passing: Math.round(messages * passRate),
      passRate,
      days: 1,
      firstDay: null,
      lastDay: null,
      formats: [],
    });
    show(<ReporterBars rows={[row('Big', 80, 0.5), row('Small', 20, 1)]} />);
    expect([...root.querySelectorAll('text.value')].map((t) => t.textContent)).toEqual([
      '80, 50% pass',
      '20, 100% pass',
    ]);
    const widths = [...root.querySelectorAll('path.bar')].map((p) =>
      Number(p.getAttribute('data-width')),
    );
    expect(widths[0] as number).toBeCloseTo((widths[1] as number) * 4, 5);
    // The value at the tip of the longest bar stays inside the 640 wide chart (text never clipped).
    expect((widths[0] as number) + 6 + '80, 50% pass'.length * 7.5).toBeLessThanOrEqual(640);
  });
});

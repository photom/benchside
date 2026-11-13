import type { Day, ReporterRow, Totals } from '@benchside/dmarc-aggregate';
import { type ComponentChild, h, render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '@benchside/ui/theme.css';
import '../../apps/dmarc-aggregate/src/style.css';
import {
  CauseBars,
  DailyColumns,
  PassRate,
  PathBar,
  ReporterBars,
} from '../../apps/dmarc-aggregate/src/views/charts/charts.tsx';

const days: Day[] = Array.from({ length: 14 }, (_, i) => ({
  date: `2026-10-${String(i + 10)}`,
  messages: { direct: 500 + i, forwarded: 70, other: 20 },
  passRate: 0.9,
}));
const totals: Totals = {
  messages: 6525,
  passing: 6298,
  failing: 227,
  passRate: 0.965,
  byDisposition: [],
  byPath: { direct: 5515, forwarded: 785, other: 225 },
  byCause: [
    { cause: 'dkim-broken', messages: 120 },
    { cause: 'no-dkim', messages: 80 },
    { cause: 'unauthenticated', messages: 27 },
  ],
  reports: 30,
  reporters: 3,
  sourceIps: 4,
  authorDomains: 1,
  period: null,
};
const row = (reporter: string, messages: number): ReporterRow => ({
  reporter,
  reports: 10,
  messages,
  passing: messages,
  passRate: 0.968,
  days: 10,
  firstDay: null,
  lastDay: null,
  formats: [],
});

let root: HTMLElement | undefined;
afterEach(() => {
  if (!root) return;
  render(null, root);
  root.remove();
});

const charts: [string, ComponentChild][] = [
  ['messages per day', h(DailyColumns, { days, undated: 0, earlier: 0 })],
  ['pass rate', h(PassRate, { days })],
  ['delivery path', h(PathBar, { totals, onFocus: () => {} })],
  ['causes of failure', h(CauseBars, { totals, onFocus: () => {} })],
  [
    'reporters',
    h(ReporterBars, {
      rows: [
        row('Outlook.com', 2363),
        // One long token, no spaces: must still wrap inside the chart.
        row('dmarc-aggregate-reports.enterprise-mail-protection.example-provider.com', 1918),
      ],
    }),
  ],
];

describe('Chart text on a phone (SITE-11)', () => {
  for (const [name, chart] of charts) {
    it(`SITE-11: given the ${name} chart on a 320 px page, when laid out, then its text is at least 12 px and stays inside the chart`, async () => {
      await page.viewport(320, 900);
      const main = document.createElement('main');
      root = main;
      document.body.append(main);
      render(chart, main);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const svg = main.querySelector('svg[role="graphics-document"]') as SVGSVGElement;
      const box = svg.getBoundingClientRect();
      const scale = box.width / svg.viewBox.baseVal.width;
      const texts = [...svg.querySelectorAll('text')].filter((t) => t.textContent?.trim());
      expect(texts.length).toBeGreaterThan(0);
      inside(texts, box, scale);
      // Each part's tooltip, shown on focus, stays inside the chart too.
      for (const part of svg.querySelectorAll<SVGGElement>('g[tabindex="0"]')) {
        part.dispatchEvent(new FocusEvent('focus'));
        await new Promise((r) => requestAnimationFrame(r));
        inside([...svg.querySelectorAll('g.tooltip text')], box, scale);
        part.dispatchEvent(new FocusEvent('blur'));
        await new Promise((r) => requestAnimationFrame(r));
      }
    });
  }
});

function inside(texts: Element[], box: DOMRect, scale: number) {
  for (const t of texts) {
    const drawn = Number.parseFloat(getComputedStyle(t).fontSize) * scale;
    expect(drawn, `"${t.textContent}" drawn at ${drawn.toFixed(1)} px`).toBeGreaterThanOrEqual(12);
    const r = t.getBoundingClientRect();
    expect(r.right, `"${t.textContent}" ends past the chart`).toBeLessThanOrEqual(box.right + 1);
    expect(r.left).toBeGreaterThanOrEqual(box.left - 1);
  }
}

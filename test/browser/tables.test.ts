import { h, render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import '@benchside/ui/theme.css';
import { TableScroll } from '@benchside/ui';

let root: HTMLElement;
afterEach(() => {
  render(null, root);
  root.remove();
});

/** Rects of `word` inside `cell`: more than one means the word was split across lines. */
function linesOf(cell: Element, word: string): number {
  const text = [...cell.childNodes].find((n) => n.textContent?.includes(word)) as Text;
  const range = document.createRange();
  const at = (text.textContent ?? '').indexOf(word);
  range.setStart(text, at);
  range.setEnd(text, at + word.length);
  return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
}

describe('Tables on a narrow screen (SITE-9)', () => {
  it('SITE-9: given a table wider than a 390 px page, when laid out, then words stay whole, long tokens break, and only the table area scrolls', async () => {
    await page.viewport(390, 800);
    root = document.createElement('main');
    document.body.append(root);
    const cells = Array.from({ length: 8 }, (_, i) => h('td', null, `counted quarantine ${i}`));
    const table = h(
      'table',
      null,
      h(
        'tbody',
        null,
        h(
          'tr',
          null,
          h('td', { class: 'long' }, 'Outlook.com!example.com!1792454400!1792540799.xml.gz'),
          ...cells,
        ),
      ),
    );
    render(h(TableScroll, { label: 'Wide', children: table }), root);
    const area = root.querySelector('.table-scroll') as HTMLElement;
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(area.scrollWidth).toBeGreaterThan(area.clientWidth);
    await expect.poll(() => area.getAttribute('role')).toBe('region');
    expect(area.getAttribute('aria-label')).toBe('Wide');
    expect(area.tabIndex).toBe(0);
    for (const td of root.querySelectorAll('td:not(.long)')) {
      expect(linesOf(td, 'quarantine')).toBe(1);
      expect(linesOf(td, 'counted')).toBe(1);
    }
    const long = root.querySelector('td.long') as HTMLElement;
    expect(long.getBoundingClientRect().width).toBeLessThan(300);
  });

  it('SITE-9: given a table that fits, when laid out, then its area is not a tab stop and not a region', async () => {
    await page.viewport(1280, 800);
    root = document.createElement('main');
    document.body.append(root);
    const table = h('table', null, h('tbody', null, h('tr', null, h('td', null, 'short'))));
    render(h(TableScroll, { label: 'Narrow', children: table }), root);
    const area = root.querySelector('.table-scroll') as HTMLElement;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(area.hasAttribute('tabindex')).toBe(false);
    expect(area.getAttribute('role')).toBeNull();
  });
});

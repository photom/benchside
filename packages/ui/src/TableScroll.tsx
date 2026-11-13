import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * A table's own sideways scroll area (SITE-9). While the table is wider than the area, the area
 * is a named region and a tab stop, so the keyboard can scroll it (WCAG 2.1.1). When the table
 * fits, it is a plain box: no extra landmark, no empty tab stop.
 */
export function TableScroll({ label, children }: { label: string; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    const check = () => setScrolls(area.scrollWidth > area.clientWidth);
    const observer = new ResizeObserver(check);
    observer.observe(area);
    if (area.firstElementChild) observer.observe(area.firstElementChild);
    check();
    return () => observer.disconnect();
  }, []);
  const region = scrolls ? { role: 'region' as const, 'aria-label': label, tabIndex: 0 } : {};
  return (
    <div ref={ref} class="table-scroll" {...region}>
      {children}
    </div>
  );
}

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/** Rows per page in long tables. */
export const PAGE = 500;

/** Shows the first rows of a long list, with a button for the next page. */
export function usePage(total: number): [number, ComponentChildren] {
  const [shown, setShown] = useState(PAGE);
  const more =
    shown < total ? (
      <button type="button" onClick={() => setShown(shown + PAGE)}>
        Show more
      </button>
    ) : null;
  return [Math.min(shown, total), more];
}

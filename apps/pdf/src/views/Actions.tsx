import type { Action, ActionSource } from '@benchside/pdf';
import { usePage } from '@benchside/ui';
import { ScriptText } from './ScriptText.tsx';
import { shown } from './text.ts';

const SOURCES: Record<ActionSource, string> = {
  catalog: 'Catalog',
  names: 'JavaScript name tree',
  page: 'Page',
  annotation: 'Annotation',
  field: 'Form field',
  outline: 'Outline item',
};

/** actions.md ACT-1: when each event happens. */
const EVENTS: Record<ActionSource, Record<string, string>> = {
  catalog: {
    OpenAction: 'When the document is opened',
    WC: 'Before the document closes',
    WS: 'Before the document is saved',
    DS: 'After the document is saved',
    WP: 'Before the document is printed',
    DP: 'After the document is printed',
  },
  names: { JavaScript: 'When the document is opened' },
  page: { O: 'When the page is opened', C: 'When the page is closed' },
  annotation: {
    A: 'When the annotation is activated',
    E: 'When the cursor enters it',
    X: 'When the cursor exits it',
    D: 'When the mouse button is pressed on it',
    U: 'When the mouse button is released on it',
    Fo: 'When it gets the focus',
    Bl: 'When it loses the focus',
    PO: 'When its page is opened',
    PC: 'When its page is closed',
    PV: 'When its page becomes visible',
    PI: 'When its page stops being visible',
  },
  field: {
    K: 'When a character is typed',
    F: 'Before the value is formatted',
    V: 'When the value changes',
    C: 'When the value is recalculated',
  },
  outline: { A: 'When the item is activated' },
};

const where = (a: Action) =>
  [
    SOURCES[a.source],
    a.label === undefined ? null : `"${a.label}"`,
    a.holder === undefined ? null : `object ${a.holder}`,
    a.page === undefined ? null : `page ${a.page + 1}`,
  ]
    .filter(Boolean)
    .join(', ');

const when = (a: Action) =>
  `${EVENTS[a.source][a.event] ?? a.event}${a.automatic ? ' (runs without a click)' : ''}`;

/** REQ-PDF-005 */
export function Actions({ actions }: { actions: readonly Action[] }) {
  const [count, more] = usePage(actions.length);
  return (
    <section aria-label="Actions">
      <h2>Actions</h2>
      {actions.length === 0 ? (
        <p>No actions.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Where</th>
              <th>When</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {actions.slice(0, count).map((a, i) => (
              <tr key={i} data-automatic={a.automatic}>
                <td>
                  {a.type || '(no type)'}
                  {a.depth > 0 && ` (Next, step ${a.depth})`}
                  {a.object !== undefined && ` · object ${a.object}`}
                </td>
                <td>{where(a)}</td>
                <td>{when(a)}</td>
                <td>
                  {shown(a.target)}
                  {a.script && <ScriptText script={a.script} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more}
    </section>
  );
}
